const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// POST /api/evaluaciones
router.post('/', verificarToken, async (req, res) => {
  const {
    docente_id,
    dominio_disciplinar, practica_pedagogica, clima_aula,
    logro_aprendizaje, innovacion, comunicacion_tutoria,
    observacion, fecha_eval, hora_eval,
    // indicadores individuales
    plan_ind1, plan_ind2, plan_ind3, plan_ind4,
    des_ind1, des_ind2, des_ind3, des_ind4, des_ind5,
    mat_ind1, mat_ind2, mat_ind3, mat_ind4,
    eval_ind1, eval_ind2, eval_ind3, eval_ind4,
    clima_ind1, clima_ind2, clima_ind3,
    resp_ind1, resp_ind2, resp_ind3, resp_ind4,
    // campos adicionales
    area_grado, tema_aprendizaje,
    fortaleza1, fortaleza2, fortaleza3,
    mejora1, mejora2, mejora3,
    compromisos, recomendaciones
  } = req.body;

  // Redondear a entero porque las columnas son INTEGER
  const dom  = Math.round(dominio_disciplinar);
  const prac = Math.round(practica_pedagogica);
  const clim = Math.round(clima_aula);
  const logr = Math.round(logro_aprendizaje);
  const inn  = Math.round(innovacion);
  const com  = Math.round(comunicacion_tutoria);

  const puntaje_total = ((dom + prac + clim + logr + inn + com) / 6).toFixed(2);

  try {
    const result = await db.query(
      `INSERT INTO evaluaciones 
        (docente_id, supervisor_id,
         dominio_disciplinar, practica_pedagogica, clima_aula,
         logro_aprendizaje, innovacion, comunicacion_tutoria,
         observacion, puntaje_total, fecha, hora,
         plan_ind1, plan_ind2, plan_ind3, plan_ind4,
         des_ind1, des_ind2, des_ind3, des_ind4, des_ind5,
         mat_ind1, mat_ind2, mat_ind3, mat_ind4,
         eval_ind1, eval_ind2, eval_ind3, eval_ind4,
         clima_ind1, clima_ind2, clima_ind3,
         resp_ind1, resp_ind2, resp_ind3, resp_ind4,
         area_grado, tema_aprendizaje,
         fortaleza1, fortaleza2, fortaleza3,
         mejora1, mejora2, mejora3,
         compromisos, recomendaciones)
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,$18,$19,$20,$21,
         $22,$23,$24,$25,$26,$27,$28,$29,
         $30,$31,$32,$33,$34,$35,$36,
         $37,$38,$39,$40,$41,$42,$43,$44,$45,$46
       ) RETURNING *`,
      [
        docente_id, req.usuario.id,
        dom, prac, clim, logr, inn, com,
        observacion, puntaje_total, fecha_eval, hora_eval,
        plan_ind1, plan_ind2, plan_ind3, plan_ind4,
        des_ind1, des_ind2, des_ind3, des_ind4, des_ind5,
        mat_ind1, mat_ind2, mat_ind3, mat_ind4,
        eval_ind1, eval_ind2, eval_ind3, eval_ind4,
        clima_ind1, clima_ind2, clima_ind3,
        resp_ind1, resp_ind2, resp_ind3, resp_ind4,
        area_grado, tema_aprendizaje,
        fortaleza1, fortaleza2, fortaleza3,
        mejora1, mejora2, mejora3,
        compromisos, recomendaciones
      ]
    );
    res.json({ ...result.rows[0], promedio: puntaje_total });
  } catch (err) {
    console.error('Error guardando evaluación:', err);
    res.status(500).json({ error: 'Error al guardar evaluación' });
  }
});

// GET /api/evaluaciones
router.get('/', verificarToken, async (req, res) => {
  try {
    const { fecha, mes } = req.query;
    let where = '';
    const params = [];
    if (fecha) {
      params.push(fecha);
      where = `WHERE DATE(e.creado_en) = $${params.length}`;
    } else if (mes) {
      params.push(mes);
      where = `WHERE TO_CHAR(e.creado_en, 'YYYY-MM') = $${params.length}`;
    }
    const result = await db.query(
      `SELECT e.*, 
        d.nombre || ' ' || d.apellido AS docente_nombre,
        u.nombre AS instructor_nombre
       FROM evaluaciones e
       JOIN docentes d ON e.docente_id = d.id
       JOIN usuarios u ON e.supervisor_id = u.id
       ${where}
       ORDER BY e.creado_en DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener evaluaciones' });
  }
});

// GET /api/evaluaciones/mias
router.get('/mias', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, 
        d.nombre || ' ' || d.apellido AS docente_nombre,
        u.nombre AS instructor_nombre
       FROM evaluaciones e
       JOIN docentes d ON e.docente_id = d.id
       JOIN usuarios u ON e.supervisor_id = u.id
       WHERE e.supervisor_id = $1
       ORDER BY e.creado_en DESC`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener evaluaciones' });
  }
});

// ── NUEVO ──────────────────────────────────────────────
// GET /api/evaluaciones/:id — detalle completo (solo director)
router.get('/:id', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede ver el detalle' });
  }
  try {
    const result = await db.query(
      `SELECT e.*,
              d.nombre || ' ' || d.apellido AS docente_nombre,
              u.nombre AS instructor_nombre
       FROM evaluaciones e
       JOIN docentes d ON e.docente_id = d.id
       JOIN usuarios u ON e.supervisor_id = u.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluación no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener evaluación:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
// ──────────────────────────────────────────────────────

// DELETE /api/evaluaciones/:id
router.delete('/:id', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM evaluaciones WHERE id = $1 AND supervisor_id = $2 RETURNING *',
      [req.params.id, req.usuario.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluacion no encontrada o sin permiso' });
    }
    res.json({ mensaje: 'Evaluacion eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar evaluacion' });
  }
});

module.exports = router;