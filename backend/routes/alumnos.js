const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// Roles que pueden VER/EDITAR el listado de alumnos por salón (para registrar celulares)
const ROLES_AUXILIAR = ['auxiliar', 'director']; // director también puede, por si acaso

// Roles que pueden ver el REPORTE completo (solo Gerente General)
const ROLES_REPORTE = ['director'];

function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// GET /api/alumnos/salones — catálogo de salones (para el select del auxiliar)
router.get('/salones', verificarToken, permitirRoles(...ROLES_AUXILIAR, ...ROLES_REPORTE), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, nombre, grado, seccion, nivel FROM salones ORDER BY orden'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener salones' });
  }
});

// GET /api/alumnos?salon_id=5 — listado de alumnos de un salón (para editar celular)
router.get('/', verificarToken, permitirRoles(...ROLES_AUXILIAR, ...ROLES_REPORTE), async (req, res) => {
  try {
    const { salon_id } = req.query;
    const params = [];
    let where = '';
    if (salon_id) {
      params.push(salon_id);
      where = `WHERE a.salon_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT a.id, a.numero, a.apellidos_nombres, a.celular_apoderado, a.activo,
              s.nombre AS salon, s.grado, s.seccion
       FROM alumnos a
       JOIN salones s ON s.id = a.salon_id
       ${where}
       ORDER BY s.orden, a.numero`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener alumnos' });
  }
});

// PATCH /api/alumnos/:id/celular — agregar o editar el celular del apoderado
// Solo lo puede hacer el rol "auxiliar" (o el director, como respaldo)
router.patch('/:id/celular', verificarToken, permitirRoles(...ROLES_AUXILIAR), async (req, res) => {
  const { celular_apoderado } = req.body;
  try {
    const anterior = await db.query('SELECT celular_apoderado FROM alumnos WHERE id = $1', [req.params.id]);
    if (anterior.rows.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado' });
    }
    const result = await db.query(
      `UPDATE alumnos
       SET celular_apoderado = $1, actualizado_por = $2, actualizado_en = now()
       WHERE id = $3 RETURNING *`,
      [(celular_apoderado || '').trim() || null, req.usuario.id, req.params.id]
    );

    // Registro de auditoría (opcional, no rompe si falla)
    try {
      await db.query(
        `INSERT INTO alumnos_historial (alumno_id, celular_anterior, celular_nuevo, cambiado_por)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, anterior.rows[0].celular_apoderado, celular_apoderado || null, req.usuario.id]
      );
    } catch (e) { /* tabla historial es opcional */ }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar celular' });
  }
});

// GET /api/alumnos/reporte — reporte completo, SOLO Gerente General (rol 'director')
router.get('/reporte', verificarToken, permitirRoles(...ROLES_REPORTE), async (req, res) => {
  try {
    const resumen = await db.query(
      `SELECT s.id AS salon_id, s.nombre AS salon, s.grado, s.seccion, s.nivel,
              COUNT(a.id) AS total_alumnos,
              COUNT(a.celular_apoderado) AS con_celular,
              COUNT(a.id) - COUNT(a.celular_apoderado) AS sin_celular
       FROM salones s
       LEFT JOIN alumnos a ON a.salon_id = s.id AND a.activo = true
       GROUP BY s.id
       ORDER BY s.orden`
    );

    const detalle = await db.query(
      `SELECT a.id, a.numero, a.apellidos_nombres, a.celular_apoderado,
              s.nombre AS salon, s.grado, s.seccion
       FROM alumnos a
       JOIN salones s ON s.id = a.salon_id
       WHERE a.activo = true
       ORDER BY s.orden, a.numero`
    );

    res.json({ resumen: resumen.rows, detalle: detalle.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

module.exports = router;
