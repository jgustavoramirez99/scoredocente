// routes/informes.js
// Informes guardados (snapshots en JSON) que el frontend muestra como dashboard.
// Acceso: solo Director/Directora y Gerente General (contienen nombres de menores).
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');

const EMAIL_GERENTE_GENERAL = 'gerentegeneralcervantino@cervantesschool.edu.pe';
const ROLES = ['director', 'directora'];

function puedeVer(req, res, next) {
  const esGerente = (req.usuario.email || '').trim().toLowerCase() === EMAIL_GERENTE_GENERAL;
  if (ROLES.includes(req.usuario.rol) || esGerente) return next();
  return res.status(403).json({ error: 'No autorizado para ver los informes' });
}

function validar(b) {
  if (!b || typeof b !== 'object') return 'Archivo de informe inválido';
  if (b.version !== 1) return 'Versión de informe no soportada';
  if (typeof b.titulo !== 'string' || !b.titulo.trim()) return 'El informe no tiene título';
  if (b.fecha != null && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return 'Fecha inválida (use AAAA-MM-DD)';
  if (!b.resumen || typeof b.resumen.conteos !== 'object') return 'Falta el resumen del informe';
  if (!Array.isArray(b.alumnos)) return 'Falta la lista de alumnos';
  return null;
}

router.get('/', verificarToken, puedeVer, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, titulo, tipo, to_char(fecha_informe,'YYYY-MM-DD') AS fecha_informe, subido_por_nombre, creado_en,
              datos->'resumen'->'conteos' AS conteos,
              datos->'resumen'->'total_alumnos' AS total_alumnos
       FROM informes_guardados ORDER BY fecha_informe DESC NULLS LAST, id DESC`);
    res.json(r.rows);
  } catch (err) {
    console.error('Error en GET /api/informes:', err);
    res.status(500).json({ error: 'Error al listar los informes' });
  }
});

router.get('/:id', verificarToken, puedeVer, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await db.query('SELECT id, titulo, tipo, to_char(fecha_informe,'YYYY-MM-DD') AS fecha_informe, subido_por_nombre, creado_en, datos FROM informes_guardados WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Informe no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Error en GET /api/informes/:id:', err);
    res.status(500).json({ error: 'Error al abrir el informe' });
  }
});

router.post('/', verificarToken, puedeVer, async (req, res) => {
  const b = req.body;
  const error = validar(b);
  if (error) return res.status(400).json({ error });
  try {
    const r = await db.query(
      `INSERT INTO informes_guardados (titulo, tipo, fecha_informe, datos, subido_por_id, subido_por_nombre)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [b.titulo.trim().slice(0, 255), String(b.tipo || 'diagnostico').slice(0, 50), b.fecha || null,
       JSON.stringify(b), req.usuario.id, req.usuario.nombre || req.usuario.email || null]);
    await registrarAuditoria({ tabla: 'informes_guardados', registro_id: r.rows[0].id, accion: 'crear',
      usuario: req.usuario, descripcion: `Subió el informe "${b.titulo.trim()}"` });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    console.error('Error en POST /api/informes:', err);
    res.status(500).json({ error: 'Error al guardar el informe' });
  }
});

router.delete('/:id', verificarToken, puedeVer, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await db.query('DELETE FROM informes_guardados WHERE id = $1 RETURNING titulo', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Informe no encontrado' });
    await registrarAuditoria({ tabla: 'informes_guardados', registro_id: id, accion: 'eliminar',
      usuario: req.usuario, descripcion: `Eliminó el informe "${r.rows[0].titulo}"` });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en DELETE /api/informes/:id:', err);
    res.status(500).json({ error: 'Error al eliminar el informe' });
  }
});

module.exports = router;
module.exports._test = { validar };
