const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');

// "Reporte Cubicol" — por ahora (a pedido de Gustavo) solo el Gerente
// General puede subirlo y verlo, igual que Coordinadores/Fichas/Reporte
// Total. Más adelante el encargado de generarlo lo subirá desde su propia
// cuenta y lo podrán ver el Gerente General y los demás directivos.
const EMAIL_GERENTE_GENERAL = 'gerentegeneralcervantino@cervantesschool.edu.pe';

function soloGerenteGeneral(req, res, next) {
  if ((req.usuario.email || '').trim().toLowerCase() !== EMAIL_GERENTE_GENERAL.toLowerCase()) {
    return res.status(403).json({ error: 'Solo el Gerente General puede acceder al Reporte Cubicol' });
  }
  next();
}

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB del PDF original (antes de base64)

// GET /api/reporte-cubicol — lista (sin el contenido, para no pesar el listado)
router.get('/', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre_archivo, tamano_bytes, subido_por_nombre, subido_por_email, creado_en
       FROM reporte_cubicol_pdfs ORDER BY creado_en DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar Reporte Cubicol:', err);
    res.status(500).json({ error: 'Error al listar los reportes' });
  }
});

// GET /api/reporte-cubicol/:id — trae el PDF completo (base64) para visualizarlo
router.get('/:id', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre_archivo, archivo_base64 FROM reporte_cubicol_pdfs WHERE id = $1`,
      [req.params.id]
    );
    const fila = result.rows[0];
    if (!fila) return res.status(404).json({ error: 'Reporte no encontrado' });
    res.json(fila);
  } catch (err) {
    console.error('Error al obtener Reporte Cubicol:', err);
    res.status(500).json({ error: 'Error al obtener el reporte' });
  }
});

// POST /api/reporte-cubicol — sube un PDF nuevo
router.post('/', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const { nombre_archivo, archivo_base64 } = req.body;
    if (!archivo_base64 || typeof archivo_base64 !== 'string' || !archivo_base64.startsWith('data:application/pdf;base64,')) {
      return res.status(400).json({ error: 'El archivo debe ser un PDF válido' });
    }
    const datosBase64 = archivo_base64.split(',')[1] || '';
    const buffer = Buffer.from(datosBase64, 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ error: 'El archivo está vacío o no se pudo leer' });
    }
    if (buffer.slice(0, 4).toString('latin1') !== '%PDF') {
      return res.status(400).json({ error: 'El archivo no es un PDF válido' });
    }
    if (buffer.length > TAMANO_MAXIMO_BYTES) {
      return res.status(413).json({ error: 'El PDF pesa demasiado (máximo 10MB). Comprime el archivo e inténtalo de nuevo.' });
    }

    const result = await db.query(
      `INSERT INTO reporte_cubicol_pdfs
         (nombre_archivo, archivo_base64, tamano_bytes, subido_por_id, subido_por_nombre, subido_por_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre_archivo, tamano_bytes, subido_por_nombre, subido_por_email, creado_en`,
      [
        (nombre_archivo || 'reporte-cubicol.pdf').slice(0, 255),
        archivo_base64,
        buffer.length,
        req.usuario.id,
        req.usuario.nombre || null,
        req.usuario.email || null
      ]
    );

    const fila = result.rows[0];
    registrarAuditoria({
      tabla: 'reporte_cubicol_pdfs',
      registro_id: fila.id,
      accion: 'crear',
      usuario: req.usuario,
      descripcion: `Subió el Reporte Cubicol "${fila.nombre_archivo}"`,
      datos: { tamano_bytes: fila.tamano_bytes }
    });

    res.json(fila);
  } catch (err) {
    console.error('Error al subir Reporte Cubicol:', err);
    res.status(500).json({ error: 'Error al subir el reporte' });
  }
});

// DELETE /api/reporte-cubicol/:id — por si se subió el archivo equivocado
router.delete('/:id', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM reporte_cubicol_pdfs WHERE id = $1 RETURNING id, nombre_archivo`,
      [req.params.id]
    );
    const fila = result.rows[0];
    if (!fila) return res.status(404).json({ error: 'Reporte no encontrado' });

    registrarAuditoria({
      tabla: 'reporte_cubicol_pdfs',
      registro_id: fila.id,
      accion: 'eliminar',
      usuario: req.usuario,
      descripcion: `Eliminó el Reporte Cubicol "${fila.nombre_archivo}"`
    });

    res.json({ mensaje: 'Reporte eliminado correctamente' });
  } catch (err) {
    console.error('Error al eliminar Reporte Cubicol:', err);
    res.status(500).json({ error: 'Error al eliminar el reporte' });
  }
});

module.exports = router;
