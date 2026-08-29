const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');

// GET /api/docentes/pendientes
router.get('/pendientes', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre, apellido, curso, nivel, tipo, es_tutor
       FROM docentes 
       WHERE activo = true 
       AND id NOT IN (
         SELECT docente_id FROM evaluaciones 
         WHERE supervisor_id = $1
         AND DATE(creado_en) = CURRENT_DATE
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
      'SELECT id, nombre, apellido, curso, nivel, tipo, activo, es_tutor FROM docentes WHERE activo = true ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener docentes' });
  }
});

// GET /api/docentes/historial — activos e inactivos
router.get('/historial', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.id, d.nombre, d.apellido, d.curso, d.nivel, d.tipo, d.activo,
        COUNT(e.id) AS total_evaluaciones,
        MAX(e.creado_en) AS ultima_evaluacion,
        AVG(e.puntaje_total) AS promedio_general
       FROM docentes d
       LEFT JOIN evaluaciones e ON e.docente_id = d.id
       GROUP BY d.id
       ORDER BY d.activo DESC, d.nombre`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// POST /api/docentes
router.post('/', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede agregar docentes' });
  }
  const { nombre, apellido, curso, nivel, tipo } = req.body;
  if (!nombre || !apellido) {
    return res.status(400).json({ error: 'Nombre y apellido son requeridos' });
  }
  try {
    const result = await db.query(
      `INSERT INTO docentes (nombre, apellido, curso, nivel, tipo, activo)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [nombre.trim(), apellido.trim(), curso || '', nivel || 'Primaria', tipo || 'Docente']
    );
    const fila = result.rows[0];

    registrarAuditoria({
      tabla: 'docentes',
      registro_id: fila.id,
      accion: 'crear',
      usuario: req.usuario,
      descripcion: `Docente ${fila.nombre} ${fila.apellido}`,
      datos: fila
    });

    res.json(fila);
  } catch (err) {
    res.status(500).json({ error: 'Error al agregar docente' });
  }
});

// PATCH /api/docentes/:id/desactivar
router.patch('/:id/desactivar', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede desactivar docentes' });
  }
  try {
    const result = await db.query('UPDATE docentes SET activo = false WHERE id = $1 RETURNING *', [req.params.id]);
    const fila = result.rows[0];
    if (fila) {
      registrarAuditoria({
        tabla: 'docentes',
        registro_id: fila.id,
        accion: 'editar',
        usuario: req.usuario,
        descripcion: `Docente desactivado: ${fila.nombre} ${fila.apellido}`,
        datos: fila
      });
    }
    res.json({ mensaje: 'Docente desactivado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al desactivar docente' });
  }
});

// PATCH /api/docentes/:id/activar
router.patch('/:id/activar', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede activar docentes' });
  }
  try {
    const result = await db.query('UPDATE docentes SET activo = true WHERE id = $1 RETURNING *', [req.params.id]);
    const fila = result.rows[0];
    if (fila) {
      registrarAuditoria({
        tabla: 'docentes',
        registro_id: fila.id,
        accion: 'editar',
        usuario: req.usuario,
        descripcion: `Docente reactivado: ${fila.nombre} ${fila.apellido}`,
        datos: fila
      });
    }
    res.json({ mensaje: 'Docente activado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al activar docente' });
  }
});
// PATCH /api/docentes/:id/tutor
router.patch('/:id/tutor', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede asignar tutores' });
  }
  const { es_tutor } = req.body; // true o false
  try {
    const result = await db.query('UPDATE docentes SET es_tutor = $1 WHERE id = $2 RETURNING *', [!!es_tutor, req.params.id]);
    const fila = result.rows[0];
    if (fila) {
      registrarAuditoria({
        tabla: 'docentes',
        registro_id: fila.id,
        accion: 'editar',
        usuario: req.usuario,
        descripcion: `${fila.nombre} ${fila.apellido} — es_tutor: ${!!es_tutor}`,
        datos: fila
      });
    }
    res.json({ mensaje: 'Actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar tutor' });
  }
});

module.exports = router;