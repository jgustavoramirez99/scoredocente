const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');

// Cuenta exacta del Gerente General (mismo correo usado para "Coordinadores").
// Solo esta cuenta puede ver el listado, el detalle y exportar las fichas.
const EMAIL_GERENTE_GENERAL = 'gerentegeneralcervantino@cervantesschool.edu.pe';

function soloGerenteGeneral(req, res, next) {
  if ((req.usuario.email || '').trim().toLowerCase() !== EMAIL_GERENTE_GENERAL.toLowerCase()) {
    return res.status(403).json({ error: 'Solo el Gerente General puede acceder a las fichas de docentes' });
  }
  next();
}

// POST /api/fichas — envío público del formulario (SIN login, lo llena el docente).
// Si el DNI ya existe, actualiza la ficha en vez de crear una duplicada
// (por si el docente vuelve a llenar el formulario para corregir algo).
router.post('/', async (req, res) => {
  const {
    nombres, apellidos, dni, fecha_nacimiento, genero, estado_civil, celular, correo, direccion,
    nivel_educativo, ingles, educacion_secundaria, educacion_tecnica, educacion_universitaria, educacion_postgrado,
    conyuge_nombre, conyuge_dni, hijos,
    sistema_pension, entidad_pension, cuspp, cuenta_bcp,
    foto_base64
  } = req.body;

  if (!nombres || !apellidos || !dni) {
    return res.status(400).json({ error: 'Nombres, apellidos y DNI son requeridos' });
  }

  try {
    const result = await db.query(
      `INSERT INTO fichas_docentes (
        nombres, apellidos, dni, fecha_nacimiento, genero, estado_civil, celular, correo, direccion,
        nivel_educativo, ingles, educacion_secundaria, educacion_tecnica, educacion_universitaria, educacion_postgrado,
        conyuge_nombre, conyuge_dni, hijos,
        sistema_pension, entidad_pension, cuspp, cuenta_bcp, foto_base64, actualizado_en
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, NOW())
      ON CONFLICT (dni) DO UPDATE SET
        nombres = EXCLUDED.nombres,
        apellidos = EXCLUDED.apellidos,
        fecha_nacimiento = EXCLUDED.fecha_nacimiento,
        genero = EXCLUDED.genero,
        estado_civil = EXCLUDED.estado_civil,
        celular = EXCLUDED.celular,
        correo = EXCLUDED.correo,
        direccion = EXCLUDED.direccion,
        nivel_educativo = EXCLUDED.nivel_educativo,
        ingles = EXCLUDED.ingles,
        educacion_secundaria = EXCLUDED.educacion_secundaria,
        educacion_tecnica = EXCLUDED.educacion_tecnica,
        educacion_universitaria = EXCLUDED.educacion_universitaria,
        educacion_postgrado = EXCLUDED.educacion_postgrado,
        conyuge_nombre = EXCLUDED.conyuge_nombre,
        conyuge_dni = EXCLUDED.conyuge_dni,
        hijos = EXCLUDED.hijos,
        sistema_pension = EXCLUDED.sistema_pension,
        entidad_pension = EXCLUDED.entidad_pension,
        cuspp = EXCLUDED.cuspp,
        cuenta_bcp = EXCLUDED.cuenta_bcp,
        foto_base64 = COALESCE(EXCLUDED.foto_base64, fichas_docentes.foto_base64),
        actualizado_en = NOW()
      RETURNING id`,
      [
        nombres.trim(), apellidos.trim(), dni.trim(), fecha_nacimiento || null, genero || null, estado_civil || null,
        celular || null, correo || null, direccion || null, nivel_educativo || null, ingles || null,
        educacion_secundaria || null, educacion_tecnica || null, educacion_universitaria || null, educacion_postgrado || null,
        conyuge_nombre || null, conyuge_dni || null, JSON.stringify(Array.isArray(hijos) ? hijos : []),
        sistema_pension || null, entidad_pension || null, cuspp || null, cuenta_bcp || null, foto_base64 || null
      ]
    );
    res.json({ mensaje: 'Datos guardados correctamente', id: result.rows[0].id });
  } catch (err) {
    console.error('Error al guardar ficha de docente:', err);
    res.status(500).json({ error: 'Error al guardar los datos', detalle: err.message });
  }
});

// GET /api/fichas/export/csv — exportar todo (antes que "/:id" para que no choque la ruta)
router.get('/export/csv', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM fichas_docentes ORDER BY apellidos, nombres');
    const columnas = [
      'id', 'nombres', 'apellidos', 'dni', 'fecha_nacimiento', 'genero', 'estado_civil', 'celular', 'correo', 'direccion',
      'nivel_educativo', 'ingles', 'educacion_secundaria', 'educacion_tecnica', 'educacion_universitaria', 'educacion_postgrado',
      'conyuge_nombre', 'conyuge_dni', 'sistema_pension', 'entidad_pension', 'cuspp', 'cuenta_bcp', 'procesado', 'creado_en'
    ];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      return `"${String(v).replace(/"/g, '""')}"`;
    };
    const filas = [columnas.join(',')];
    result.rows.forEach(r => filas.push(columnas.map(c => esc(r[c])).join(',')));
    const csv = '﻿' + filas.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fichas_docentes.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Error al exportar fichas:', err);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

