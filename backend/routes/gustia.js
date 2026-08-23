const express = require('express');
const router = express.Router();
const { verificarToken } = require('./auth');

// Alias "latest" de Google — siempre apunta al modelo Flash más reciente,
// así no hay que estar actualizando el nombre del modelo a mano.
const MODEL_GUSTIA = 'gemini-flash-latest';

// Solo las cuentas con rol "auxiliar" pueden usar este asistente, igual que
// el resto de GusTI (así lo pidió Gustavo: exclusivo del Panel Auxiliar).
function permitirAuxiliar(req, res, next) {
  if (req.usuario.rol !== 'auxiliar') {
    return res.status(403).json({ error: 'Este asistente solo está disponible para el Panel Auxiliar' });
  }
  next();
}

const SYSTEM_INSTRUCTION = `Eres GusTI, el asistente virtual del Panel Auxiliar de ScoreDocente, un sistema de un colegio en Perú (Cervantes School). Trabajas codo a codo con personal auxiliar que pasa el día con niños, así que tu tono es cercano, alegre y positivo — no formal ni robótico.
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

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_GUSTIA}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: { text: SYSTEM_INSTRUCTION } },
        contents: [{ parts: [{ text: pregunta }] }],
        generationConfig: { maxOutputTokens: 300 }
      })
    });

    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error('Error de la API de Gemini:', data);
      return res.status(500).json({ error: 'GusTI (IA) no pudo responder en este momento.' });
    }

    const partes = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const texto = Array.isArray(partes) ? partes.map((p) => p.text || '').join('').trim() : '';

    res.json({ respuesta: texto || 'No tengo una respuesta para eso ahora mismo.' });
  } catch (err) {
    console.error('Error en /api/gustia:', err);
    res.status(500).json({ error: 'Error interno al conectar con GusTI (IA).' });
  }
});

module.exports = router;
