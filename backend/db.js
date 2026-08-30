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


// Migración idempotente: crea la tabla "fichas_docentes" si no existe.
// Guarda la ficha de datos personales que cada docente llena una sola vez
// (antes se llenaba en una página aparte -Netlify- y quedaba en un Excel;
// ahora queda centralizada aquí, visible solo para el Gerente General).
pool.query(`CREATE TABLE IF NOT EXISTS fichas_docentes (
  id SERIAL PRIMARY KEY,
  nombres VARCHAR(150) NOT NULL,
  apellidos VARCHAR(150) NOT NULL,
  dni VARCHAR(15) UNIQUE NOT NULL,
  fecha_nacimiento DATE,
  genero VARCHAR(20),
  estado_civil VARCHAR(30),
  celular VARCHAR(20),
  correo VARCHAR(150),
  direccion VARCHAR(255),
  nivel_educativo VARCHAR(50),
  ingles VARCHAR(50),
  educacion_secundaria VARCHAR(255),
  educacion_tecnica VARCHAR(255),
  educacion_universitaria VARCHAR(255),
  educacion_postgrado VARCHAR(255),
  conyuge_nombre VARCHAR(150),
  conyuge_dni VARCHAR(15),
  hijos JSONB DEFAULT '[]',
  sistema_pension VARCHAR(20),
  entidad_pension VARCHAR(50),
  cuspp VARCHAR(30),
  cuenta_bcp VARCHAR(30),
  foto_base64 TEXT,
  procesado BOOLEAN DEFAULT false,
  creado_en TIMESTAMP DEFAULT NOW(),
  actualizado_en TIMESTAMP DEFAULT NOW()
)`)
  .then(() => console.log('✅ Tabla "fichas_docentes" verificada'))
  .catch(err => console.error('⚠️  No se pudo verificar/crear la tabla "fichas_docentes":', err.message));

// Migración idempotente: tablas de la mensajería interna (todas las cuentas
// pueden escribirse entre sí, o mandar un mensaje general a todas a la vez).
// destinatario_id NULL = mensaje general (a todas las cuentas).
pool.query(`CREATE TABLE IF NOT EXISTS mensajes (
  id SERIAL PRIMARY KEY,
  remitente_id INTEGER NOT NULL REFERENCES usuarios(id),
  destinatario_id INTEGER REFERENCES usuarios(id),
  texto TEXT NOT NULL,
  creado_en TIMESTAMP DEFAULT NOW()
)`)
  .then(() => console.log('✅ Tabla "mensajes" verificada'))
  .catch(err => console.error('⚠️  No se pudo verificar/crear la tabla "mensajes":', err.message));

// Registra qué usuario ya leyó qué mensaje — sirve tanto para mensajes
// directos como generales (un mensaje general se marca leído por cada
// cuenta que lo abre, de forma independiente).
pool.query(`CREATE TABLE IF NOT EXISTS mensajes_leidos (
  mensaje_id INTEGER NOT NULL REFERENCES mensajes(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  leido_en TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (mensaje_id, usuario_id)
)`)
  .then(() => console.log('✅ Tabla "mensajes_leidos" verificada'))
  .catch(err => console.error('⚠️  No se pudo verificar/crear la tabla "mensajes_leidos":', err.message));

module.exports = pool;