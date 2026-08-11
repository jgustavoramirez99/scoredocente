// utils/indicadoresCoordinadores.js
// Fuente única de verdad: indicadores, pesos y dimensiones de la
// "Ficha Técnica de Evaluación de la Gestión de Coordinadores".
// Si cambian los pesos o el texto de un indicador, se edita SOLO aquí
// (backend y frontend lo consumen desde el endpoint /config).

const DIMENSIONES = [
  { id: 1, nombre: 'Liderazgo y Gestión', peso: 20 },
  { id: 2, nombre: 'Acompañamiento y Monitoreo Docente', peso: 25 },
  { id: 3, nombre: 'Gestión Académica', peso: 20 },
  { id: 4, nombre: 'Organización y Cumplimiento', peso: 15 },
  { id: 5, nombre: 'Comunicación y Clima Institucional', peso: 10 },
  { id: 6, nombre: 'Impacto y Mejora Institucional', peso: 10 },
];

const INDICADORES = [
  // Dimensión 1 — Liderazgo y Gestión (20%) — peso 4% c/u
  { id: 1, dimension: 1, peso: 4, texto: 'Ejerce liderazgo firme, respetuoso y orientado a resultados.' },
  { id: 2, dimension: 1, peso: 4, texto: 'Organiza y distribuye adecuadamente las responsabilidades del docente.' },
  { id: 3, dimension: 1, peso: 4, texto: 'Hace cumplir las normas y acuerdos con equidad.' },
  { id: 4, dimension: 1, peso: 4, texto: 'Resuelve oportunamente ante situaciones académicas y disciplinarias.' },
  { id: 5, dimension: 1, peso: 4, texto: 'Demuestra compromiso con los objetivos y proyecto institucional.' },

  // Dimensión 2 — Acompañamiento y Monitoreo Docente (25%) — peso 5% c/u
  { id: 6, dimension: 2, peso: 5, texto: 'Realiza seguimiento sistemático del desempeño docente.' },
  { id: 7, dimension: 2, peso: 5, texto: 'Brinda acompañamiento y orientación cuando identifica dificultades.' },
  { id: 8, dimension: 2, peso: 5, texto: 'Proporciona retroalimentación clara, respetuosa y útil.' },
  { id: 9, dimension: 2, peso: 5, texto: 'El monitoreo contribuye realmente a mejorar la práctica pedagógica.' },
  { id: 10, dimension: 2, peso: 5, texto: 'Verifica el cumplimiento de los procesos pedagógicos y administrativos.' },

  // Dimensión 3 — Gestión Académica (20%) — peso 4% c/u
  { id: 11, dimension: 3, peso: 4, texto: 'Supervisa adecuadamente el desarrollo de las sesiones de aprendizaje.' },
  { id: 12, dimension: 3, peso: 4, texto: 'Promueve el enfoque por competencias con evaluación de estudiantes.' },
  { id: 13, dimension: 3, peso: 4, texto: 'Realiza seguimiento al progreso académico de los estudiantes.' },
  { id: 14, dimension: 3, peso: 4, texto: 'Promueve proyectos, innovación e investigación educativa.' },
  { id: 15, dimension: 3, peso: 4, texto: 'Impulsa el trabajo colaborativo entre docentes.' },

  // Dimensión 4 — Organización y Cumplimiento (15%) — peso 3% c/u
  { id: 16, dimension: 4, peso: 3, texto: 'Planifica y organiza adecuadamente las actividades.' },
  { id: 17, dimension: 4, peso: 3, texto: 'Realiza seguimiento al cumplimiento de los acuerdos establecidos.' },
  { id: 18, dimension: 4, peso: 3, texto: 'Cumple y hace cumplir los plazos y responsabilidades asignadas.' },
  { id: 19, dimension: 4, peso: 3, texto: 'Informa oportunamente sobre decisiones y actividades relevantes.' },
  { id: 20, dimension: 4, peso: 3, texto: 'Demuestra capacidad para solucionar problemas de manera eficiente.' },

  // Dimensión 5 — Comunicación y Clima Institucional (10%) — peso 2% c/u
  { id: 21, dimension: 5, peso: 2, texto: 'Mantiene una comunicación clara y oportuna.' },
  { id: 22, dimension: 5, peso: 2, texto: 'Escucha y considera las opiniones y propuestas del equipo.' },
  { id: 23, dimension: 5, peso: 2, texto: 'Promueve un clima de respeto, integración y trabajo en equipo.' },
  { id: 24, dimension: 5, peso: 2, texto: 'Resuelve conflictos buscando el bienestar institucional.' },
  { id: 25, dimension: 5, peso: 2, texto: 'Su trato hacia los docentes es profesional, justo y respetuoso.' },

  // Dimensión 6 — Impacto y Mejora Institucional (10%) — peso 2% c/u
  { id: 26, dimension: 6, peso: 2, texto: 'Considero que su gestión ha contribuido a mejorar el desempeño docente.' },
  { id: 27, dimension: 6, peso: 2, texto: 'Su gestión ha contribuido a mejorar la organización institucional.' },
  { id: 28, dimension: 6, peso: 2, texto: 'Su gestión ha tenido un impacto positivo en el aprendizaje de los estudiantes.' },
  { id: 29, dimension: 6, peso: 2, texto: 'Considero que el acompañamiento recibido me ha permitido mejorar.' },
  { id: 30, dimension: 6, peso: 2, texto: 'En términos generales, considero satisfactoria la gestión del coordinador.' },
];

