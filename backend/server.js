require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Límite subido de 100kb (default de Express) a 15mb: la ficha de datos del
// docente incluye una foto tipo carnet en base64, que con el límite viejo
// hacía fallar el POST /api/fichas con "413 Payload Too Large" apenas la
// foto pesaba más de 100kb (cualquier foto tomada con celular). Como Express
// no devolvía JSON en ese error, el frontend intentaba parsear HTML como
// JSON y mostraba el mensaje genérico "Error de conexión, inténtalo de
// nuevo", escondiendo la causa real.
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const { router: authRouter } = require('./routes/auth');
const docentesRouter = require('./routes/docentes');
app.use('/api/docentes', docentesRouter);
const evaluacionesRouter = require('./routes/evaluaciones');
app.use('/api/evaluaciones', evaluacionesRouter);
const evaluacionesTutorRouter = require('./routes/evaluaciones_tutor');
app.use('/api/evaluaciones-tutor', evaluacionesTutorRouter);
const evaluacionesCoordinadoresRouter = require('./routes/evaluaciones_coordinadores');
app.use('/api/evaluaciones-coordinadores', evaluacionesCoordinadoresRouter);
// NUEVO: evaluación docente respondida por los propios estudiantes (encuesta)
const evaluacionesEstudiantesRouter = require('./routes/evaluaciones_estudiantes');
app.use('/api/evaluaciones-estudiantes', evaluacionesEstudiantesRouter);
const alumnosRouter = require('./routes/alumnos');
app.use('/api/alumnos', alumnosRouter);
const asistenciasRouter = require('./routes/asistencias');
app.use('/api/asistencias', asistenciasRouter);
const evaluacionCensalRouter = require('./routes/evaluacionCensal');
app.use('/api/evaluacion-censal', evaluacionCensalRouter);
const auditoriaRouter = require('./routes/auditoria');
app.use('/api/auditoria', auditoriaRouter);
const gustiaRouter = require('./routes/gustia');
app.use('/api/gustia', gustiaRouter);
app.use('/api/auth', authRouter);
const fichasRouter = require('./routes/fichas');
app.use('/api/fichas', fichasRouter);

const mensajesRouter = require('./routes/mensajes');
app.use('/api/mensajes', mensajesRouter);

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Manejador de errores: si el body (ej. la foto en base64) supera el
// límite, o llega JSON mal formado, Express por defecto respondía con una
// página HTML de error. El frontend siempre espera JSON (await res.json()),
// así que ese HTML rompía el parseo y aparecía como "Error de conexión,
// inténtalo de nuevo" sin decir la causa real. Ahora responde en JSON.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La foto es demasiado pesada. Sube una imagen más liviana e inténtalo de nuevo.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Los datos enviados no son válidos. Recarga la página e inténtalo de nuevo.' });
  }
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
