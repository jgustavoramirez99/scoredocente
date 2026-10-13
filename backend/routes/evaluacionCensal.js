const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');

const ROLES_ESCRITURA = ['auxiliar'];             // solo la auxiliar registra respuestas
const ROLES_LECTURA = ['auxiliar', 'director'];   // auxiliar y director pueden consultar

function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// Si una auxiliar no renueva el bloqueo en 2 minutos, se considera libre
// (por si cierra el navegador sin avisar). El frontend renueva cada 45s.
const BLOQUEO_TTL_MS = 2 * 60 * 1000;

// Periodo de evaluación por defecto, para no romper nada que ya existía
// antes de agregar esta columna (toda la data vieja quedó marcada como "I").
const PERIODO_DEFECTO = 'I';
function normalizarPeriodo(periodo) {
  return periodo === 'II' ? 'II' : PERIODO_DEFECTO;
}

// ══════════════════════════════
//  NIVEL DE LOGRO (AD / A / B / C) POR GRADO
// ══════════════════════════════
// Antes esto era un único % fijo para todos los grados (100%=AD, 80%=A,
// 50%=B). Al revisar los exámenes reales de la "II Evaluación" (oct 2026)
// se vio que el rango real de cada nivel varía bastante según el grado y no
// es un simple porcentaje — así que ahora se usa la matriz real de cada
// examen, por grado y nivel educativo.
//
// Cada valor es el MÍNIMO de aciertos para ese nivel. Se evalúa de mayor a
// menor (AD primero), así que el nivel más alto queda "abierto" hacia
// arriba: por ejemplo en 4to y 5to de secundaria el documento original solo
// detalla rangos hasta 18 de 20 ítems, pero un alumno con 19 o 20 correctas
// obviamente sigue siendo "Destacado", así que no hace falta definir un
// límite superior para el nivel más alto.
//
// NOTA pendiente de confirmar con Gustavo: 6to de primaria usa temporalmente
// la misma escala que 5to de primaria porque su examen no trae la tabla de
// niveles (él confirmó usar esto mientras no tenga los rangos reales de 6to).
const TABLA_NIVELES_CENSAL = {
  primaria: {
    2: { AD: 9,  A: 7,  B: 4 },
    3: { AD: 9,  A: 7,  B: 5 },
    4: { AD: 9,  A: 7,  B: 5 },
    5: { AD: 12, A: 10, B: 7 },
    6: { AD: 12, A: 10, B: 7 }, // = 5to primaria (temporal)
  },
  secundaria: {
    1: { AD: 14, A: 11, B: 8 },
    2: { AD: 14, A: 11, B: 8 },
    3: { AD: 14, A: 11, B: 8 },
    4: { AD: 16, A: 14, B: 10 },
    5: { AD: 17, A: 14, B: 10 },
  }
};

const PALABRAS_A_NUMERO_GRADO = {
  primero: 1, primer: 1, segundo: 2, tercero: 3, tercer: 3,
  cuarto: 4, quinto: 5, sexto: 6
};

// El formato exacto en que está guardado salones.grado no está estandarizado
// en ningún lado del código (ninguna pantalla lo usa directo, solo se
// muestra salones.nombre ya armado), así que esto es tolerante a varias
// formas: "2", "2°", "2do", "segundo", etc.
function normalizarGradoNumero(grado) {
  if (grado === null || grado === undefined) return null;
  const texto = String(grado).trim().toLowerCase();
  const match = texto.match(/\d+/);
  if (match) return parseInt(match[0], 10);
  for (const palabra in PALABRAS_A_NUMERO_GRADO) {
    if (texto.includes(palabra)) return PALABRAS_A_NUMERO_GRADO[palabra];
  }
  return null;
}

// Nivel de logro según cantidad de aciertos, grado y nivel educativo del
// salón. Si no se reconoce el grado/nivel (salón sin esos datos, o un grado
// fuera de la tabla), se usa de respaldo la fórmula genérica anterior por
// porcentaje, para no dejar a nadie sin nivel calculado.
function calcularNivelLogro(correctas, totalItems, nivelEducativo, grado) {
  if (!totalItems) return '';

  const nivelNorm = (nivelEducativo || '').toString().trim().toLowerCase();
  const gradoNum = normalizarGradoNumero(grado);
  const umbrales = TABLA_NIVELES_CENSAL[nivelNorm] && TABLA_NIVELES_CENSAL[nivelNorm][gradoNum];

  if (umbrales) {
    if (correctas >= umbrales.AD) return 'Destacado (AD)';
    if (correctas >= umbrales.A) return 'Logrado (A)';
    if (correctas >= umbrales.B) return 'En Proceso (B)';
    return 'En Inicio (C)';
  }

  const pct = correctas / totalItems;
  if (pct === 1) return 'Destacado (AD)';
  if (pct >= 0.8) return 'Logrado (A)';
  if (pct >= 0.5) return 'En Proceso (B)';
  return 'En Inicio (C)';
}

