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

module.exports = { limpiarExperiencia, calcularAnios, parsearFormacion, MAX_ITEMS };
