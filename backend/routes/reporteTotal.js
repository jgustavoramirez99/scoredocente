// routes/reporteTotal.js
// "Reporte Total" — vista consolidada para el Panel Director/Gerente General:
// (1) académico por salón (asistencia + exámenes diagnósticos + evaluación censal),
// (2) institucional/docentes (evaluación docente + tutoría + encuesta de estudiantes +
//     evaluación de coordinadores), (3) resumen general del colegio.
//
// Restringido SOLO a la cuenta del Gerente General (mismo criterio que
// fichas.js y evaluaciones_coordinadores.js), porque este reporte combina
// datos de esos dos módulos que ya están restringidos a esa cuenta
// específica, sin importar que otra cuenta tenga rol 'director'.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const { NIVELES_EDUCATIVOS, getNivelGestion } = require('../utils/indicadoresCoordinadores');

const EMAIL_GERENTE_GENERAL = 'gerentegeneralcervantino@cervantesschool.edu.pe';

function soloGerenteGeneral(req, res, next) {
  if ((req.usuario.email || '').trim().toLowerCase() !== EMAIL_GERENTE_GENERAL.toLowerCase()) {
    return res.status(403).json({ error: 'Solo el Gerente General puede acceder al Reporte Total' });
  }
  next();
}

// Mismo listado que backend/routes/examenes.js (única fuente real es esa,
// pero como aquí solo LEEMOS respuestas ya guardadas, no hace falta
// importarla — si se agrega un curso nuevo allá, esta lista se actualiza
// también, igual que se hizo la última vez).
const CURSOS = [
  'Razonamiento Matemático', 'Geometría', 'Álgebra', 'Trigonometría', 'Aritmética',
  'Lenguaje', 'Literatura', 'Razonamiento Verbal'
];

// ══════════════════════════════════════════════════════════════
//  BLOQUE 1 — Académico por salón (Asistencia + Exámenes + Censal)
// ══════════════════════════════════════════════════════════════
async function bloqueAcademico(salon_id, desde, hasta) {
  const salonRes = await db.query(
    'SELECT id, nombre, grado, seccion, nivel FROM salones WHERE id = $1',
    [salon_id]
  );
  const salon = salonRes.rows[0] || null;
  if (!salon) return null;

  const alumnosRes = await db.query(
    'SELECT id, numero, apellidos_nombres FROM alumnos WHERE salon_id = $1 AND activo = true ORDER BY numero',
    [salon_id]
  );
  const alumnos = alumnosRes.rows;
  const alumnoIds = alumnos.map(a => a.id);

  // ── Asistencia del salón en el rango de fechas ──
  const paramsAsis = [salon_id];
  let whereFecha = '';
  if (desde) { paramsAsis.push(desde); whereFecha += ` AND asi.fecha >= $${paramsAsis.length}`; }
  if (hasta) { paramsAsis.push(hasta); whereFecha += ` AND asi.fecha <= $${paramsAsis.length}`; }
  const asisRes = await db.query(
    `SELECT asi.estado, COUNT(*)::int AS total
     FROM asistencias asi
     JOIN alumnos a ON a.id = asi.alumno_id
     WHERE a.salon_id = $1 ${whereFecha}
     GROUP BY asi.estado`,
    paramsAsis
  );
  let totalRegistrosAsis = 0, presentes = 0;
  asisRes.rows.forEach(r => {
    totalRegistrosAsis += r.total;
    if (r.estado === 'Presente') presentes += r.total;
  });
  const asistenciaPct = totalRegistrosAsis ? Math.round((presentes / totalRegistrosAsis) * 1000) / 10 : null;

  // ── Exámenes diagnósticos del salón, por curso (solo claves aprobadas) ──
  // nota por alumno = correctas / 25 * 20 (escala vigesimal, igual que las
  // libretas del colegio). Solo se cuentan cursos cuya clave ya fue
  // aprobada por el Gerente General (mismo criterio que bloquea a la
  // auxiliar en POST /api/examenes/respuesta).
  let porCurso = [];
  if (alumnoIds.length) {
    const examRes = await db.query(
      `SELECT er.curso, er.alumno_id,
              COUNT(*) FILTER (WHERE er.respuesta_marcada = ec.respuesta_correcta)::int AS correctas,
              COUNT(*)::int AS respondidas
       FROM examenes_respuestas er
       JOIN examenes_clave ec
         ON ec.salon_id = $1 AND ec.curso = er.curso AND ec.pregunta = er.pregunta
       JOIN examenes_clave_estado ece
         ON ece.salon_id = $1 AND ece.curso = er.curso AND ece.aprobada = true
       WHERE er.alumno_id = ANY($2::int[])
       GROUP BY er.curso, er.alumno_id`,
      [salon_id, alumnoIds]
    );
    const porCursoMap = {};
    examRes.rows.forEach(r => {
      if (!porCursoMap[r.curso]) porCursoMap[r.curso] = [];
      porCursoMap[r.curso].push((r.correctas / 25) * 20);
    });
    porCurso = CURSOS
      .filter(c => porCursoMap[c] && porCursoMap[c].length)
      .map(c => {
        const notas = porCursoMap[c];
        const promedio = notas.reduce((a, b) => a + b, 0) / notas.length;
        return {
          curso: c,
          promedio: Math.round(promedio * 100) / 100,
          alumnos_evaluados: notas.length
        };
      });
  }
  const promedioExamenes = porCurso.length
    ? Math.round((porCurso.reduce((s, c) => s + c.promedio, 0) / porCurso.length) * 100) / 100
    : null;

  // ── Evaluación censal del salón (distribución por nivel de logro) ──
  const censal = { total_items: 0, alumnos_evaluados: 0, distribucion: {} };
  const itemsRes = await db.query(
    'SELECT item_numero, competencia FROM evaluacion_censal_items WHERE salon_id = $1',
    [salon_id]
  );
  const items = itemsRes.rows;
  if (items.length && alumnoIds.length) {
    const respRes = await db.query(
      'SELECT alumno_id, item_numero, estado FROM evaluacion_censal_respuestas WHERE alumno_id = ANY($1::int[])',
      [alumnoIds]
    );
    const respMap = {};
    respRes.rows.forEach(r => {
      if (!respMap[r.alumno_id]) respMap[r.alumno_id] = {};
      respMap[r.alumno_id][r.item_numero] = r.estado;
    });
    const dist = { 'Destacado (AD)': 0, 'Logrado (A)': 0, 'En Proceso (B)': 0, 'En Inicio (C)': 0 };
    let evaluados = 0;
    alumnos.forEach(a => {
      const respu = respMap[a.id] || {};
      let correctas = 0, respondidas = 0;
      items.forEach(it => {
        if (respu[it.item_numero]) respondidas++;
        if (respu[it.item_numero] === 'OK') correctas++;
      });
      if (!respondidas) return;
      evaluados++;
      const pct = correctas / items.length;
      const nivel = pct === 1 ? 'Destacado (AD)' : pct >= 0.8 ? 'Logrado (A)' : pct >= 0.5 ? 'En Proceso (B)' : 'En Inicio (C)';
      dist[nivel]++;
    });
    censal.total_items = items.length;
    censal.alumnos_evaluados = evaluados;
    censal.distribucion = dist;
  }

  return {
    salon,
    total_alumnos: alumnos.length,
    asistencia: { porcentaje: asistenciaPct, registros: totalRegistrosAsis },
    examenes: { promedio_general: promedioExamenes, por_curso: porCurso },
    censal
  };
}