// ══════════════════════════════
//  ÍTEMS DEL SALÓN
// ══════════════════════════════
// GET /api/evaluacion-censal/items?salon_id=5&periodo=I
router.get('/items', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    const periodo = normalizarPeriodo(req.query.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query(
      'SELECT item_numero, competencia FROM evaluacion_censal_items WHERE salon_id = $1 AND periodo = $2 ORDER BY item_numero',
      [salon_id, periodo]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los ítems del salón' });
  }
});

// ══════════════════════════════
//  DATOS GENERALES (profesor tutor, fecha de aplicación)
// ══════════════════════════════
// GET /api/evaluacion-censal/meta?salon_id=5&periodo=I
router.get('/meta', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    const periodo = normalizarPeriodo(req.query.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query(
      'SELECT profesor_tutor, fecha_aplicacion FROM evaluacion_censal_meta WHERE salon_id = $1 AND periodo = $2',
      [salon_id, periodo]
    );
    res.json(result.rows[0] || { profesor_tutor: '', fecha_aplicacion: null });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los datos generales' });
  }
});

// PUT /api/evaluacion-censal/meta  { salon_id, periodo, profesor_tutor, fecha_aplicacion }
router.put('/meta', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { salon_id, profesor_tutor, fecha_aplicacion } = req.body;
    const periodo = normalizarPeriodo(req.body.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query(
      `INSERT INTO evaluacion_censal_meta (salon_id, periodo, profesor_tutor, fecha_aplicacion, actualizado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (salon_id, periodo)
       DO UPDATE SET profesor_tutor = $3, fecha_aplicacion = $4, actualizado_por = $5, actualizado_en = now()
       RETURNING *`,
      [salon_id, periodo, profesor_tutor || null, fecha_aplicacion || null, req.usuario.id]
    );
    const fila = result.rows[0];

    registrarAuditoria({
      tabla: 'evaluacion_censal',
      registro_id: fila.salon_id,
      accion: 'editar',
      usuario: req.usuario,
      descripcion: `Datos generales de evaluación censal (${periodo} Evaluación) — salón ${fila.salon_id}, tutor: ${fila.profesor_tutor || '—'}`,
      datos: fila
    });

    res.json(fila);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar los datos generales' });
  }
});

// ══════════════════════════════
//  CUADRÍCULA COMPLETA DEL SALÓN (alumnos + respuestas + cálculos)
// ══════════════════════════════
// GET /api/evaluacion-censal?salon_id=5&periodo=I
router.get('/', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    const periodo = normalizarPeriodo(req.query.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });

    const salonRes = await db.query('SELECT grado, nivel FROM salones WHERE id = $1', [salon_id]);
    const salon = salonRes.rows[0] || {};

    const itemsRes = await db.query(
      'SELECT item_numero, competencia FROM evaluacion_censal_items WHERE salon_id = $1 AND periodo = $2 ORDER BY item_numero',
      [salon_id, periodo]
    );
    const items = itemsRes.rows;
    const totalItems = items.length;

    const alumnosRes = await db.query(
      'SELECT id, numero, apellidos_nombres FROM alumnos WHERE salon_id = $1 AND activo = true ORDER BY numero',
      [salon_id]
    );
    const alumnos = alumnosRes.rows;
    const alumnoIds = alumnos.map(a => a.id);

    let respuestas = [];
    if (alumnoIds.length) {
      const respRes = await db.query(
        'SELECT alumno_id, item_numero, estado FROM evaluacion_censal_respuestas WHERE alumno_id = ANY($1::int[]) AND periodo = $2',
        [alumnoIds, periodo]
      );
      respuestas = respRes.rows;
    }

    const respMap = {}; // { alumno_id: { item_numero: estado } }
    respuestas.forEach(r => {
      if (!respMap[r.alumno_id]) respMap[r.alumno_id] = {};
      respMap[r.alumno_id][r.item_numero] = r.estado;
    });

    const data = alumnos.map(a => {
      const respu = respMap[a.id] || {};
      let correctas = 0, respondidas = 0, literal = 0, inferencial = 0, critico = 0;
      items.forEach(it => {
        const estado = respu[it.item_numero];
        if (estado) respondidas++;
        if (estado === 'OK') {
          correctas++;
          if (it.competencia === 'L') literal++;
          else if (it.competencia === 'I') inferencial++;
          else if (it.competencia === 'C') critico++;
        }
      });
      return {
        alumno_id: a.id,
        numero: a.numero,
        apellidos_nombres: a.apellidos_nombres,
        respuestas: respu,
        total_correctas: respondidas > 0 ? correctas : null,
        nivel_logro: respondidas > 0 ? calcularNivelLogro(correctas, totalItems, salon.nivel, salon.grado) : '',
        literal, inferencial, critico
      };
    });

    res.json({ total_items: totalItems, items, alumnos: data, periodo });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la evaluación censal del salón' });
  }
});

