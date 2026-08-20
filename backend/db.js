require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('connect', () => {
  console.log('✅ Conectado a la base de datos');
});

pool.on('error', (err) => {
  console.error('❌ Error en la base de datos:', err.message);
});

// Migración automática e idempotente: agrega la columna "reforzamiento" a
// asistencias si todavía no existe. Antes, "No asistió a Reforzamiento" y
// "No asistió a Círculo" eran valores del mismo campo "estado" que Presente/
// Falta/Tardanza, así que marcar uno borraba al otro (la auxiliar solo podía
// dejar registrado UN estado por alumno por día). Con esta columna aparte,
// la asistencia normal de la mañana y el Reforzamiento/Círculo de la tarde
// se guardan de forma independiente y ya no se pisan entre sí.
pool.query('ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS reforzamiento VARCHAR(5)')
  .then(() => console.log('✅ Columna "reforzamiento" verificada en asistencias'))
  .catch(err => console.error('⚠️  No se pudo verificar/crear la columna "reforzamiento":', err.message));

module.exports = pool;