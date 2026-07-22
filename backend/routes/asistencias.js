const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

const ROLES_PERMITIDOS = ['auxiliar', 'director']; // pueden ver/registrar asistencia
const ROLES_REPORTE = ['director']; // solo Gerente General ve el reporte/historial completo

function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// Fecha de HOY en formato YYYY-MM-DD, usando la zona horaria de Perú (America/Lima)
// (antes usaba la hora del servidor, que en Render corre en UTC y causaba
// que el backend pensara que ya era "otro día" cuando en Perú aún no lo era)
function hoyISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date());
}

// GET /api/asistencias?salon_id=5&fecha=2026-07-19
// Devuelve el listado de alumnos del salón con su registro de asistencia de esa fecha (si existe)
router.get('/', verificarToken, permitirRoles(...ROLES_PERMITIDOS), async (req, res) => {
  try {
    const { salon_id } = req.query;
    if (!salon_id) return res.status(400).json({ error: 'salon_id es requerido' });
    const fecha = req.query.fecha || hoyISO();

    // El auxiliar SOLO puede ver/registrar el día de hoy
    if (req.usuario.rol === 'auxiliar' && fecha !== hoyISO()) {
      return res.status(403).json({ error: 'El auxiliar solo puede ver y registrar la asistencia del día de hoy' });
    }

    const result = await db.query(
      `SELECT a.id AS alumno_id, a.numero, a.apellidos_nombres, a.celular_apoderado,
              asi.estado, asi.observacion
       FROM alumnos a
       LEFT JOIN asistencias asi ON asi.alumno_id = a.id AND asi.fecha = $2
       WHERE a.salon_id = $1 AND a.activo = true
       ORDER BY a.numero`,
      [salon_id, fecha]
    );
    res.json({ fecha, alumnos: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la asistencia' });
  }
});

// POST /api/asistencias — crea o actualiza el registro de un alumno en una fecha (upsert)
// El auxiliar SIEMPRE registra en la fecha de HOY (se ignora cualquier fecha que mande el cliente).
// El director SÍ puede mandar una fecha distinta, para corregir días pasados.
router.post('/', verificarToken, permitirRoles(...ROLES_PERMITIDOS), async (req, res) => {
  try {
    const { alumno_id, estado, observacion } = req.body;
    if (!alumno_id) return res.status(400).json({ error: 'alumno_id es requerido' });

    let fecha = req.body.fecha;
    if (req.usuario.rol === 'auxiliar' || !fecha) {
      fecha = hoyISO();
    }

    const result = await db.query(
      `INSERT INTO asistencias (alumno_id, fecha, estado, observacion, registrado_por, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (alumno_id, fecha)
       DO UPDATE SET estado = $3, observacion = $4, actualizado_por = $5, actualizado_en = now()
       RETURNING *`,
      [alumno_id, fecha, estado || null, observacion || null, req.usuario.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar la asistencia' });
  }
});

// GET /api/asistencias/reporte?desde=&hasta=&salon_id= — historial completo, SOLO Gerente General
router.get('/reporte', verificarToken, permitirRoles(...ROLES_REPORTE), async (req, res) => {
  try {
    const { desde, hasta, salon_id } = req.query;
    const params = [];
    const where = [];
    if (desde) { params.push(desde); where.push(`asi.fecha >= $${params.length}`); }
    if (hasta) { params.push(hasta); where.push(`asi.fecha <= $${params.length}`); }
    if (salon_id) { params.push(salon_id); where.push(`a.salon_id = $${params.length}`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await db.query(
      `SELECT asi.fecha, asi.estado, asi.observacion, asi.actualizado_en,
              a.numero, a.apellidos_nombres, a.celular_apoderado,
              s.nombre AS salon
       FROM asistencias asi
       JOIN alumnos a ON a.id = asi.alumno_id
       JOIN salones s ON s.id = a.salon_id
       ${whereSql}
       ORDER BY asi.fecha DESC, s.orden, a.numero`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al generar el reporte de asistencia' });
  }
});

module.exports = router;