// ══════════════════════════════════════════════════════════════
//  BLOQUE 2 — Institucional / Docentes (todo el colegio)
// ══════════════════════════════════════════════════════════════
async function bloqueInstitucional() {
  // Evaluación docente (supervisor → docente, /100)
  const evalRes = await db.query(
    `SELECT d.id, d.nombre || ' ' || d.apellido AS docente, COUNT(e.id)::int AS total,
            ROUND(AVG(e.puntaje_total)::numeric, 2) AS promedio
     FROM docentes d
     LEFT JOIN evaluaciones e ON e.docente_id = d.id
     WHERE d.activo = true
     GROUP BY d.id
     ORDER BY d.nombre`
  );
  const conEval = evalRes.rows.filter(r => r.total > 0).map(r => ({ ...r, promedio: parseFloat(r.promedio) }));
  const promedioEvalDocente = conEval.length
    ? Math.round((conEval.reduce((s, r) => s + r.promedio, 0) / conEval.length) * 100) / 100
    : null;
  const ranking = [...conEval].sort((a, b) => b.promedio - a.promedio);

  // Tutoría / Psicología (evaluaciones_tutor, /100)
  const tutorRes = await db.query(
    `SELECT ROUND(AVG(puntaje_total)::numeric, 2) AS promedio, COUNT(*)::int AS total FROM evaluaciones_tutor`
  );
  const tutoria = {
    promedio: tutorRes.rows[0].promedio ? parseFloat(tutorRes.rows[0].promedio) : null,
    total: tutorRes.rows[0].total
  };

  // Encuesta de estudiantes sobre sus docentes (evaluaciones_estudiantes, /5)
  const estRes = await db.query(
    `SELECT ROUND(AVG(puntaje_total)::numeric, 2) AS promedio, COUNT(*)::int AS total FROM evaluaciones_estudiantes`
  );
  const encuestaEstudiantes = {
    promedio: estRes.rows[0].promedio ? parseFloat(estRes.rows[0].promedio) : null,
    total: estRes.rows[0].total
  };

  // Evaluación de gestión de coordinadores, por nivel educativo (/100)
  const coordinadores = [];
  for (const nivel of NIVELES_EDUCATIVOS) {
    const filasRes = await db.query(
      `SELECT puntaje_total_gral, puntaje_total_acad
       FROM evaluaciones_coordinadores WHERE nivel_educativo = $1`,
      [nivel]
    );
    const filas = filasRes.rows;
    if (!filas.length) {
      coordinadores.push({ nivel, total: 0, promedio_gral: null, promedio_acad: null });
      continue;
    }
    const promGral = filas.reduce((s, f) => s + parseFloat(f.puntaje_total_gral), 0) / filas.length;
    const promAcad = filas.reduce((s, f) => s + parseFloat(f.puntaje_total_acad), 0) / filas.length;
    coordinadores.push({
      nivel,
      total: filas.length,
      promedio_gral: Math.round(promGral * 100) / 100,
      promedio_acad: Math.round(promAcad * 100) / 100,
      nivel_gestion_gral: getNivelGestion(promGral).texto,
      nivel_gestion_acad: getNivelGestion(promAcad).texto
    });
  }

  return {
    evaluacion_docente: { promedio: promedioEvalDocente, docentes_evaluados: conEval.length, ranking },
    tutoria,
    encuesta_estudiantes: encuestaEstudiantes,
    coordinadores
  };
}

