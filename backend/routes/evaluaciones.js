    const express = require('express');
    const router = express.Router();
    const db = require('../db');
    const { verificarToken } = require('./auth');

    // POST /api/evaluaciones
    router.post('/', verificarToken, async (req, res) => {
  const { docente_id, dominio_disciplinar, practica_pedagogica, clima_aula, logro_aprendizaje, innovacion, comunicacion_tutoria, observacion } = req.body;

  const puntaje_total = ((dominio_disciplinar + practica_pedagogica + clima_aula + logro_aprendizaje + innovacion + comunicacion_tutoria) / 6).toFixed(2);

  try {
    const result = await db.query(
      `INSERT INTO evaluaciones 
        (docente_id, supervisor_id, dominio_disciplinar, practica_pedagogica, clima_aula, logro_aprendizaje, innovacion, comunicacion_tutoria, observacion, puntaje_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [docente_id, req.usuario.id, dominio_disciplinar, practica_pedagogica, clima_aula, logro_aprendizaje, innovacion, comunicacion_tutoria, observacion, puntaje_total]
    );
    res.json({ ...result.rows[0], promedio: puntaje_total });
  } catch (err) {
    console.error('Error guardando evaluación:', err);
    res.status(500).json({ error: 'Error al guardar evaluación' });
  }
});

router.get('/', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, 
        d.nombre || ' ' || d.apellido AS docente_nombre,
        u.nombre AS instructor_nombre
       FROM evaluaciones e
       JOIN docentes d ON e.docente_id = d.id
       JOIN usuarios u ON e.supervisor_id = u.id
       ORDER BY e.creado_en DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener evaluaciones' });
  }
});

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
    console.error('Error eliminando evaluacion:', err);
    res.status(500).json({ error: 'Error al eliminar evaluacion' });
  }
});
    module.exports = router;