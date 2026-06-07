const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// GET /api/docentes/pendientes  ← NUEVO
router.get('/pendientes', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre, apellido, curso, nivel 
       FROM docentes 
       WHERE activo = true 
       AND id NOT IN (
         SELECT docente_id FROM evaluaciones WHERE supervisor_id = $1
       )
       ORDER BY nombre`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener docentes pendientes' });
  }
});
// GET /api/docentes
router.get('/', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, nombre, apellido, curso, nivel, activo FROM docentes WHERE activo = true ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo docentes:', err);
    res.status(500).json({ error: 'Error al obtener docentes' });
  }
});

module.exports = router;