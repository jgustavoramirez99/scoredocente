const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM usuarios WHERE email = $1 AND activo = true',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const usuario = result.rows[0];
    const passwordValida = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
      }
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Middleware para verificar token
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.usuario = usuario;
    next();
  });
}
// GET /api/auth/usuarios (solo director)

router.get('/usuarios', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede ver usuarios' });
  }
  try {
    const result = await db.query('SELECT id, nombre, email, rol, activo FROM usuarios');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});
// POST /api/auth/usuarios — crear usuario (solo director)
router.post('/usuarios', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Solo el director puede crear usuarios' });
  }
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  try {
    const existe = await db.query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase().trim()]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
       VALUES ($1, $2, $3, $4, true) RETURNING id, nombre, email, rol, activo`,
      [nombre.trim(), email.toLowerCase().trim(), hash, rol]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// PATCH /api/auth/usuarios/:id/desactivar
router.patch('/usuarios/:id/desactivar', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'director') {
    return res.status(403).json({ error: 'Sin permiso' });
  }
  try {
    await db.query('UPDATE usuarios SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Usuario desactivado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al desactivar usuario' });
  }
});
module.exports = { router, verificarToken };