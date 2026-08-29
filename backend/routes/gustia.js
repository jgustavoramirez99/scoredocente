const express = require('express');
const router = express.Router();
const { verificarToken } = require('./auth');

// Alias "latest" de Google — siempre apunta al modelo Flash más reciente,
// así no hay que estar actualizando el nombre del modelo a mano.
const MODEL_GUSTIA = 'gemini-flash-latest';

// Solo las cuentas con rol "auxiliar" (Panel Auxiliar) y la cuenta exacta del
// Gerente General (Panel Director, solo charla general por ahora) pueden usar
// este asistente — así lo pidió Gustavo.
const EMAIL_GERENTE_GENERAL = 'gerentegeneralcervantino@cervantesschool.edu.pe';
function permitirAuxiliar(req, res, next) {
  const esAuxiliar = req.usuario.rol === 'auxiliar';
  const esGerenteGeneral = req.usuario.email === EMAIL_GERENTE_GENERAL;
  if (!esAuxiliar && !esGerenteGeneral) {
    return res.status(403).json({ error: 'Este asistente no está disponible para tu cuenta' });
  }
  next();
}

const SYSTEM_INSTRUCTION = `Eres GusTI, el asistente virtual de ScoreDocente, un sistema de un colegio en Perú (Cervantes School). Lo usa tanto el personal auxiliar como la Gerencia General, así que tu tono es cercano, alegre y positivo — no formal ni robótico.
Aquí solo te llegan preguntas GENERALES que no tienen que ver con el uso del panel (esas ya las responde otra parte del sistema) — cosas como cultura general, dudas rápidas, clima, y también charla casual.
Te encanta contar chistes cortos y buenos (limpios, sin groserías, aptos para un ambiente escolar) cuando te los pidan, y dar mensajes motivadores cálidos cuando te los pidan o cuando sientas que la persona necesita ánimo — con emojis si encajan, sin exagerar.
Responde siempre en español, de forma breve y directa (máximo 4-5 líneas salvo que pidan más detalle o sea un chiste que necesite su remate).
Muy importante: no tienes acceso a internet en tiempo real. Si te preguntan por algo que cambia todo el tiempo (el clima de HOY, noticias de último momento, resultados de partidos de hoy, precios actuales, etc.), acláralo brevemente en vez de inventar un dato como si fuera real ahora mismo. Esto NO aplica a chistes ni mensajes motivadores — esos sí puedes darlos siempre, con toda confianza.`;

// POST /api/gustia — { pregunta: "..." }
router.post('/', verificarToken, permitirAuxiliar, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GusTI (IA) todavía no está configurado — falta la clave de Google en el servidor.' });
  }

  const pregunta = (req.body.pregunta || '').toString().trim();
  if (!pregunta) return res.status(400).json({ error: 'pregunta es requerida' });
  if (pregunta.length > 500) {
    return res.status(400).json({ error: 'La pregunta es demasiado larga (máximo 500 caracteres).' });
  }

  // Historial reciente de la conversación (para que recuerde el contexto,
  // ej. "cuéntame un chiste" → "dime otro"). Lo manda el front, nosotros
  // solo lo validamos y lo acotamos para no dejar crecer el contexto sin límite.
  const historialCrudo = Array.isArray(req.body.historial) ? req.body.historial.slice(-10) : [];
  const contents = historialCrudo
    .filter((h) => h && typeof h.texto === 'string' && h.texto.trim())
    .map((h) => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.texto.trim().slice(0, 1000) }]
    }));
  contents.push({ role: 'user', parts: [{ text: pregunta }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_GUSTIA}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = JSON.stringify({
    system_instruction: { parts: { text: SYSTEM_INSTRUCTION } },
    contents,
    generationConfig: { maxOutputTokens: 300 }
  });

  // El modelo gratis a veces devuelve 503 "high demand" (Google saturado,
  // no es un error nuestro) — reintentamos una vez tras una pausa corta
  // antes de darnos por vencidos, así se resuelve solo casi siempre.
  const intentos = 2;
  let ultimoError = null;

  for (let i = 0; i < intentos; i++) {
    try {
      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const data = await geminiRes.json();

      if (geminiRes.ok) {
        const partes = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const texto = Array.isArray(partes) ? partes.map((p) => p.text || '').join('').trim() : '';
        return res.json({ respuesta: texto || 'No tengo una respuesta para eso ahora mismo.' });
      }

      console.error('Error de la API de Gemini:', JSON.stringify(data));
      ultimoError = data;
      const esSaturado = geminiRes.status === 503 || (data.error && data.error.status === 'UNAVAILABLE');
      if (esSaturado && i < intentos - 1) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      break;
    } catch (err) {
      console.error('Error en /api/gustia:', err);
      ultimoError = err;
      break;
    }
  }

  const fueSaturado = ultimoError && ultimoError.error && ultimoError.error.status === 'UNAVAILABLE';
  res.status(500).json({
    error: fueSaturado
      ? 'GusTI (IA) está muy solicitado en este momento 🙈 Intenta de nuevo en unos segundos.'
      : 'GusTI (IA) no pudo responder en este momento.'
  });
});

module.exports = router;
