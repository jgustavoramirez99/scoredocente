const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// Mismo criterio que alumnos.js (registro de celular): la auxiliar registra,
// el director también puede entrar por si acaso.
const ROLES_EDITAR = ['auxiliar', 'director'];

function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// GET /api/talla-peso?salon_id=5 — alumnos activos del salón con su talla/peso/edad
// actuales, más un resumen de avance (para el dashboard de ese salón).
router.get('/', verificarToken, permitirRoles(...ROLES_EDITAR), async (req, res) => {
  try {
    const { salon_id } = req.query;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });

    const result = await db.query(
      `SELECT a.id, a.numero, a.apellidos_nombres, a.talla, a.peso, a.edad
       FROM alumnos a
       WHERE a.salon_id = $1 AND a.activo = true
       ORDER BY a.numero`,
      [salon_id]
    );
    const alumnos = result.rows;
    const total = alumnos.length;
    const completos = alumnos.filter(a => a.talla !== null && a.peso !== null).length;

    res.json({
      alumnos,
      resumen: { total, completos, pendientes: total - completos }
    });
  } catch (err) {
    console.error('Error al obtener talla/peso:', err);
    res.status(500).json({ error: 'Error al obtener los alumnos' });
  }
});

// PATCH /api/talla-peso/:id — guarda talla, peso y/o edad de un alumno.
// Acepta actualizar uno, dos o los tres campos a la vez (autoguardado por campo).
router.patch('/:id', verificarToken, permitirRoles(...ROLES_EDITAR), async (req, res) => {
  const { talla, peso, edad } = req.body;

  if (talla !== undefined && talla !== null && talla !== '') {
    const t = Number(talla);
    if (!Number.isFinite(t) || t < 30 || t > 250) {
      return res.status(400).json({ error: 'La talla debe estar entre 30 y 250 cm' });
    }
  }
  if (peso !== undefined && peso !== null && peso !== '') {
    const p = Number(peso);
    if (!Number.isFinite(p) || p < 5 || p > 200) {
      return res.status(400).json({ error: 'El peso debe estar entre 5 y 200 kg' });
    }
  }
  if (edad !== undefined && edad !== null && edad !== '') {
    const e = Number(edad);
    if (!Number.isInteger(e) || e < 0 || e > 25) {
      return res.status(400).json({ error: 'La edad no es válida' });
    }
  }

  const campos = [];
  const valores = [];
  let i = 1;
  if (talla !== undefined) { campos.push(`talla = $${i++}`); valores.push(talla === '' ? null : talla); }
  if (peso !== undefined) { campos.push(`peso = $${i++}`); valores.push(peso === '' ? null : peso); }
  if (edad !== undefined) { campos.push(`edad = $${i++}`); valores.push(edad === '' ? null : edad); }
  if (!campos.length) return res.status(400).json({ error: 'Nada que actualizar' });

  campos.push(`actualizado_por = $${i++}`);
  valores.push(req.usuario.id);
  campos.push('actualizado_en = now()');
  valores.push(req.params.id);

  try {
    const result = await db.query(
      `UPDATE alumnos SET ${campos.join(', ')} WHERE id = $${i} RETURNING id, talla, peso, edad`,
      valores
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Alumno no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al guardar talla/peso:', err);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

module.exports = router;