// ══════════════════════════════
//  GUARDAR UNA RESPUESTA (una celda OK / X / -)
// ══════════════════════════════
// POST /api/evaluacion-censal/respuesta  { alumno_id, item_numero, estado, periodo }
router.post('/respuesta', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { alumno_id, item_numero, estado } = req.body;
    const periodo = normalizarPeriodo(req.body.periodo);
    if (!alumno_id || !item_numero) {
      return res.status(400).json({ error: 'alumno_id e item_numero son requeridos' });
    }
    if (estado && !['OK', 'X', '-'].includes(estado)) {
      return res.status(400).json({ error: 'estado inválido (debe ser OK, X o -)' });
    }
    const result = await db.query(
      `INSERT INTO evaluacion_censal_respuestas (alumno_id, item_numero, periodo, estado, actualizado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (alumno_id, item_numero, periodo)
       DO UPDATE SET estado = $4, actualizado_por = $5, actualizado_en = now()
       RETURNING *`,
      [alumno_id, item_numero, periodo, estado || null, req.usuario.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar la respuesta' });
  }
});

// ══════════════════════════════
//  BLOQUEO POR SALÓN (para que solo una auxiliar edite un salón a la vez)
// ══════════════════════════════
// El bloqueo es por salón + periodo: si dos auxiliares entran al mismo
// salón pero una está en "I Evaluación" y otra en "II Evaluación", no se
// bloquean entre sí porque están editando datos distintos.

// GET /api/evaluacion-censal/bloqueo?salon_id=5&periodo=I
// Consulta si el salón (en ese periodo) está ocupado por otra persona (sin tomarlo)
router.get('/bloqueo', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    const periodo = normalizarPeriodo(req.query.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query('SELECT * FROM evaluacion_censal_bloqueos WHERE salon_id = $1 AND periodo = $2', [salon_id, periodo]);
    const bloqueo = result.rows[0];
    const vencido = bloqueo && (Date.now() - new Date(bloqueo.tomado_en).getTime()) > BLOQUEO_TTL_MS;
    if (!bloqueo || vencido) return res.json({ ocupado: false });
    res.json({
      ocupado: bloqueo.usuario_id !== req.usuario.id,
      usuario_nombre: bloqueo.usuario_nombre,
      tomado_en: bloqueo.tomado_en
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar el bloqueo del salón' });
  }
});

// POST /api/evaluacion-censal/bloqueo/tomar  { salon_id, periodo }
// Toma el bloqueo si está libre, o lo renueva si ya es tuyo. Si otra persona lo tiene, responde 409.
router.post('/bloqueo/tomar', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { salon_id } = req.body;
    const periodo = normalizarPeriodo(req.body.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });

    const actualRes = await db.query('SELECT * FROM evaluacion_censal_bloqueos WHERE salon_id = $1 AND periodo = $2', [salon_id, periodo]);
    const actual = actualRes.rows[0];

    if (actual && actual.usuario_id !== req.usuario.id) {
      const vencido = (Date.now() - new Date(actual.tomado_en).getTime()) > BLOQUEO_TTL_MS;
      if (!vencido) {
        return res.status(409).json({
          error: 'Salón en uso',
          usuario_nombre: actual.usuario_nombre,
          tomado_en: actual.tomado_en
        });
      }
    }

    const nombreUsuario = req.usuario.nombre || req.usuario.email || 'Auxiliar';
    const upsert = await db.query(
      `INSERT INTO evaluacion_censal_bloqueos (salon_id, periodo, usuario_id, usuario_nombre, tomado_en)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (salon_id, periodo)
       DO UPDATE SET usuario_id = $3, usuario_nombre = $4, tomado_en = now()
       RETURNING *`,
      [salon_id, periodo, req.usuario.id, nombreUsuario]
    );
    res.json({ ocupado: false, ...upsert.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al tomar el bloqueo del salón' });
  }
});

// POST /api/evaluacion-censal/bloqueo/liberar  { salon_id, periodo }
// Libera el bloqueo, solo si es tuyo (no puedes liberar el de otra persona)
router.post('/bloqueo/liberar', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { salon_id } = req.body;
    const periodo = normalizarPeriodo(req.body.periodo);
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    await db.query('DELETE FROM evaluacion_censal_bloqueos WHERE salon_id = $1 AND periodo = $2 AND usuario_id = $3', [salon_id, periodo, req.usuario.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al liberar el bloqueo del salón' });
  }
});

module.exports = router;
