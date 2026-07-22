const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

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

// Nivel de logro según % de aciertos (no cantidad fija, porque el N° de ítems
// varía según el grado: 6 en primaria, hasta 20 en 5to de secundaria)
function calcularNivelLogro(correctas, totalItems) {
  if (!totalItems) return '';
  const pct = correctas / totalItems;
  if (pct === 1) return 'Destacado (AD)';
  if (pct >= 0.8) return 'Logrado (A)';
  if (pct >= 0.5) return 'En Proceso (B)';
  return 'En Inicio (C)';
}

// ══════════════════════════════
//  ÍTEMS DEL SALÓN
// ══════════════════════════════
// GET /api/evaluacion-censal/items?salon_id=5
router.get('/items', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query(
      'SELECT item_numero, competencia FROM evaluacion_censal_items WHERE salon_id = $1 ORDER BY item_numero',
      [salon_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los ítems del salón' });
  }
});

// ══════════════════════════════
//  DATOS GENERALES (profesor tutor, fecha de aplicación)
// ══════════════════════════════
// GET /api/evaluacion-censal/meta?salon_id=5
router.get('/meta', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query(
      'SELECT profesor_tutor, fecha_aplicacion FROM evaluacion_censal_meta WHERE salon_id = $1',
      [salon_id]
    );
    res.json(result.rows[0] || { profesor_tutor: '', fecha_aplicacion: null });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener los datos generales' });
  }
});

// PUT /api/evaluacion-censal/meta  { salon_id, profesor_tutor, fecha_aplicacion }
router.put('/meta', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { salon_id, profesor_tutor, fecha_aplicacion } = req.body;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query(
      `INSERT INTO evaluacion_censal_meta (salon_id, profesor_tutor, fecha_aplicacion, actualizado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (salon_id)
       DO UPDATE SET profesor_tutor = $2, fecha_aplicacion = $3, actualizado_por = $4, actualizado_en = now()
       RETURNING *`,
      [salon_id, profesor_tutor || null, fecha_aplicacion || null, req.usuario.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar los datos generales' });
  }
});

// ══════════════════════════════
//  CUADRÍCULA COMPLETA DEL SALÓN (alumnos + respuestas + cálculos)
// ══════════════════════════════
// GET /api/evaluacion-censal?salon_id=5
router.get('/', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });

    const itemsRes = await db.query(
      'SELECT item_numero, competencia FROM evaluacion_censal_items WHERE salon_id = $1 ORDER BY item_numero',
      [salon_id]
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
        'SELECT alumno_id, item_numero, estado FROM evaluacion_censal_respuestas WHERE alumno_id = ANY($1::int[])',
        [alumnoIds]
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
        nivel_logro: respondidas > 0 ? calcularNivelLogro(correctas, totalItems) : '',
        literal, inferencial, critico
      };
    });

    res.json({ total_items: totalItems, items, alumnos: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la evaluación censal del salón' });
  }
});

// ══════════════════════════════
//  GUARDAR UNA RESPUESTA (una celda OK / X / -)
// ══════════════════════════════
// POST /api/evaluacion-censal/respuesta  { alumno_id, item_numero, estado }
router.post('/respuesta', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { alumno_id, item_numero, estado } = req.body;
    if (!alumno_id || !item_numero) {
      return res.status(400).json({ error: 'alumno_id e item_numero son requeridos' });
    }
    if (estado && !['OK', 'X', '-'].includes(estado)) {
      return res.status(400).json({ error: 'estado inválido (debe ser OK, X o -)' });
    }
    const result = await db.query(
      `INSERT INTO evaluacion_censal_respuestas (alumno_id, item_numero, estado, actualizado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (alumno_id, item_numero)
       DO UPDATE SET estado = $3, actualizado_por = $4, actualizado_en = now()
       RETURNING *`,
      [alumno_id, item_numero, estado || null, req.usuario.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar la respuesta' });
  }
});

// ══════════════════════════════
//  BLOQUEO POR SALÓN (para que solo una auxiliar edite un salón a la vez)
// ══════════════════════════════

// GET /api/evaluacion-censal/bloqueo?salon_id=5
// Consulta si el salón está ocupado por otra persona (sin tomarlo)
router.get('/bloqueo', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id } = req.query;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const result = await db.query('SELECT * FROM evaluacion_censal_bloqueos WHERE salon_id = $1', [salon_id]);
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

// POST /api/evaluacion-censal/bloqueo/tomar  { salon_id }
// Toma el bloqueo si está libre, o lo renueva si ya es tuyo. Si otra persona lo tiene, responde 409.
router.post('/bloqueo/tomar', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { salon_id } = req.body;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });

    const actualRes = await db.query('SELECT * FROM evaluacion_censal_bloqueos WHERE salon_id = $1', [salon_id]);
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
      `INSERT INTO evaluacion_censal_bloqueos (salon_id, usuario_id, usuario_nombre, tomado_en)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (salon_id)
       DO UPDATE SET usuario_id = $2, usuario_nombre = $3, tomado_en = now()
       RETURNING *`,
      [salon_id, req.usuario.id, nombreUsuario]
    );
    res.json({ ocupado: false, ...upsert.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al tomar el bloqueo del salón' });
  }
});

// POST /api/evaluacion-censal/bloqueo/liberar  { salon_id }
// Libera el bloqueo, solo si es tuyo (no puedes liberar el de otra persona)
router.post('/bloqueo/liberar', verificarToken, permitirRoles(...ROLES_ESCRITURA), async (req, res) => {
  try {
    const { salon_id } = req.body;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    await db.query('DELETE FROM evaluacion_censal_bloqueos WHERE salon_id = $1 AND usuario_id = $2', [salon_id, req.usuario.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al liberar el bloqueo del salón' });
  }
});

module.exports = router;