const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// Solo la psicóloga (y el director, como respaldo, igual que en otras rutas)
// puede ver o editar esta lista.
const ROLES_PERMITIDOS = ['psicologa', 'director'];

function permitirRoles(req, res, next) {
  if (!ROLES_PERMITIDOS.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  }
  next();
}

// GET /api/psico-alumnos — lista completa. Es una lista viva (no un
// historial por fecha), así que siempre se trae todo; el filtro por fecha
// se aplica en el frontend sobre estos mismos datos.
router.get('/', verificarToken, permitirRoles, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre, grado, competencias, observacion, responsable, fecha, orden
       FROM psico_alumnos_seguimiento
       ORDER BY orden, id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar alumnos de psicología:', err);
    res.status(500).json({ error: 'Error al obtener la lista' });
  }
});

// POST /api/psico-alumnos/guardar — reemplaza la lista completa en una
// transacción: actualiza los que traen id, inserta los nuevos (sin id) y
// borra los que ya no vienen en el arreglo (el alumno se quitó en el panel).
router.post('/guardar', verificarToken, permitirRoles, async (req, res) => {
  const { alumnos } = req.body;
  if (!Array.isArray(alumnos)) {
    return res.status(400).json({ error: 'Formato inválido' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const idsActuales = alumnos.filter(a => a.id).map(a => a.id);
    if (idsActuales.length) {
      await client.query('DELETE FROM psico_alumnos_seguimiento WHERE id != ALL($1::int[])', [idsActuales]);
    } else {
      await client.query('DELETE FROM psico_alumnos_seguimiento');
    }

    for (let i = 0; i < alumnos.length; i++) {
      const a = alumnos[i];
      const nombre = (a.nombre || '').trim();
      if (!nombre) continue;
      const grado = (a.grado || '').trim() || null;
      const competencias = (a.competencias || '').trim() || null;
      const observacion = (a.observacion || '').trim() || null;
      const responsable = (a.responsable || '').trim() || null;
      const fecha = a.fecha || null;

      if (a.id) {
        await client.query(
          `UPDATE psico_alumnos_seguimiento
           SET nombre=$1, grado=$2, competencias=$3, observacion=$4, responsable=$5, fecha=$6, orden=$7, actualizado_en=NOW()
           WHERE id=$8`,
          [nombre, grado, competencias, observacion, responsable, fecha, i, a.id]
        );
      } else {
        await client.query(
          `INSERT INTO psico_alumnos_seguimiento (nombre, grado, competencias, observacion, responsable, fecha, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [nombre, grado, competencias, observacion, responsable, fecha, i]
        );
      }
    }

    await client.query('COMMIT');

    const result = await db.query(
      `SELECT id, nombre, grado, competencias, observacion, responsable, fecha, orden
       FROM psico_alumnos_seguimiento ORDER BY orden, id`
    );
    res.json({ mensaje: 'Lista guardada correctamente', alumnos: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al guardar lista de alumnos de psicología:', err);
    res.status(500).json({ error: 'Error al guardar', detalle: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
