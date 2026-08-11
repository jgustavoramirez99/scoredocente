// routes/evaluaciones_coordinadores.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { registrarAuditoria } = require('../utils/auditoria');
const {
  DIMENSIONES,
  INDICADORES,
  PREGUNTAS_ABIERTAS,
  NIVELES_EDUCATIVOS,
  ESCALA,
  calcularPuntaje,
  getNivelGestion,
} = require('../utils/indicadoresCoordinadores');

function nivelValido(nivel) {
  return NIVELES_EDUCATIVOS.includes(nivel);
}

// Solo el director / coordinador general registra estas evaluaciones.
// Ajusta esta lista de roles a los que uses en tu sistema.
function puedeRegistrar(usuario) {
  return ['director', 'directora', 'admin'].includes(usuario.rol);
}

// GET /api/evaluaciones-coordinadores/config
// Entrega indicadores/pesos/preguntas para que el frontend arme el formulario
// sin tener que duplicar los 30 textos a mano.
router.get('/config', verificarToken, (req, res) => {
  res.json({ DIMENSIONES, INDICADORES, PREGUNTAS_ABIERTAS, NIVELES_EDUCATIVOS, ESCALA });
});

// POST /api/evaluaciones-coordinadores
// Body: { nivel_educativo, fecha_eval, puntajes_gral, puntajes_acad, preguntas_gral, preguntas_acad }
router.post('/', verificarToken, async (req, res) => {
  const { nivel_educativo, fecha_eval, puntajes_gral, puntajes_acad, preguntas_gral, preguntas_acad } = req.body;

  if (!puedeRegistrar(req.usuario)) {
    return res.status(403).json({ error: 'No tienes permiso para registrar esta evaluación' });
  }
  if (!nivelValido(nivel_educativo)) {
    return res.status(400).json({ error: 'nivel_educativo inválido (usa inicial, primaria o secundaria)' });
  }
  if (!puntajes_gral || !puntajes_acad) {
    return res.status(400).json({ error: 'Faltan los puntajes de ambos coordinadores' });
  }

  const puntaje_total_gral = calcularPuntaje(puntajes_gral);
  const puntaje_total_acad = calcularPuntaje(puntajes_acad);

  try {
    const result = await db.query(
      `INSERT INTO evaluaciones_coordinadores
        (nivel_educativo, puntajes_gral, puntajes_acad, preguntas_gral, preguntas_acad,
         puntaje_total_gral, puntaje_total_acad, fecha_eval, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        nivel_educativo,
        puntajes_gral,
        puntajes_acad,
        preguntas_gral || {},
        preguntas_acad || {},
        puntaje_total_gral,
        puntaje_total_acad,
        fecha_eval || new Date().toISOString().slice(0, 10),
        req.usuario.id,
      ]
    );
    const fila = result.rows[0];

    registrarAuditoria({
      tabla: 'evaluaciones_coordinadores',
      registro_id: fila.id,
      accion: 'crear',
      usuario: req.usuario,
      descripcion: `Evaluación de coordinadores (${nivel_educativo})`,
      datos: fila,
    });

    res.json(fila);
  } catch (err) {
    console.error('Error guardando evaluación de coordinadores:', err);
    res.status(500).json({ error: 'Error al guardar la evaluación' });
  }
});

// GET /api/evaluaciones-coordinadores?nivel=inicial
// Lista las fichas individuales de un nivel (o todas si no se pasa nivel).
router.get('/', verificarToken, async (req, res) => {
  try {
    const { nivel } = req.query;
    let where = '';
    const params = [];
    if (nivel) {
      if (!nivelValido(nivel)) return res.status(400).json({ error: 'nivel inválido' });
      params.push(nivel);
      where = `WHERE nivel_educativo = $1`;
    }
    const result = await db.query(
      `SELECT * FROM evaluaciones_coordinadores ${where} ORDER BY creado_en DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar evaluaciones de coordinadores:', err);
    res.status(500).json({ error: 'Error al obtener evaluaciones' });
  }
});

// GET /api/evaluaciones-coordinadores/resumen/:nivel
// Reporte agregado: promedio por indicador y puntaje final, por coordinador,
// para un nivel educativo (inicial | primaria | secundaria).
router.get('/resumen/:nivel', verificarToken, async (req, res) => {
  const { nivel } = req.params;
  if (!nivelValido(nivel)) return res.status(400).json({ error: 'nivel inválido' });

  try {
    const result = await db.query(
      `SELECT * FROM evaluaciones_coordinadores WHERE nivel_educativo = $1 ORDER BY creado_en ASC`,
      [nivel]
    );
    const filas = result.rows;

    if (filas.length === 0) {
      return res.json({ nivel_educativo: nivel, total_evaluadores: 0, mensaje: 'Aún no hay evaluaciones registradas para este nivel.' });
    }

    function promedioPorIndicador(campo) {
      const promedios = {};
      for (const ind of INDICADORES) {
        const valores = filas.map(f => parseInt(f[campo][ind.id]) || 0).filter(v => v > 0);
        promedios[ind.id] = valores.length
          ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100
          : null;
      }
      return promedios;
    }

    function armarReporte(campoPuntajes, campoTotal, campoPreguntas) {
      const promediosIndicadores = promedioPorIndicador(campoPuntajes);
      const puntajeFinal = Math.round(
        (filas.reduce((sum, f) => sum + parseFloat(f[campoTotal]), 0) / filas.length) * 100
      ) / 100;

      const dimensiones = DIMENSIONES.map(dim => {
        const indDim = INDICADORES.filter(i => i.dimension === dim.id);
        const promDim = indDim.reduce((sum, i) => sum + (promediosIndicadores[i.id] || 0) * (i.peso / 5), 0);
        return {
          ...dim,
          puntaje: Math.round(promDim * 100) / 100,
          indicadores: indDim.map(i => ({ ...i, promedio: promediosIndicadores[i.id] })),
        };
      });

      const respuestasAbiertas = PREGUNTAS_ABIERTAS.map(p => ({
        ...p,
        respuestas: filas.map(f => f[campoPreguntas]?.[p.id]).filter(Boolean),
      }));

      return {
        puntaje_final: puntajeFinal,
        nivel_gestion: getNivelGestion(puntajeFinal),
        dimensiones,
        respuestas_abiertas: respuestasAbiertas,
      };
    }

    res.json({
      nivel_educativo: nivel,
      total_evaluadores: filas.length,
      coordinador_general: armarReporte('puntajes_gral', 'puntaje_total_gral', 'preguntas_gral'),
      coordinador_academico: armarReporte('puntajes_acad', 'puntaje_total_acad', 'preguntas_acad'),
    });
  } catch (err) {
    console.error('Error al generar resumen de coordinadores:', err);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

// DELETE /api/evaluaciones-coordinadores/:id
router.delete('/:id', verificarToken, async (req, res) => {
  if (!puedeRegistrar(req.usuario)) {
    return res.status(403).json({ error: 'No tienes permiso para eliminar esta evaluación' });
  }
  try {
    const result = await db.query(
      'DELETE FROM evaluaciones_coordinadores WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluación no encontrada' });
    }
    const fila = result.rows[0];

    registrarAuditoria({
      tabla: 'evaluaciones_coordinadores',
      registro_id: fila.id,
      accion: 'eliminar',
      usuario: req.usuario,
      descripcion: `Evaluación de coordinadores (${fila.nivel_educativo})`,
      datos: fila,
    });

    res.json({ mensaje: 'Evaluación eliminada correctamente' });
  } catch (err) {
    console.error('Error al eliminar evaluación de coordinadores:', err);
    res.status(500).json({ error: 'Error al eliminar la evaluación' });
  }
});

module.exports = router;
