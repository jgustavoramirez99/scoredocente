// utils/categoriasPerfil.js
// Apartados de la ficha de evaluación de clases (A–F) y de la ficha de
// tutoría (1–5), con los campos que componen cada uno y su puntaje máximo.
// Son los mismos que usa el panel del Director en frontend/index.html
// (CATEGORIAS_EVALUACIONES / CATEGORIAS_TUTORIA).

const CATEGORIAS_EVALUACIONES = [
  { clave: 'A', nombre: 'Planificación', campos: ['plan_ind1', 'plan_ind2', 'plan_ind3', 'plan_ind4'], max: 16 },
  { clave: 'B', nombre: 'Desarrollo de la sesión', campos: ['des_ind1', 'des_ind2', 'des_ind3', 'des_ind4', 'des_ind5'], max: 20 },
  { clave: 'C', nombre: 'Materiales didácticos', campos: ['mat_ind1', 'mat_ind2', 'mat_ind3', 'mat_ind4'], max: 16 },
  { clave: 'D', nombre: 'Evaluación del aprendizaje', campos: ['eval_ind1', 'eval_ind2', 'eval_ind3', 'eval_ind4'], max: 16 },
  { clave: 'E', nombre: 'Clima del aula', campos: ['clima_ind1', 'clima_ind2', 'clima_ind3'], max: 12 },
  { clave: 'F', nombre: 'Responsabilidad profesional', campos: ['resp_ind1', 'resp_ind2', 'resp_ind3', 'resp_ind4'], max: 16 }
];

const CATEGORIAS_TUTORIA = [
  { clave: '1', nombre: 'Planificación bimestral', campos: ['planif_ind1', 'planif_ind2', 'planif_ind3', 'planif_ind4', 'planif_ind5'], max: 20 },
  { clave: '2', nombre: 'Desarrollo de la sesión', campos: ['sesion_ind1', 'sesion_ind2', 'sesion_ind3', 'sesion_ind4', 'sesion_ind5'], max: 20 },
  { clave: '3', nombre: 'Acompañamiento tutorial', campos: ['acomp_ind1', 'acomp_ind2', 'acomp_ind3', 'acomp_ind4', 'acomp_ind5'], max: 20 },
  { clave: '4', nombre: 'Entrevista con padres', campos: ['padres_ind1', 'padres_ind2', 'padres_ind3', 'padres_ind4', 'padres_ind5'], max: 20 },
  { clave: '5', nombre: 'Presentación y ambientación', campos: ['present_ind1', 'present_ind2', 'present_ind3', 'present_ind4', 'present_ind5'], max: 20 }
];

// Promedio (como % del puntaje máximo del apartado) de una lista de
// evaluaciones. Devuelve null si no hay evaluaciones.
function promedioCategoria(filas, cat) {
  if (!filas || !filas.length) return null;
  const pcts = filas.map(r => {
    const subtotal = cat.campos.reduce((a, c) => a + (parseInt(r[c]) || 0), 0);
    return (subtotal / cat.max) * 100;
  });
  return Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10;
}

function promedioSimple(valores) {
  const v = valores.filter(x => typeof x === 'number' && !isNaN(x));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

// Misma escala de niveles que la ficha: Destacado / Logrado / En proceso / Inicio.
function nivelDe(pct) {
  if (pct == null) return null;
  if (pct >= 90) return 'Destacado';
  if (pct >= 80) return 'Logrado';
  if (pct >= 70) return 'En proceso';
  return 'Inicio';
}

module.exports = { CATEGORIAS_EVALUACIONES, CATEGORIAS_TUTORIA, promedioCategoria, promedioSimple, nivelDe };
