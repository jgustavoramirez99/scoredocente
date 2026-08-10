const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// Roles que pueden VER los resultados (ajusta si tienes otros roles de lectura)
const ROLES_LECTURA = ['director', 'directora', 'coordinador_general'];

const CRITERIOS = ['criterio1','criterio2','criterio3','criterio4','criterio5',
                   'criterio6','criterio7','criterio8','criterio9','criterio10'];

function interpretacion(prom) {
  if (prom >= 4.50) return 'Desempeño sobresaliente';
  if (prom >= 4.00) return 'Desempeño muy satisfactorio';
  if (prom >= 3.50) return 'Desempeño satisfactorio con oportunidades de mejora';
  if (prom >= 3.00) return 'Requiere acompañamiento pedagógico';
  return 'Requiere un plan de mejora y seguimiento inmediato';
}

// ══════════════════════════════════════════════════════════════
// POST /api/evaluaciones-estudiantes
// SIN JWT (los alumnos no tienen cuenta) — protegido con una clave
// compartida que solo conoce el script de Google Forms.
// Body: { docente_id, salon_id, criterio1..criterio10, fortaleza, mejora, clave }
// ══════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const b = req.body;

    if (b.clave !== process.env.ENCUESTA_API_KEY) {
      return res.status(403).json({ error: 'Clave inválida' });
    }
    if (!b.docente_id) {
      return res.status(400).json({ error: 'docente_id es requerido' });
    }

    const valores = CRITERIOS.map(c => parseInt(b[c]));
    if (valores.some(v => !v || v < 1 || v > 5)) {
      return res.status(400).json({ error: 'Los 10 criterios deben venir entre 1 y 5' });
    }

    const puntaje_total = (valores.reduce((a, v) => a + v, 0) / valores.length).toFixed(2);

    const cols = ['docente_id', 'salon_id', ...CRITERIOS, 'fortaleza', 'mejora', 'puntaje_total'];
    const vals = [b.docente_id, b.salon_id || null, ...valores, b.fortaleza || null, b.mejora || null, puntaje_total];
    const placeholders = vals.map((_, i) => '$' + (i + 1)).join(', ');

    const result = await db.query(
      `INSERT INTO evaluaciones_estudiantes (${cols.join(', ')})
       VALUES (${placeholders}) RETURNING id`,
      vals
    );
    res.json({ ok: true, id: result.rows[0].id, puntaje_total });
  } catch (err) {
    console.error('Error al guardar evaluación de estudiante:', err);
    res.status(500).json({ error: 'Error al guardar la evaluación' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/evaluaciones-estudiantes/resumen?salon_id=15 (opcional)
// Promedio por docente + total de respuestas (para el panel del director)
// Si se pasa salon_id, el promedio/total se calcula SOLO con ese salón.
// ══════════════════════════════════════════════════════════════
router.get('/resumen', verificarToken, async (req, res) => {
  if (!ROLES_LECTURA.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No autorizado para ver estos resultados' });
  }
  try {
    const salonId = req.query.salon_id || null;
    const result = await db.query(
      `SELECT d.id AS docente_id, d.nombre || ' ' || d.apellido AS docente_nombre,
              COUNT(ee.id) AS total_respuestas,
              ROUND(AVG(ee.puntaje_total)::numeric, 2) AS promedio
       FROM docentes d
       LEFT JOIN evaluaciones_estudiantes ee
              ON ee.docente_id = d.id
             AND ($1::int IS NULL OR ee.salon_id = $1)
       WHERE d.activo = true
       GROUP BY d.id
       ORDER BY d.nombre`,
      [salonId]
    );
    const data = result.rows.map(r => ({
      ...r,
      interpretacion: r.promedio ? interpretacion(parseFloat(r.promedio)) : 'Sin respuestas aún'
    }));
    res.json(data);
  } catch (err) {
    console.error('Error al obtener el resumen:', err);
    res.status(500).json({ error: 'Error al obtener el resumen' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/evaluaciones-estudiantes/:docente_id?salon_id=15 (opcional)
// Promedio por criterio + TODAS las respuestas individuales (anónimas)
// de ese docente, opcionalmente filtradas por salón.
// ══════════════════════════════════════════════════════════════
router.get('/:docente_id', verificarToken, async (req, res) => {
  if (!ROLES_LECTURA.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No autorizado para ver estos resultados' });
  }
  try {
    const salonId = req.query.salon_id || null;
    const filtroSalon = salonId ? 'AND salon_id = $2' : '';
    const params = salonId ? [req.params.docente_id, salonId] : [req.params.docente_id];

    const promedios = await db.query(
      `SELECT ${CRITERIOS.map(c => `ROUND(AVG(${c})::numeric, 2) AS ${c}`).join(', ')},
              ROUND(AVG(puntaje_total)::numeric, 2) AS promedio_general,
              COUNT(*) AS total_respuestas
       FROM evaluaciones_estudiantes WHERE docente_id = $1 ${filtroSalon}`,
      params
    );

    const respuestas = await db.query(
      `SELECT ee.id, ee.salon_id, s.nombre AS salon_nombre,
              ${CRITERIOS.join(', ')}, ee.puntaje_total, ee.fortaleza, ee.mejora, ee.creado_en
       FROM evaluaciones_estudiantes ee
       LEFT JOIN salones s ON s.id = ee.salon_id
       WHERE ee.docente_id = $1 ${filtroSalon}
       ORDER BY ee.creado_en DESC`,
      params
    );

    res.json({
      promedios: promedios.rows[0],
      interpretacion: promedios.rows[0].promedio_general
        ? interpretacion(parseFloat(promedios.rows[0].promedio_general))
        : 'Sin respuestas aún',
      respuestas: respuestas.rows
    });
  } catch (err) {
    console.error('Error al obtener el detalle del docente:', err);
    res.status(500).json({ error: 'Error al obtener el detalle del docente' });
  }
});

module.exports = router;