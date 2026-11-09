// routes/perfilDocente.js
// "Perfil 360°" de un docente: junta en una sola respuesta su evaluación de
// clases (A–F), su evaluación de tutoría (1–5), la encuesta de estudiantes y
// un resumen de su hoja de vida, junto con el promedio del colegio en cada
// apartado para poder comparar.
//
// Acceso: solo el Director/Directora y el Gerente General. La parte de
// "hoja de vida" que viene de fichas_docentes (formación, foto) solo se
// incluye para el Gerente General, igual que el módulo de fichas. Nunca se
// devuelven datos personales (DNI, pensión, cuenta, familia).
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');
const {
  CATEGORIAS_EVALUACIONES, CATEGORIAS_TUTORIA,
  promedioCategoria, promedioSimple, nivelDe
} = require('../utils/categoriasPerfil');
const { limpiarExperiencia, calcularAnios, parsearFormacion } = require('../utils/trayectoria');
const { registrarAuditoria } = require('../utils/auditoria');

const EMAIL_GERENTE_GENERAL = 'gerentegeneralcervantino@cervantesschool.edu.pe';
const ROLES_PERFIL = ['director', 'directora'];

// Pesos del puntaje global. Si a un docente le falta un componente (por
// ejemplo no es tutor, o aún no tiene encuestas), se reparten los pesos
// restantes proporcionalmente.
const PESOS = { clases: 0.5, tutoria: 0.3, estudiantes: 0.2 };

function esGerente(usuario) {
  return (usuario.email || '').trim().toLowerCase() === EMAIL_GERENTE_GENERAL;
}

function puedeVerPerfil(req, res, next) {
  if (ROLES_PERFIL.includes(req.usuario.rol) || esGerente(req.usuario)) return next();
  return res.status(403).json({ error: 'No autorizado para ver el Perfil 360°' });
}

function puntajeGlobal(clases, tutoria, estudiantes) {
  const comp = [];
  if (clases != null) comp.push([clases, PESOS.clases]);
  if (tutoria != null) comp.push([tutoria, PESOS.tutoria]);
  if (estudiantes != null) comp.push([estudiantes, PESOS.estudiantes]);
  if (!comp.length) return null;
  const sumaPesos = comp.reduce((s, c) => s + c[1], 0);
  const val = comp.reduce((s, c) => s + c[0] * c[1], 0) / sumaPesos;
  return Math.round(val * 10) / 10;
}

function pesosUsados(clases, tutoria, estudiantes) {
  const usados = {};
  let suma = 0;
  if (clases != null) suma += PESOS.clases;
  if (tutoria != null) suma += PESOS.tutoria;
  if (estudiantes != null) suma += PESOS.estudiantes;
  if (!suma) return usados;
  if (clases != null) usados.clases = Math.round((PESOS.clases / suma) * 100);
  if (tutoria != null) usados.tutoria = Math.round((PESOS.tutoria / suma) * 100);
  if (estudiantes != null) usados.estudiantes = Math.round((PESOS.estudiantes / suma) * 100);
  return usados;
}

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Une la ficha con el docente por nombre (no hay docente_id en fichas_docentes):
// todas las palabras del nombre más corto deben estar en el más largo, con al
// menos 2 palabras en común.
function coincideNombre(docenteNombre, fichaNombre) {
  const a = normalizar(docenteNombre), b = normalizar(fichaNombre);
  if (a.length < 2 || b.length < 2) return false;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return corto.every(t => largo.includes(t));
}

// Busca la ficha que corresponde al docente (por nombre). Devuelve el id o null.
async function buscarFichaId(docente) {
  const fichas = await db.query('SELECT id, nombres, apellidos FROM fichas_docentes');
  const nombreDoc = `${docente.nombre} ${docente.apellido}`;
  const match = fichas.rows.find(f => coincideNombre(nombreDoc, `${f.nombres} ${f.apellidos}`));
  return match ? match.id : null;
}

