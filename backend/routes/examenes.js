const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');

// Quién puede digitar las respuestas de los alumnos (la auxiliar, como pidió Gustavo)
const ROLES_RESPUESTAS = ['auxiliar'];
// Quién puede ver la cuadrícula/gráficos (auxiliar + roles de dirección)
const ROLES_LECTURA = ['auxiliar', 'director', 'directora', 'coordinador_general'];
// Quién puede ver/editar la CLAVE de respuestas correctas (nunca la auxiliar,
// para no influenciar cómo digita lo que marcó el alumno)
const ROLES_CLAVE = ['director', 'directora', 'coordinador_general'];

function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

const CURSOS = ['Razonamiento Matemático', 'Geometría', 'Álgebra', 'Trigonometría', 'Aritmética'];
const LETRAS_VALIDAS = ['A', 'B', 'C', 'D', 'E'];

// Preguntas 1-10 = BÁSICO, 11-20 = INTERMEDIO, 21-25 = AVANZADO (fijo para todos los cursos/grados)
function nivelDePregunta(n) {
  if (n >= 1 && n <= 10) return 'BASICO';
  if (n >= 11 && n <= 20) return 'INTERMEDIO';
  if (n >= 21 && n <= 25) return 'AVANZADO';
  return null;
}
// % mínimo para aprobar cada nivel (AVANZADO = literal 1 de 5 = 20%)
const UMBRAL_NIVEL = { BASICO: 0.8, INTERMEDIO: 0.5, AVANZADO: 0.2 };
const TOTAL_NIVEL = { BASICO: 10, INTERMEDIO: 10, AVANZADO: 5 };
const NIVELES = ['BASICO', 'INTERMEDIO', 'AVANZADO'];

function nivelVacio() {
  return { correctas: 0, respondidas: 0, total: 0, aprobado: null };
}

// ══════════════════════════════
//  CURSOS DISPONIBLES
// ══════════════════════════════
// GET /api/examenes/cursos
router.get('/cursos', verificarToken, permitirRoles(...ROLES_LECTURA, ...ROLES_CLAVE), (req, res) => {
  res.json(CURSOS);
});

// ══════════════════════════════
//  CLAVE DE RESPUESTAS (solo dirección)
// ══════════════════════════════
// GET /api/examenes/clave?salon_id=5&curso=Aritmética
router.get('/clave', verificarToken, permitirRoles(...ROLES_CLAVE), async (req, res) => {
  try {
    const { salon_id, curso } = req.query;
    if (!salon_id || !curso) return res.status(400).json({ error: 'salon_id y curso son requeridos' });
    const result = await db.query(
      'SELECT pregunta, nivel, respuesta_correcta FROM examenes_clave WHERE salon_id = $1 AND curso = $2 ORDER BY pregunta',
      [salon_id, curso]
    );
    const filas = result.rows;
    const completa = filas.length === 25 && filas.every(f => f.respuesta_correcta);
    res.json({ preguntas: filas, completa });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la clave de respuestas' });
  }
});

