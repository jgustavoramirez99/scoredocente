const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('./auth');

// Revisa el nombre exacto del modelo en console.anthropic.com si Anthropic
// publica una versión más nueva — este es el que estaba vigente al armar esto.
const MODEL_CHATBOT = 'claude-sonnet-4-5-20250929';

// Solo las cuentas con rol "auxiliar" pueden usar este asistente (así lo
// pidió Gustavo: el chatbot es exclusivo del Panel Auxiliar).
function permitirAuxiliar(req, res, next) {
  if (req.usuario.rol !== 'auxiliar') {
    return res.status(403).json({ error: 'Este asistente solo está disponible para el Panel Auxiliar' });
  }
  next();
}

// Fecha de HOY en Perú (America/Lima) — igual que en routes/asistencias.js
function hoyISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date());
}

const SYSTEM_PROMPT = `Eres el asistente virtual del Panel Auxiliar de ScoreDocente (Cervantes School).
Ayudas a la persona auxiliar a usar el panel y a consultar datos reales de asistencia de HOY.
Responde siempre en español, de forma breve, cálida y directa (máximo 4-5 líneas salvo que te pidan más detalle).

Cómo se usa el Panel Auxiliar (para responder dudas de uso):
- "Asistencia de hoy": selecciona un salón en el desplegable, marca la Asistencia de cada alumno (Presente / Falta Injustificada / Falta Justificada / Tardanza Injustificada / Tardanza Justificada) y dale clic a "💾 Guardar" en esa fila. También se puede registrar el celular del apoderado y una Observación.
- El botón "✅ Marcar todos presentes" marca y guarda como Presente a todos los alumnos que sigan "Sin marcar" en ese salón (no toca a los que ya tienen algo marcado, y pide confirmación antes de aplicarlo).
- Arriba de la tabla hay tarjetas de resumen (Presentes / Ausentes / Tardanzas / Sin marcar) y una barra de progreso que se actualizan solas según se va marcando.
- El botón "💬 WhatsApp" en cada fila abre un mensaje predeterminado al celular del apoderado, según lo que se haya marcado.
- "Resumen por salón" muestra el resumen semanal de asistencia por salón.
- "Evaluación Censal" es para registrar los resultados de la evaluación censal de comprensión lectora de un salón.
- Solo se puede registrar la asistencia del día de HOY, no de días pasados.

Si preguntan por datos concretos de asistencia de hoy (cuántos faltaron, quién falta, cuántos presentes hay en un salón, etc.), usa SIEMPRE las herramientas disponibles para consultar la base de datos real antes de responder — nunca inventes números ni nombres.
Si te preguntan algo fuera de este panel (charla casual, cómo estás, etc.), puedes responder con naturalidad y calidez, sin problema — no hace falta que todo gire en torno a la asistencia.`;

const TOOLS = [
  {
    name: 'listar_salones',
    description: 'Devuelve la lista de todos los salones del colegio (id y nombre). Úsalo si no sabes el nombre exacto de un salón o para confirmar cuáles existen.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'resumen_asistencia_salon_hoy',
    description: 'Devuelve el resumen real de asistencia de HOY para un salón: cuántos alumnos están presentes, con falta, con tardanza y sin marcar todavía, además de los nombres de quienes tienen falta o tardanza.',
    input_schema: {
      type: 'object',
      properties: {
        salon_nombre: { type: 'string', description: 'Nombre o parte del nombre del salón, ej. "1ro A Primaria" o "1A".' }
      },
      required: ['salon_nombre']
    }
  }
];

async function ejecutarHerramienta(nombre, input) {
  if (nombre === 'listar_salones') {
    const r = await db.query('SELECT id, nombre FROM salones ORDER BY orden');
    return r.rows;
  }

  if (nombre === 'resumen_asistencia_salon_hoy') {
    const fecha = hoyISO();
    const salonRes = await db.query(
      'SELECT id, nombre FROM salones WHERE nombre ILIKE $1 ORDER BY orden LIMIT 1',
      ['%' + (input.salon_nombre || '') + '%']
    );
    if (!salonRes.rows.length) {
      return { error: `No encontré ningún salón que coincida con "${input.salon_nombre}".` };
    }
    const salon = salonRes.rows[0];

    const alumnosRes = await db.query(
      `SELECT al.apellidos_nombres, asi.estado
       FROM alumnos al
       LEFT JOIN asistencias asi ON asi.alumno_id = al.id AND asi.fecha = $2
       WHERE al.salon_id = $1 AND al.activo = true
       ORDER BY al.numero`,
      [salon.id, fecha]
    );
    const filas = alumnosRes.rows;
    const presentes = filas.filter((f) => f.estado === 'P');
    const faltas = filas.filter((f) => f.estado === 'FI' || f.estado === 'FJ');
    const tardanzas = filas.filter((f) => f.estado === 'TI' || f.estado === 'TJ');
    const sinMarcar = filas.filter((f) => !f.estado);

    return {
      salon: salon.nombre,
      fecha,
      total_alumnos: filas.length,
      presentes: presentes.length,
      faltas: faltas.length,
      tardanzas: tardanzas.length,
      sin_marcar: sinMarcar.length,
      alumnos_con_falta: faltas.map((f) => f.apellidos_nombres),
      alumnos_con_tardanza: tardanzas.map((f) => f.apellidos_nombres)
    };
  }

  return { error: 'Herramienta desconocida' };
}

// POST /api/chatbot — { mensajes: [{ role: 'user'|'assistant', content: '...' }, ...] }
router.post('/', verificarToken, permitirAuxiliar, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'El asistente todavía no está configurado (falta ANTHROPIC_API_KEY en el servidor).' });
  }

  const mensajes = Array.isArray(req.body.mensajes) ? req.body.mensajes : [];
  if (!mensajes.length) return res.status(400).json({ error: 'mensajes es requerido' });

  try {
    // Solo mandamos los últimos turnos para no crecer el contexto sin límite
    let conversacion = mensajes.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    let respuestaFinal = null;
    let intentos = 0;

    while (intentos < 4 && respuestaFinal === null) {
      intentos++;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODEL_CHATBOT,
          max_tokens: 700,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: conversacion
        })
      });

      const data = await claudeRes.json();
      if (!claudeRes.ok) {
        console.error('Error de la API de Claude:', data);
        return res.status(500).json({ error: 'El asistente no pudo responder en este momento.' });
      }

      if (data.stop_reason === 'tool_use') {
        conversacion.push({ role: 'assistant', content: data.content });
        const toolResults = [];
        for (const bloque of data.content) {
          if (bloque.type === 'tool_use') {
            const resultado = await ejecutarHerramienta(bloque.name, bloque.input || {});
            toolResults.push({
              type: 'tool_result',
              tool_use_id: bloque.id,
              content: JSON.stringify(resultado)
            });
          }
        }
        conversacion.push({ role: 'user', content: toolResults });
        continue; // vuelve a llamar a Claude con el resultado de la herramienta
      }

      const textoBloques = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text);
      respuestaFinal = textoBloques.join('\n').trim() || 'No tengo una respuesta para eso ahora mismo.';
    }

    res.json({ respuesta: respuestaFinal || 'No pude generar una respuesta, intenta de nuevo.' });
  } catch (err) {
    console.error('Error en /api/chatbot:', err);
    res.status(500).json({ error: 'Error interno al conectar con el asistente.' });
  }
});

module.exports = router;
