// utils/trayectoria.js
// Experiencia laboral y formación académica de un docente (para el Perfil 360°).
// La experiencia se guarda como arreglo JSON en fichas_docentes.experiencia:
//   { cargo, institucion, desde (año), hasta (año o null = actual), detalle }
// Los años se cuentan por años calendario (sin doble conteo si dos trabajos se cruzan).

const MAX_ITEMS = 15;

function entero(v) {
  const n = parseInt(String(v == null ? '' : v).trim(), 10);
  return Number.isInteger(n) ? n : null;
}
function txt(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Devuelve { items } o { error }. hasta vacío/null = "actualmente".
function limpiarExperiencia(arr, anioActual = new Date().getFullYear()) {
  if (arr == null) return { items: [] };
  if (!Array.isArray(arr)) return { error: 'La experiencia debe ser una lista' };
  if (arr.length > MAX_ITEMS) return { error: `Máximo ${MAX_ITEMS} experiencias` };
  const items = [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') return { error: 'Experiencia inválida' };
    const cargo = txt(e.cargo, 120), institucion = txt(e.institucion, 150), detalle = txt(e.detalle, 300);
    const vacia = !cargo && !institucion && !detalle && !e.desde && !e.hasta;
    if (vacia) continue;
    const desde = entero(e.desde);
    const hasta = (e.hasta === '' || e.hasta == null) ? null : entero(e.hasta);
    if (!cargo || !institucion) return { error: 'Cada experiencia necesita cargo e institución' };
    if (desde == null || desde < 1950 || desde > anioActual) return { error: `Año "desde" inválido en "${cargo}"` };
    if (hasta != null && (hasta < desde || hasta > anioActual)) return { error: `Año "hasta" inválido en "${cargo}"` };
    items.push({ cargo, institucion, desde, hasta, detalle });
  }
  items.sort((a, b) => (b.hasta == null ? 9999 : b.hasta) - (a.hasta == null ? 9999 : a.hasta) || b.desde - a.desde);
  return { items };
}

function contarAnios(items, filtro, anioActual) {
  const anios = new Set();
  for (const e of items) {
    if (filtro && !filtro(e)) continue;
    const fin = e.hasta == null ? anioActual : e.hasta;
    for (let y = e.desde; y <= fin; y++) anios.add(y);
  }
  return anios.size;
}

function calcularAnios(items, anioActual = new Date().getFullYear()) {
  if (!items || !items.length) return null;
  return {
    total: contarAnios(items, null, anioActual),
    cervantes: contarAnios(items, e => /cervantes/i.test(e.institucion), anioActual),
    docencia: contarAnios(items, e => /docent|profesor|maestr|catedr|tutor/i.test(e.cargo), anioActual)
  };
}

// "Centro — Grado (2015–2020)" → { nivel, centro, grado, desde, hasta }
function parsearFormacion(texto, nivel) {
  const t = String(texto || '').trim();
  if (!t) return null;
  let desde = null, hasta = null, resto = t;
  const m = t.match(/\s*\((\d{4}|\?)\s*[–-]\s*(\d{4}|\?)\)\s*$/);
  if (m) {
    desde = m[1] === '?' ? null : parseInt(m[1], 10);
    hasta = m[2] === '?' ? null : parseInt(m[2], 10);
    resto = t.slice(0, m.index).trim();
  }
  const i = resto.indexOf(' — ');
  const centro = i >= 0 ? resto.slice(0, i).trim() : resto;
  const grado = i >= 0 ? resto.slice(i + 3).trim() : '';
  return { nivel, centro, grado, desde, hasta };
}


// ─────────────────────────────────────────────────────────────────────────
// Puntos de trayectoria (hoja de vida) — escala ajustable en un solo lugar.
//  · puntaje (0–100): formación 50 + experiencia 35 + inglés 15. Si falta un
//    componente (p. ej. aún no se cargó la experiencia) se deja fuera y el
//    puntaje se calcula sobre lo que sí hay, para no castigar por datos vacíos.
//  · bono (0–BONO_MAX): se suma al puntaje global de evaluación.
// ─────────────────────────────────────────────────────────────────────────
const MAX_FORMACION = 50, MAX_EXPERIENCIA = 35, MAX_INGLES = 15;
const ANIOS_TOPE = 10;       // desde 10 años de experiencia ya es el máximo
const BONO_MAX = 5;
const PTS_FORMACION = {
  'Secundaria completa': 10, 'Técnico': 25, 'Universitario — Bachiller': 35,
  'Universitario — Titulado': 42, 'Postgrado — Maestría': 48, 'Postgrado — Doctorado': 50
};
const BONO_FORMACION = {
  'Secundaria completa': 0, 'Técnico': 0.5, 'Universitario — Bachiller': 0.5,
  'Universitario — Titulado': 1, 'Postgrado — Maestría': 2, 'Postgrado — Doctorado': 3
};
const BONO_EXPERIENCIA_MAX = 2;   // formación (hasta 3) + experiencia (hasta 2) = 5
const PTS_INGLES = { 'Ninguno': 0, 'Básico': 5, 'Intermedio': 10, 'Avanzado': 15, 'Nativo': 15 };

const redondear1 = v => Math.round(v * 10) / 10;

// ficha: { nivel_educativo, ingles }, anios: resultado de calcularAnios (o null)
function puntosTrayectoria(ficha, anios) {
  const f = ficha || {};
  const partes = {};
  if (f.nivel_educativo in PTS_FORMACION) partes.formacion = { pts: PTS_FORMACION[f.nivel_educativo], max: MAX_FORMACION };
  if (anios) partes.experiencia = { pts: redondear1(Math.min(anios.total, ANIOS_TOPE) / ANIOS_TOPE * MAX_EXPERIENCIA), max: MAX_EXPERIENCIA };
  if (f.ingles in PTS_INGLES) partes.ingles = { pts: PTS_INGLES[f.ingles], max: MAX_INGLES };
  const lista = Object.values(partes);
  if (!lista.length) return null;
  const pts = lista.reduce((a, c) => a + c.pts, 0), max = lista.reduce((a, c) => a + c.max, 0);
  let bono = 0;
  if (partes.formacion) bono += BONO_FORMACION[f.nivel_educativo];
  if (partes.experiencia) bono += Math.min(anios.total, ANIOS_TOPE) / ANIOS_TOPE * BONO_EXPERIENCIA_MAX;
  return {
    puntaje: redondear1(pts / max * 100),
    bono: Math.min(BONO_MAX, redondear1(bono)),
    partes,
    completo: !!(partes.formacion && partes.experiencia && partes.ingles)
  };
}

// Puntaje global + bono, con tope de 100.
function aplicarBono(base, bono) {
  if (base == null) return null;
  return redondear1(Math.min(100, base + (bono || 0)));
}

module.exports = { limpiarExperiencia, calcularAnios, parsearFormacion, puntosTrayectoria, aplicarBono, BONO_MAX, MAX_ITEMS };