// Trayectoria (formación estructurada + experiencia + años) a partir de la fila de la ficha.
function armarTrayectoria(f) {
  const experiencia = Array.isArray(f.experiencia) ? f.experiencia : [];
  const formacion_items = [
    parsearFormacion(f.educacion_tecnica, 'Técnico'),
    parsearFormacion(f.educacion_universitaria, 'Universitario'),
    parsearFormacion(f.educacion_postgrado, 'Postgrado')
  ].filter(Boolean);
  return { formacion_items, experiencia, anios: calcularAnios(experiencia) };
}

async function buscarHojaDeVida(docente, incluirFicha) {
  const hoja = {
    curso: docente.curso || null,
    nivel: docente.nivel || null,
    tipo: docente.tipo || null,
    es_tutor: !!docente.es_tutor,
    ficha_visible: !!incluirFicha,
    ficha_vinculada: false
  };
  if (!incluirFicha) return hoja;
  const fichaId = await buscarFichaId(docente);
  if (!fichaId) return hoja;
  const det = await db.query(
    `SELECT nivel_educativo, ingles, educacion_tecnica, educacion_universitaria,
            educacion_postgrado, foto_base64, experiencia
     FROM fichas_docentes WHERE id = $1`,
    [fichaId]
  );
  const f = det.rows[0] || {};
  hoja.ficha_vinculada = true;
  hoja.nivel_educativo = f.nivel_educativo || null;
  hoja.ingles = f.ingles || null;
  hoja.formacion = [f.educacion_tecnica, f.educacion_universitaria, f.educacion_postgrado].filter(Boolean);
  hoja.foto = f.foto_base64 || null;
  Object.assign(hoja, armarTrayectoria(f));
  return hoja;
}

// GET /api/perfil-docente/:id
router.get('/:id', verificarToken, puedeVerPerfil, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });

    const docRes = await db.query(
      'SELECT id, nombre, apellido, curso, nivel, tipo, es_tutor FROM docentes WHERE id = $1',
      [id]
    );
    const docente = docRes.rows[0];
    if (!docente) return res.status(404).json({ error: 'Docente no encontrado' });

    // Todas las evaluaciones (para el promedio del colegio y para el docente)
    const [evalAll, tutAll, estAll] = await Promise.all([
      db.query('SELECT * FROM evaluaciones'),
      db.query('SELECT * FROM evaluaciones_tutor'),
      db.query('SELECT docente_id, puntaje_total FROM evaluaciones_estudiantes')
    ]);

    const evalDoc = evalAll.rows.filter(r => r.docente_id === id);
    const tutDoc = tutAll.rows.filter(r => r.docente_id === id);
    const estDoc = estAll.rows.filter(r => r.docente_id === id);

    const armar = (docFilas, todasFilas, categorias) => ({
      cantidad: docFilas.length,
      promedio: promedioSimple(docFilas.map(r => parseFloat(r.puntaje_total))),
      categorias: categorias.map(cat => ({
        clave: cat.clave,
        nombre: cat.nombre,
        promedio: promedioCategoria(docFilas, cat),
        colegio: promedioCategoria(todasFilas, cat)
      }))
    });

    const clases = armar(evalDoc, evalAll.rows, CATEGORIAS_EVALUACIONES);
    clases.colegio = promedioSimple(evalAll.rows.map(r => parseFloat(r.puntaje_total)));
    const tutoria = armar(tutDoc, tutAll.rows, CATEGORIAS_TUTORIA);
    tutoria.colegio = promedioSimple(tutAll.rows.map(r => parseFloat(r.puntaje_total)));

    // Encuesta de estudiantes: viene en escala 1–5, se pasa a /100
    const estPct = v => { const n = parseFloat(v); return isNaN(n) ? null : n * 20; };
    const estudiantes = {
      cantidad: estDoc.length,
      promedio: promedioSimple(estDoc.map(r => estPct(r.puntaje_total))),
      colegio: promedioSimple(estAll.rows.map(r => estPct(r.puntaje_total)))
    };

    // Puntaje global y puesto entre los docentes activos
    const activos = await db.query('SELECT id FROM docentes WHERE activo = true');
    const mediaPorDocente = (filas, f) => {
      const m = {};
      filas.forEach(r => {
        const v = f(r);
        if (v == null) return;
        (m[r.docente_id] = m[r.docente_id] || []).push(v);
      });
      const out = {};
      Object.keys(m).forEach(k => { out[k] = m[k].reduce((a, b) => a + b, 0) / m[k].length; });
      return out;
    };
    const mClases = mediaPorDocente(evalAll.rows, r => { const n = parseFloat(r.puntaje_total); return isNaN(n) ? null : n; });
    const mTut = mediaPorDocente(tutAll.rows, r => { const n = parseFloat(r.puntaje_total); return isNaN(n) ? null : n; });
    const mEst = mediaPorDocente(estAll.rows, r => estPct(r.puntaje_total));
    const globales = activos.rows
      .map(d => ({ id: d.id, g: puntajeGlobal(mClases[d.id] ?? null, mTut[d.id] ?? null, mEst[d.id] ?? null) }))
      .filter(x => x.g != null)
      .sort((a, b) => b.g - a.g);

    const global = puntajeGlobal(clases.promedio, tutoria.promedio, estudiantes.promedio);
    const posicion = globales.findIndex(x => x.id === id);

    const hoja_vida = await buscarHojaDeVida(docente, esGerente(req.usuario));

    res.json({
      docente: { id: docente.id, nombre: docente.nombre, apellido: docente.apellido },
      clases,
      tutoria: tutoria.cantidad ? tutoria : null,
      estudiantes: estudiantes.cantidad ? estudiantes : null,
      global: {
        puntaje: global,
        nivel: nivelDe(global),
        pesos: pesosUsados(clases.promedio, tutoria.cantidad ? tutoria.promedio : null, estudiantes.cantidad ? estudiantes.promedio : null),
        puesto: posicion >= 0 ? posicion + 1 : null,
        total_docentes: globales.length
      },
      hoja_vida
    });
  } catch (err) {
    console.error('Error en /api/perfil-docente:', err);
    res.status(500).json({ error: 'Error al armar el perfil del docente' });
  }
});

