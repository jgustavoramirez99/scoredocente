require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});