const PREGUNTAS_ABIERTAS = [
  { id: 'p1', texto: '¿Cuál es la principal fortaleza de la gestión del coordinador?' },
  { id: 'p2', texto: '¿Cuál es la principal debilidad que debería corregir?' },
  { id: 'p3', texto: '¿Qué acción concreta debería implementar para mejorar el acompañamiento docente?' },
  { id: 'p4', texto: '¿Qué debería cambiar o fortalecer para elevar el nivel académico de la institución?' },
];

const NIVELES_EDUCATIVOS = ['inicial', 'primaria', 'secundaria'];

const ESCALA = [
  { puntaje: 5, nivel: 'Excelente', interpretacion: 'Supera ampliamente lo esperado' },
  { puntaje: 4, nivel: 'Muy bueno', interpretacion: 'Cumple de manera consistente' },
  { puntaje: 3, nivel: 'Bueno', interpretacion: 'Cumple aceptablemente' },
  { puntaje: 2, nivel: 'Deficiente', interpretacion: 'Cumple parcialmente' },
  { puntaje: 1, nivel: 'Muy deficiente', interpretacion: 'No cumple lo esperado' },
];

// Calcula el puntaje ponderado (0-100) a partir de un objeto { "1": 4, "2": 3, ... }
function calcularPuntaje(puntajesObj) {
  let total = 0;
  for (const ind of INDICADORES) {
    const score = parseInt(puntajesObj[ind.id]) || 0;
    total += ind.peso * (score / 5);
  }
  return Math.round(total * 100) / 100; // 2 decimales
}

// Clasifica el % final: <70 rojo (Requiere mejora), 70-79 en proceso,
// 80-89 buena, 90-100 excelente. Ajustable en un solo lugar.
function getNivelGestion(puntaje) {
  if (puntaje >= 90) return { texto: 'Excelente', color: '#1e7e34', clase: 'excelente' };
  if (puntaje >= 80) return { texto: 'Buena', color: '#2e8b57', clase: 'buena' };
  if (puntaje >= 70) return { texto: 'En proceso', color: '#d39e00', clase: 'en-proceso' };
  return { texto: 'Requiere mejora', color: '#c0392b', clase: 'requiere-mejora' };
}

module.exports = {
  DIMENSIONES,
  INDICADORES,
  PREGUNTAS_ABIERTAS,
  NIVELES_EDUCATIVOS,
  ESCALA,
  calcularPuntaje,
  getNivelGestion,
};