// PUT /api/examenes/clave/lote  { salon_id, curso, respuestas: [{pregunta, respuesta_correcta}, ...] }
// Guarda/actualiza varias preguntas de una sola vez (pensado para el botón "Guardar clave")
router.put('/clave/lote', verificarToken, permitirRoles(...ROLES_CLAVE), async (req, res) => {
  const { salon_id, curso, respuestas } = req.body;
  if (!salon_id || !curso || !Array.isArray(respuestas) || respuestas.length === 0) {
    return res.status(400).json({ error: 'salon_id, curso y respuestas[] son requeridos' });
  }
  for (const r of respuestas) {
    const pregunta = Number(r.pregunta);
    if (!Number.isInteger(pregunta) || pregunta < 1 || pregunta > 25) {
      return res.status(400).json({ error: `Pregunta inválida: ${r.pregunta}` });
    }
    if (r.respuesta_correcta && !LETRAS_VALIDAS.includes(r.respuesta_correcta)) {
      return res.status(400).json({ error: `Respuesta inválida en la pregunta ${pregunta}: ${r.respuesta_correcta}` });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of respuestas) {
      const pregunta = Number(r.pregunta);
      const nivel = nivelDePregunta(pregunta);
      const letra = r.respuesta_correcta || null;
      await client.query(
        `INSERT INTO examenes_clave (salon_id, curso, pregunta, nivel, respuesta_correcta, actualizado_por)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (salon_id, curso, pregunta)
         DO UPDATE SET respuesta_correcta = $5, nivel = $4, actualizado_por = $6, actualizado_en = now()`,
        [salon_id, curso, pregunta, nivel, letra, req.usuario.id]
      );
    }
    await client.query('COMMIT');

    const result = await client.query(
      'SELECT pregunta, nivel, respuesta_correcta FROM examenes_clave WHERE salon_id = $1 AND curso = $2 ORDER BY pregunta',
      [salon_id, curso]
    );
    const filas = result.rows;
    const completa = filas.length === 25 && filas.every(f => f.respuesta_correcta);

    registrarAuditoria({
      tabla: 'examenes_clave',
      registro_id: `${salon_id}-${curso}`,
      accion: 'editar',
      usuario: req.usuario,
      descripcion: `Clave de respuestas actualizada — salón ${salon_id}, curso ${curso} (${filas.length} preguntas)`,
      datos: { salon_id, curso, total: filas.length }
    });

    res.json({ preguntas: filas, completa });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al guardar la clave de respuestas' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════
//  CUADRÍCULA DEL SALÓN (alumnos + respuestas + calificación automática)
// ══════════════════════════════
// GET /api/examenes/grid?salon_id=5&curso=Aritmética
router.get('/grid', verificarToken, permitirRoles(...ROLES_LECTURA), async (req, res) => {
  try {
    const { salon_id, curso } = req.query;
    if (!salon_id || !curso) return res.status(400).json({ error: 'salon_id y curso son requeridos' });

    const claveRes = await db.query(
      'SELECT pregunta, respuesta_correcta FROM examenes_clave WHERE salon_id = $1 AND curso = $2',
      [salon_id, curso]
    );
    const clave = {}; // { pregunta: 'A' }
    claveRes.rows.forEach(f => { if (f.respuesta_correcta) clave[f.pregunta] = f.respuesta_correcta; });
    const claveCompleta = Object.keys(clave).length === 25;

    const alumnosRes = await db.query(
      'SELECT id, numero, apellidos_nombres FROM alumnos WHERE salon_id = $1 AND activo = true ORDER BY numero',
      [salon_id]
    );
    const alumnos = alumnosRes.rows;
    const alumnoIds = alumnos.map(a => a.id);

    let respuestas = [];
    if (alumnoIds.length) {
      const respRes = await db.query(
        'SELECT alumno_id, pregunta, respuesta_marcada FROM examenes_respuestas WHERE alumno_id = ANY($1::int[]) AND curso = $2',
        [alumnoIds, curso]
      );
      respuestas = respRes.rows;
    }
    const respMap = {}; // { alumno_id: { pregunta: 'B' } }
    respuestas.forEach(r => {
      if (!respMap[r.alumno_id]) respMap[r.alumno_id] = {};
      respMap[r.alumno_id][r.pregunta] = r.respuesta_marcada;
    });

    const data = alumnos.map(a => {
      const marcadas = respMap[a.id] || {};
      const niveles = { BASICO: nivelVacio(), INTERMEDIO: nivelVacio(), AVANZADO: nivelVacio() };
      NIVELES.forEach(n => { niveles[n].total = TOTAL_NIVEL[n]; });

      for (let p = 1; p <= 25; p++) {
        const nivel = nivelDePregunta(p);
        const marcada = marcadas[p];
        if (marcada) {
          niveles[nivel].respondidas++;
          if (clave[p] && marcada === clave[p]) niveles[nivel].correctas++;
        }
      }
      NIVELES.forEach(n => {
        if (niveles[n].respondidas > 0 && claveCompleta) {
          niveles[n].aprobado = (niveles[n].correctas / niveles[n].total) >= UMBRAL_NIVEL[n];
        }
      });

      return {
        alumno_id: a.id,
        numero: a.numero,
        apellidos_nombres: a.apellidos_nombres,
        respuestas: marcadas,
        niveles
      };
    });

    res.json({ clave_completa: claveCompleta, alumnos: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la cuadrícula del examen' });
  }
});

// ══════════════════════════════
//  GUARDAR UNA RESPUESTA DE ALUMNO (una celda A-E)
// ══════════════════════════════
// POST /api/examenes/respuesta  { alumno_id, curso, pregunta, respuesta }
router.post('/respuesta', verificarToken, permitirRoles(...ROLES_RESPUESTAS), async (req, res) => {
  try {
    const { alumno_id, curso, pregunta, respuesta } = req.body;
    const p = Number(pregunta);
    if (!alumno_id || !curso || !Number.isInteger(p) || p < 1 || p > 25) {
      return res.status(400).json({ error: 'alumno_id, curso y pregunta (1-25) son requeridos' });
    }
    if (respuesta && !LETRAS_VALIDAS.includes(respuesta)) {
      return res.status(400).json({ error: 'La respuesta debe ser A, B, C, D o E' });
    }
    const result = await db.query(
      `INSERT INTO examenes_respuestas (alumno_id, curso, pregunta, respuesta_marcada, actualizado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (alumno_id, curso, pregunta)
       DO UPDATE SET respuesta_marcada = $4, actualizado_por = $5, actualizado_en = now()
       RETURNING *`,
      [alumno_id, curso, p, respuesta || null, req.usuario.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar la respuesta' });
  }
});

// ══════════════════════════════
//  CARGA MASIVA DE RESPUESTAS (para cuando Gustavo envía fotos de exámenes
//  ya resueltos y se transcriben varias respuestas de golpe)
// ══════════════════════════════
// POST /api/examenes/respuesta/lote  { alumno_id, curso, respuestas: [{pregunta, respuesta}, ...] }
router.post('/respuesta/lote', verificarToken, permitirRoles(...ROLES_RESPUESTAS), async (req, res) => {
  const { alumno_id, curso, respuestas } = req.body;
  if (!alumno_id || !curso || !Array.isArray(respuestas) || respuestas.length === 0) {
    return res.status(400).json({ error: 'alumno_id, curso y respuestas[] son requeridos' });
  }
  for (const r of respuestas) {
    const pregunta = Number(r.pregunta);
    if (!Number.isInteger(pregunta) || pregunta < 1 || pregunta > 25) {
      return res.status(400).json({ error: `Pregunta inválida: ${r.pregunta}` });
    }
    if (r.respuesta && !LETRAS_VALIDAS.includes(r.respuesta)) {
      return res.status(400).json({ error: `Respuesta inválida en la pregunta ${pregunta}: ${r.respuesta}` });
    }
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of respuestas) {
      const pregunta = Number(r.pregunta);
      await client.query(
        `INSERT INTO examenes_respuestas (alumno_id, curso, pregunta, respuesta_marcada, actualizado_por)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (alumno_id, curso, pregunta)
         DO UPDATE SET respuesta_marcada = $4, actualizado_por = $5, actualizado_en = now()`,
        [alumno_id, curso, pregunta, r.respuesta || null, req.usuario.id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, total: respuestas.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al guardar las respuestas' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════
//  ANALIZAR FOTO DEL EXAMEN CON IA (Gemini) — sugiere respuestas,
//  la auxiliar las revisa/corrige y recién ahí las aprueba y guarda
//  (el guardado real sigue pasando por POST /respuesta/lote de arriba)
// ══════════════════════════════
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const PROMPT_ANALISIS_FOTO = `Estás viendo la foto de un examen de opción múltiple ya resuelto por un estudiante de secundaria en Perú. El examen tiene exactamente 25 preguntas numeradas del 1 al 25, organizadas en tres bloques impresos en la hoja: preguntas 1-10 (nivel Básico), 11-20 (nivel Intermedio) y 21-25 (nivel Avanzado). Cada pregunta tiene varias opciones marcadas con letras (A, B, C, D, E — no todas las preguntas tienen 5 opciones).

El estudiante marca la opción que eligió de distintas formas: puede encerrarla en un círculo, subrayarla, marcarla con una X, o tacharla. Tu trabajo es identificar, para cada una de las 25 preguntas, qué letra marcó el estudiante como su respuesta final.

Reglas importantes:
- Si una pregunta quedó sin marcar (en blanco), usa respuesta "" (vacío) y confianza "alta".
- Si el estudiante tachó una opción para descartarla y encerró/marcó claramente otra como su respuesta final, esa marcada es la respuesta — ignora las tachadas.
- Si hay una marca ambigua (dos opciones marcadas, no se distingue bien cuál quedó seleccionada, el estudiante escribió una opción a mano que no corresponde a ninguna letra impresa, o la marca no se lee con claridad), da tu mejor estimación en "respuesta" pero marca "confianza": "dudosa" para que una persona lo revise contra el papel físico. No dejes de dar una estimación — usa tu mejor intento y confianza "dudosa" en vez de omitir la pregunta.
- Usa "confianza": "alta" solo cuando la marca es clara e inequívoca.

Devuelve exactamente 25 entradas, una por cada pregunta del 1 al 25, en orden.`;

const ESQUEMA_ANALISIS_FOTO = {
  type: 'object',
  properties: {
    respuestas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pregunta: { type: 'integer' },
          respuesta: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', ''] },
          confianza: { type: 'string', enum: ['alta', 'dudosa'] }
        },
        required: ['pregunta', 'respuesta', 'confianza']
      }
    }
  },
  required: ['respuestas']
};

// Busca el texto generado dentro de la respuesta de la Interactions API,
// que puede venir en distintas formas según el tipo de contenido.
function extraerTextoGemini(data) {
  if (!data) return null;
  if (typeof data.output_text === 'string') return data.output_text;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (const step of steps) {
    const contenidos = Array.isArray(step.content) ? step.content : [];
    for (const c of contenidos) {
      if (typeof c.text === 'string' && c.text.trim()) return c.text;
      if (c.json) return JSON.stringify(c.json);
    }
  }
  return null;
}

// POST /api/examenes/analizar-foto  { imagen_base64, mime_type, curso }
// Devuelve { respuestas: [{pregunta, respuesta, confianza}, ...] } — NO guarda nada,
// solo sugiere. El guardado real lo hace la auxiliar al aprobar (POST /respuesta/lote).
router.post('/analizar-foto', verificarToken, permitirRoles(...ROLES_RESPUESTAS), async (req, res) => {
  try {
    const { imagen_base64, mime_type, curso } = req.body;
    if (!imagen_base64) {
      return res.status(400).json({ error: 'imagen_base64 es requerida' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en el servidor' });
    }

    const body = {
      model: GEMINI_MODEL,
      input: [
        { type: 'text', text: PROMPT_ANALISIS_FOTO },
        { type: 'image', data: imagen_base64, mime_type: mime_type || 'image/jpeg' }
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: ESQUEMA_ANALISIS_FOTO
      }
    };

    const respuestaGemini = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await respuestaGemini.json().catch(() => null);

    if (!respuestaGemini.ok) {
      console.error('Error de Gemini analizando foto:', respuestaGemini.status, JSON.stringify(data));
      return res.status(502).json({ error: 'La IA no pudo procesar la foto. Intenta de nuevo en un momento.' });
    }

    const texto = extraerTextoGemini(data);
    if (!texto) {
      console.error('Respuesta inesperada de Gemini:', JSON.stringify(data));
      return res.status(502).json({ error: 'La IA respondió en un formato inesperado' });
    }

    let resultado;
    try {
      resultado = JSON.parse(texto);
    } catch (e) {
      console.error('No se pudo parsear el JSON de Gemini:', texto);
      return res.status(502).json({ error: 'La IA no devolvió un resultado válido, intenta con otra foto' });
    }

    if (!Array.isArray(resultado.respuestas)) {
      return res.status(502).json({ error: 'La IA no devolvió las respuestas en el formato esperado' });
    }

    registrarAuditoria({
      tabla: 'examenes_respuestas',
      registro_id: 'analisis-foto',
      accion: 'analizar_foto_ia',
      usuario: req.usuario,
      descripcion: `Análisis de foto de examen con IA — curso ${curso || '(sin especificar)'}`,
      datos: { curso: curso || null, total_respuestas: resultado.respuestas.length }
    });

    res.json({ respuestas: resultado.respuestas });
  } catch (err) {
    console.error('Error analizando foto de examen:', err);
    res.status(500).json({ error: 'Error al analizar la foto del examen' });
  }
});

module.exports = router;