// ══════════════════════════════════════════════════════════════
//  BLOQUE 3 — Resumen general del colegio
// ══════════════════════════════════════════════════════════════
async function bloqueResumen(desde, hasta) {
  const totalAlumnosRes = await db.query('SELECT COUNT(*)::int AS total FROM alumnos WHERE activo = true');
  const totalAlumnos = totalAlumnosRes.rows[0].total;

  // Asistencia promedio de TODO el colegio en el rango de fechas
  const paramsAsis = [];
  let whereFecha = '';
  if (desde) { paramsAsis.push(desde); whereFecha += ` AND fecha >= $${paramsAsis.length}`; }
  if (hasta) { paramsAsis.push(hasta); whereFecha += ` AND fecha <= $${paramsAsis.length}`; }
  const asisRes = await db.query(
    `SELECT estado, COUNT(*)::int AS total FROM asistencias WHERE true ${whereFecha} GROUP BY estado`,
    paramsAsis
  );
  let totalRegistrosAsis = 0, presentes = 0;
  asisRes.rows.forEach(r => { totalRegistrosAsis += r.total; if (r.estado === 'Presente') presentes += r.total; });
  const asistenciaPromedio = totalRegistrosAsis ? Math.round((presentes / totalRegistrosAsis) * 1000) / 10 : null;

  // Resultado agregado de exámenes diagnósticos: TODOS los salones/cursos
  // con clave ya aprobada, nota por alumno = correctas/25*20.
  const examRes = await db.query(
    `SELECT COUNT(*) FILTER (WHERE er.respuesta_marcada = ec.respuesta_correcta)::int AS correctas
     FROM examenes_respuestas er
     JOIN alumnos a ON a.id = er.alumno_id AND a.activo = true
     JOIN examenes_clave ec
       ON ec.salon_id = a.salon_id AND ec.curso = er.curso AND ec.pregunta = er.pregunta
     JOIN examenes_clave_estado ece
       ON ece.salon_id = a.salon_id AND ece.curso = er.curso AND ece.aprobada = true
     GROUP BY er.alumno_id, er.curso, a.salon_id`
  );
  const notas = examRes.rows.map(r => (r.correctas / 25) * 20);
  const resultadoAgregadoExamenes = notas.length
    ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 100) / 100
    : null;

  // Promedio de evaluación docente (supervisor → docente), todo el colegio
  const evalRes = await db.query(
    `SELECT ROUND(AVG(puntaje_total)::numeric, 2) AS promedio, COUNT(*)::int AS total FROM evaluaciones`
  );
  const promedioEvalDocentes = evalRes.rows[0].promedio ? parseFloat(evalRes.rows[0].promedio) : null;

  // Fichas de docentes (datos personales/RR.HH.): % ya revisadas por el
  // Gerente General. Es un dato de COMPLETITUD administrativa, no una nota
  // de desempeño (fichas_docentes no tiene ningún campo de puntaje).
  const fichasRes = await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE procesado)::int AS procesadas FROM fichas_docentes`
  );

  return {
    total_alumnos: totalAlumnos,
    asistencia_promedio_pct: asistenciaPromedio,
    resultado_agregado_examenes: resultadoAgregadoExamenes,
    promedio_evaluaciones_docentes: promedioEvalDocentes,
    evaluaciones_docentes_registradas: evalRes.rows[0].total,
    fichas_docentes: { total: fichasRes.rows[0].total, procesadas: fichasRes.rows[0].procesadas }
  };
}

// GET /api/reporte-total?salon_id=&desde=&hasta=
// salon_id es opcional: si no viene, el bloque académico se omite (solo se
// devuelven institucional + resumen, que son de todo el colegio).
router.get('/', verificarToken, soloGerenteGeneral, async (req, res) => {
  try {
    const { salon_id, desde, hasta } = req.query;

    const [academico, institucional, resumen] = await Promise.all([
      salon_id ? bloqueAcademico(salon_id, desde, hasta) : Promise.resolve(null),
      bloqueInstitucional(),
      bloqueResumen(desde, hasta)
    ]);

    res.json({ academico, institucional, resumen, generado_en: new Date().toISOString() });
  } catch (err) {
    console.error('Error al generar el Reporte Total:', err);
    res.status(500).json({ error: 'Error al generar el Reporte Total', detalle: err.message });
  }
});

module.exports = router;
