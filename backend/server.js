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
app.use('/api/auth', authRouter);

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});