const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// Roles que pueden VER los resultados (solo lectura)
const ROLES_LECTURA = ['director', 'directora', 'coordinador_general'];
// Rol que registra las evaluaciones
const ROL_EVALUADOR = 'psicologa';

const CAMPOS_IND = [
  'planif_ind1','planif_ind2','planif_ind3','planif_ind4','planif_ind5',
  'sesion_ind1','sesion_ind2','sesion_ind3','sesion_ind4','sesion_ind5',
  'acomp_ind1','acomp_ind2','acomp_ind3','acomp_ind4','acomp_ind5',
  'padres_ind1','padres_ind2','padres_ind3','padres_ind4','padres_ind5',
  'present_ind1','present_ind2','present_ind3','present_ind4','present_ind5'
];

// GET /api/evaluaciones-tutor/pendientes
// Solo docentes marcados como tutor (es_tutor = true) y que el supervisor
// aún no evaluó hoy en esta ficha (tabla separada de la ficha regular).
router.get('/pendientes', verificarToken, async (req, res) => {
  if (req.usuario.rol !== ROL_EVALUADOR) {
    return res.status(403).json({ error: 'Solo la psicóloga puede ver esta lista' });
  }
  try {
    const result = await db.query(
      `SELECT id, nombre, apellido, curso, nivel, tipo
       FROM docentes
       WHERE activo = true
       AND es_tutor = true
       AND id NOT IN (
         SELECT docente_id FROM evaluaciones_tutor
         WHERE supervisor_id = $1
         AND DATE(creado_en) = CURRENT_DATE
       )
       ORDER BY nombre`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener tutores pendientes' });
  }
});

// GET /api/evaluaciones-tutor/mias
router.get('/mias', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT et.*, d.nombre || ' ' || d.apellido AS docente_nombre
       FROM evaluaciones_tutor et
       JOIN docentes d ON d.id = et.docente_id
       WHERE et.supervisor_id = $1
       ORDER BY et.creado_en DESC`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener evaluaciones de tutoría' });
  }
});

// GET /api/evaluaciones-tutor  (todas, para el director)
router.get('/', verificarToken, async (req, res) => {
  if (!ROLES_LECTURA.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No autorizado para ver estos resultados' });
  }
  try {
    const result = await db.query(
      `SELECT et.*, d.nombre || ' ' || d.apellido AS docente_nombre
       FROM evaluaciones_tutor et
       JOIN docentes d ON d.id = et.docente_id
       ORDER BY et.creado_en DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener evaluaciones de tutoría' });
  }
});

// GET /api/evaluaciones-tutor/:id
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT et.*, d.nombre || ' ' || d.apellido AS docente_nombre
       FROM evaluaciones_tutor et
       JOIN docentes d ON d.id = et.docente_id
       WHERE et.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener evaluación' });
  }
});

// POST /api/evaluaciones-tutor
router.post('/', verificarToken, async (req, res) => {
  if (req.usuario.rol !== ROL_EVALUADOR) {
    return res.status(403).json({ error: 'Solo la psicóloga puede registrar esta evaluación' });
  }
  const b = req.body;

  // Validar que todos los indicadores lleguen marcados
  const faltantes = CAMPOS_IND.filter(c => b[c] === undefined || b[c] === null);
  if (faltantes.length) {
    return res.status(400).json({ error: 'Faltan indicadores: ' + faltantes.join(', ') });
  }

  const suma = c => CAMPOS_IND
    .filter(k => k.startsWith(c))
    .reduce((acc, k) => acc + (parseInt(b[k]) || 0), 0);

  const puntaje_total =
    suma('planif') + suma('sesion') + suma('acomp') + suma('padres') + suma('present');
  // (máximo posible: 100, ya que cada sección suma hasta 20)

  try {
    const cols = ['docente_id', 'supervisor_id', 'fecha_eval', 'hora_eval',
      ...CAMPOS_IND,
      'observacion', 'fortaleza1', 'fortaleza2', 'fortaleza3',
      'mejora1', 'mejora2', 'mejora3', 'compromisos', 'recomendaciones',
      'puntaje_total'];

    const valores = [
      b.docente_id, req.usuario.id, b.fecha_eval || null, b.hora_eval || null,
      ...CAMPOS_IND.map(c => b[c]),
      b.observacion || null, b.fortaleza1 || null, b.fortaleza2 || null, b.fortaleza3 || null,
      b.mejora1 || null, b.mejora2 || null, b.mejora3 || null,
      b.compromisos || null, b.recomendaciones || null,
      puntaje_total
    ];

    const placeholders = valores.map((_, i) => '$' + (i + 1)).join(', ');
    const result = await db.query(
      `INSERT INTO evaluaciones_tutor (${cols.join(', ')})
       VALUES (${placeholders}) RETURNING *`,
      valores
    );

    res.json({ ...result.rows[0], promedio: puntaje_total.toFixed(1) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar evaluación de tutoría' });
  }
});

// DELETE /api/evaluaciones-tutor/:id
router.delete('/:id', verificarToken, async (req, res) => {
  if (req.usuario.rol !== ROL_EVALUADOR && !ROLES_LECTURA.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  try {
    await db.query('DELETE FROM evaluaciones_tutor WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Evaluación eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar evaluación' });
  }
});

module.exports = router;
