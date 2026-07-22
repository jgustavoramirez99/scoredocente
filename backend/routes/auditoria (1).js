const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// GET /api/auditoria/usuarios — lista simple de usuarios para el filtro del panel
router.get('/usuarios', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede ver la auditoría' });
  }
  try {
    const result = await db.query(
      `SELECT DISTINCT u.id, u.nombre
       FROM auditoria a
       JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY u.nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener usuarios de auditoría:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// GET /api/auditoria?usuario_id=&tabla=&accion=&desde=&hasta=
// Solo el director puede ver el registro de actividad del sistema.
router.get('/', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede ver la auditoría' });
  }
  try {
    const { usuario_id, tabla, accion, desde, hasta } = req.query;
    const params = [];
    const where = [];

    if (usuario_id) { params.push(usuario_id); where.push(`a.usuario_id = $${params.length}`); }
    if (tabla)      { params.push(tabla);      where.push(`a.tabla = $${params.length}`); }
    if (accion)     { params.push(accion);     where.push(`a.accion = $${params.length}`); }
    if (desde)      { params.push(desde);      where.push(`a.creado_en >= $${params.length}`); }
    if (hasta)      { params.push(hasta);      where.push(`a.creado_en <= $${params.length}::date + interval '1 day'`); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await db.query(
      `SELECT a.*
       FROM auditoria a
       ${whereSql}
       ORDER BY a.creado_en DESC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener auditoría:', err);
    res.status(500).json({ error: 'Error al obtener la auditoría' });
  }
});

module.exports = router;