// PUT /api/perfil-docente/:id/experiencia — solo el Gerente General (la
// trayectoria vive en la ficha del docente, que solo él puede ver/editar).
router.put('/:id/experiencia', verificarToken, async (req, res) => {
  if (!esGerente(req.usuario)) return res.status(403).json({ error: 'Solo el Gerente General puede editar la trayectoria' });
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const exp = limpiarExperiencia(req.body && req.body.experiencia);
  if (exp.error) return res.status(400).json({ error: exp.error });
  try {
    const docRes = await db.query('SELECT id, nombre, apellido FROM docentes WHERE id = $1', [id]);
    const docente = docRes.rows[0];
    if (!docente) return res.status(404).json({ error: 'Docente no encontrado' });
    const fichaId = await buscarFichaId(docente);
    if (!fichaId) return res.status(409).json({ error: 'Este docente aún no tiene ficha registrada; primero debe llenar su ficha.' });
    const r = await db.query(
      `UPDATE fichas_docentes SET experiencia = $1, actualizado_en = NOW() WHERE id = $2
       RETURNING educacion_tecnica, educacion_universitaria, educacion_postgrado, experiencia`,
      [JSON.stringify(exp.items), fichaId]);
    await registrarAuditoria({ tabla: 'fichas_docentes', registro_id: fichaId, accion: 'editar', usuario: req.usuario,
      descripcion: `Actualizó la experiencia laboral de ${docente.nombre} ${docente.apellido} (${exp.items.length} registro(s))` });
    res.json(armarTrayectoria(r.rows[0]));
  } catch (err) {
    console.error('Error en PUT /api/perfil-docente/:id/experiencia:', err);
    res.status(500).json({ error: 'Error al guardar la experiencia' });
  }
});

module.exports = router;
module.exports._test = { puntajeGlobal, pesosUsados, coincideNombre };
