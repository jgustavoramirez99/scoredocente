const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// GET /api/mensajes/contactos — todas las cuentas activas (menos uno mismo),
// para elegir a quién escribir. Cualquier cuenta puede ver esta lista.
router.get('/contactos', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre, rol FROM usuarios WHERE activo = true AND id != $1 ORDER BY nombre`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener contactos:', err);
    res.status(500).json({ error: 'Error al obtener contactos' });
  }
});

// GET /api/mensajes/resumen — cuántos mensajes sin leer hay, por contacto
// directo y en los generales (para el globito de notificación).
router.get('/resumen', verificarToken, async (req, res) => {
  try {
    const directos = await db.query(
      `SELECT m.remitente_id AS contacto_id, COUNT(*)::int AS no_leidos
       FROM mensajes m
       LEFT JOIN mensajes_leidos l ON l.mensaje_id = m.id AND l.usuario_id = $1
       WHERE m.destinatario_id = $1 AND l.mensaje_id IS NULL
       GROUP BY m.remitente_id`,
      [req.usuario.id]
    );
    const generales = await db.query(
      `SELECT COUNT(*)::int AS no_leidos
       FROM mensajes m
       LEFT JOIN mensajes_leidos l ON l.mensaje_id = m.id AND l.usuario_id = $1
       WHERE m.destinatario_id IS NULL AND m.remitente_id != $1 AND l.mensaje_id IS NULL`,
      [req.usuario.id]
    );
    res.json({
      directos: directos.rows,
      generales: generales.rows[0].no_leidos
    });
  } catch (err) {
    console.error('Error al obtener resumen de mensajes:', err);
    res.status(500).json({ error: 'Error al obtener resumen de mensajes' });
  }
});

// GET /api/mensajes/conversacion/:contactoId — historial entre yo y ese
// contacto (en ambos sentidos), y de paso los marca como leídos.
router.get('/conversacion/:contactoId', verificarToken, async (req, res) => {
  const contactoId = parseInt(req.params.contactoId, 10);
  if (!contactoId) return res.status(400).json({ error: 'Contacto inválido' });
  try {
    const result = await db.query(
      `SELECT m.id, m.remitente_id, m.destinatario_id, m.texto, m.creado_en, u.nombre AS remitente_nombre
       FROM mensajes m JOIN usuarios u ON u.id = m.remitente_id
       WHERE (m.remitente_id = $1 AND m.destinatario_id = $2)
          OR (m.remitente_id = $2 AND m.destinatario_id = $1)
       ORDER BY m.creado_en ASC LIMIT 300`,
      [req.usuario.id, contactoId]
    );
    await db.query(
      `INSERT INTO mensajes_leidos (mensaje_id, usuario_id)
       SELECT m.id, $1 FROM mensajes m
       WHERE m.destinatario_id = $1 AND m.remitente_id = $2
       ON CONFLICT DO NOTHING`,
      [req.usuario.id, contactoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener conversación:', err);
    res.status(500).json({ error: 'Error al obtener conversación' });
  }
});

// GET /api/mensajes/generales — mensajes dirigidos a todas las cuentas.
router.get('/generales', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.id, m.remitente_id, m.destinatario_id, m.texto, m.creado_en, u.nombre AS remitente_nombre
       FROM mensajes m JOIN usuarios u ON u.id = m.remitente_id
       WHERE m.destinatario_id IS NULL
       ORDER BY m.creado_en ASC LIMIT 300`
    );
    await db.query(
      `INSERT INTO mensajes_leidos (mensaje_id, usuario_id)
       SELECT m.id, $1 FROM mensajes m
       WHERE m.destinatario_id IS NULL
       ON CONFLICT DO NOTHING`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener mensajes generales:', err);
    res.status(500).json({ error: 'Error al obtener mensajes generales' });
  }
});

// POST /api/mensajes — enviar. Sin destinatario_id (o null) = mensaje
// general para todas las cuentas.
router.post('/', verificarToken, async (req, res) => {
  const texto = (req.body.texto || '').toString().trim();
  const destinatarioId = req.body.destinatario_id ? parseInt(req.body.destinatario_id, 10) : null;
  if (!texto) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  if (texto.length > 2000) return res.status(400).json({ error: 'El mensaje es demasiado largo (máximo 2000 caracteres)' });

  try {
    const result = await db.query(
      `INSERT INTO mensajes (remitente_id, destinatario_id, texto)
       VALUES ($1, $2, $3)
       RETURNING id, remitente_id, destinatario_id, texto, creado_en`,
      [req.usuario.id, destinatarioId, texto]
    );
    // Ya lo leyó quien lo mandó (para que no le aparezca como no-leído a sí mismo).
    await db.query(
      `INSERT INTO mensajes_leidos (mensaje_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [result.rows[0].id, req.usuario.id]
    );
    res.json({ ...result.rows[0], remitente_nombre: req.usuario.nombre });
  } catch (err) {
    console.error('Error al enviar mensaje:', err);
    res.status(500).json({ error: 'Error al enviar el mensaje' });
  }
});

module.exports = router;