// GET /api/fichas/export/data — todas las fichas en JSON, sin la foto (pesa
// mucho y no hace falta para el reporte), para armar el Excel/PDF masivo
// desde el navegador (antes que "/:id" para que no choque la ruta).
router.get('/export/data', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT nombres, apellidos, dni, fecha_nacimiento, genero, estado_civil, celular, correo, direccion,
        nivel_educativo, ingles, educacion_secundaria, educacion_tecnica, educacion_universitaria, educacion_postgrado,
        conyuge_nombre, conyuge_dni, hijos, sistema_pension, entidad_pension, cuspp, cuenta_bcp,
        procesado, creado_en
       FROM fichas_docentes ORDER BY apellidos, nombres`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al exportar datos de fichas:', err);
    res.status(500).json({ error: 'Error al exportar' });
  }
});

// GET /api/fichas/stats/niveles — conteo de fichas por nivel educativo,
// para el grafico de dona y las tarjetas de "Titulados / con estudios
// universitarios / tecnicos / postgrado" del panel (antes que "/:id" para
// que no choque la ruta, igual que /export/csv y /export/data).
router.get('/stats/niveles', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT nivel_educativo, COUNT(*)::int AS total
       FROM fichas_docentes
       GROUP BY nivel_educativo`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener estadisticas de nivel educativo:', err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// GET /api/fichas — listado con filtros (solo Gerente General)
router.get('/', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const { buscar, estado, niveles } = req.query;
    const params = [];
    const where = [];
    if (buscar) {
      params.push(`%${buscar.toLowerCase()}%`);
      where.push(`(LOWER(nombres) LIKE $${params.length} OR LOWER(apellidos) LIKE $${params.length} OR dni LIKE $${params.length})`);
    }
    if (estado === 'procesado') where.push('procesado = true');
    if (estado === 'pendiente') where.push('procesado = false');
    // Filtro por nivel educativo: lista separada por comas de valores exactos
    // de nivel_educativo (viene de las tarjetas/dona de "Fichas de
    // Docentes"). Puede ser uno solo o varios, por ejemplo "Titulados" junta
    // Universitario - Titulado + Postgrado - Maestria + Postgrado - Doctorado.
    if (niveles) {
      const listaNiveles = niveles.split(',').map(s => s.trim()).filter(Boolean);
      if (listaNiveles.length) {
        params.push(listaNiveles);
        where.push(`nivel_educativo = ANY($${params.length})`);
      }
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
      `SELECT id, nombres, apellidos, dni, celular, correo, nivel_educativo, procesado, creado_en, actualizado_en,
        (foto_base64 IS NOT NULL) AS tiene_foto
       FROM fichas_docentes ${whereSql}
       ORDER BY apellidos, nombres`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar fichas:', err);
    res.status(500).json({ error: 'Error al obtener las fichas' });
  }
});

// GET /api/fichas/:id — detalle completo (solo Gerente General)
router.get('/:id', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM fichas_docentes WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Ficha no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener ficha:', err);
    res.status(500).json({ error: 'Error al obtener la ficha' });
  }
});

// PATCH /api/fichas/:id/procesado — marcar/desmarcar como revisado
router.patch('/:id/procesado', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const { procesado } = req.body;
    const result = await db.query(
      'UPDATE fichas_docentes SET procesado = $1 WHERE id = $2 RETURNING *',
      [!!procesado, req.params.id]
    );
    const fila = result.rows[0];
    if (!fila) return res.status(404).json({ error: 'Ficha no encontrada' });

    registrarAuditoria({
      tabla: 'fichas_docentes',
      registro_id: fila.id,
      accion: 'editar',
      usuario: req.usuario,
      descripcion: `Ficha de ${fila.nombres} ${fila.apellidos} marcada como ${fila.procesado ? 'procesada' : 'pendiente'}`,
      datos: { procesado: fila.procesado }
    });

    res.json({ mensaje: 'Actualizado correctamente' });
  } catch (err) {
    console.error('Error al actualizar ficha:', err);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// PATCH /api/fichas/:id/foto — el Gerente General sube o reemplaza la foto
// de una ficha ya existente (por ejemplo cuando el docente no pudo subirla
// ella misma porque su link había vencido).
router.patch('/:id/foto', verificarToken, soloGerenteGeneral, async (req, res) => {
  const { foto_base64 } = req.body;
  if (!foto_base64 || typeof foto_base64 !== 'string' || !foto_base64.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Debes enviar una imagen válida' });
  }
  if (foto_base64.length > 6 * 1024 * 1024) {
    return res.status(400).json({ error: 'La imagen es demasiado grande' });
  }
  try {
    const result = await db.query(
      'UPDATE fichas_docentes SET foto_base64 = $1, actualizado_en = NOW() WHERE id = $2 RETURNING id, nombres, apellidos',
      [foto_base64, req.params.id]
    );
    const fila = result.rows[0];
    if (!fila) return res.status(404).json({ error: 'Ficha no encontrada' });

    registrarAuditoria({
      tabla: 'fichas_docentes',
      registro_id: fila.id,
      accion: 'editar',
      usuario: req.usuario,
      descripcion: `Foto de ${fila.nombres} ${fila.apellidos} subida manualmente por el Gerente General`,
      datos: {}
    });

    res.json({ mensaje: 'Foto actualizada correctamente' });
  } catch (err) {
    console.error('Error al actualizar foto de ficha:', err);
    res.status(500).json({ error: 'Error al actualizar la foto' });
  }
});

module.exports = router;
