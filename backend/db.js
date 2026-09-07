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


// Migración idempotente: crea la tabla "psico_alumnos_seguimiento" (lista de
// alumnos derivados a psicología) y la siembra UNA sola vez con la lista que
// Gustavo subió. Es una lista viva, no un historial por fecha: se edita, se
// agregan o quitan alumnos, y la columna "fecha" es solo para filtrar qué
// alumnos se revisaron en un día puntual (no crea una copia nueva por fecha).
pool.query(`CREATE TABLE IF NOT EXISTS psico_alumnos_seguimiento (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  grado VARCHAR(30),
  competencias VARCHAR(255),
  observacion TEXT,
  responsable VARCHAR(150),
  fecha DATE,
  orden INTEGER DEFAULT 0,
  creado_en TIMESTAMP DEFAULT NOW(),
  actualizado_en TIMESTAMP DEFAULT NOW()
)`)
  .then(async () => {
    console.log('✅ Tabla "psico_alumnos_seguimiento" verificada');
    try {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM psico_alumnos_seguimiento');
      if (rows[0].total === 0) {
        const SEED_ALUMNOS_PSICO = [
          { nombre: 'FERNANDEZ HURTADO DALIA', grado: 'P 4A', competencias: 'MATEMATICA' },
          { nombre: 'JORGE FLORES IBET CRISEL', grado: 'P 4B', competencias: 'MATEMATICA' },
          { nombre: 'CCANTO PINEDO EMIR EYDAN', grado: 'P 5 A', competencias: '4 CURSOS' },
          { nombre: 'MOLINA TRUJILLO JASMIN ALONDRA', grado: 'p 5 a', competencias: 'varios' },
          { nombre: 'HOYOS HUAMAN PIERO YAIR', grado: 'P 5 A', competencias: '4 CURSOS' },
          { nombre: 'VIERA ZEGARRA CEDRIC ARGEN', grado: 'p 5 a', competencias: '2 cursos' },
          { nombre: 'ALBORNOZ BAILETTY ALEXANDER RANDU', grado: 'p 5 B', competencias: 'varios' },
          { nombre: 'ANGELES RAMIRES ALIS SHAMILA', grado: 'p 6', competencias: '2 cursos' },
          { nombre: 'ANTEZANA HUARANCCA KEREN XIMENA', grado: 'p 6', competencias: '2 cursos' },
          { nombre: 'ANTEZANA HUARANCCA JOSUE', grado: 's 1', competencias: 'varios' },
          { nombre: 'CHIROQUE FLORES MATHIAS SAUL', grado: 's 1', competencias: 'varios' },
          { nombre: 'HERNANDEZ BALCAZAR THIAGO GIANPIER', grado: 's 1', competencias: 'varios' },
          { nombre: 'HUAMAN ESTELA STIVEN ENAU', grado: 's 1', competencias: 'varios' },
          { nombre: 'MACHUCA JAUREGUI ELBER EDUARDO', grado: 's 1', competencias: 'varios' },
          { nombre: 'MEJIA QUIROZ JOSE ALFREDO', grado: 's 1', competencias: 'varios' },
          { nombre: 'PELAEZ SUSANIBAR CIELO ARACELY', grado: 's1', competencias: 'matematicas' },
          { nombre: 'RUIZ MONDRAGON CRISTHIAN OMAR', grado: 's 1', competencias: 'varios' },
          { nombre: 'SILVA GUEVARA MILS JOARI', grado: 's 1', competencias: 'varios' },
          { nombre: 'VASQUEZ ESPINOZA MARIA FERNANDA', grado: 's1', competencias: 'varios' },
          { nombre: 'VASQUEZ SANCHEZ GUIANFRANCO', grado: 's1', competencias: 'varios' },
          { nombre: 'VEGA CAYETANO JOSE MARIO', grado: 's1', competencias: 'varios' },
          { nombre: 'ZAMORA DIAZ MICHAEL JORS', grado: 's 1', competencias: 'varios' },
          { nombre: 'ABARCA SOLANO FERNANDA STEFANIA', grado: 's2', competencias: 'varios' },
          { nombre: 'ROJAS ROJAS KATERINE VIVIANA', grado: 's 2', competencias: 'varios' },
          { nombre: 'SALAZAR GOYA MATIAS ISRAEL', grado: 's 2', competencias: 'varios' },
          { nombre: 'ARMAS LEZAMETA BIANCA FLOR', grado: 's3', competencias: 'varios' },
          { nombre: 'CONTRERAS TARAZONA JADE VIANCA', grado: 's3', competencias: 'varios' },
          { nombre: 'DIAZ LLERENA JOSEPH DAMIAN', grado: 's3', competencias: 'varios' },
          { nombre: 'GUILLENA OEREZ JENNIFER MILAGROS', grado: 's3', competencias: 'varios' },
          { nombre: 'JARA ADRIANZEN ANGEL RAUL', grado: 's3', competencias: 'varios' },
          { nombre: 'NIETO PANDAL KERLY VALENTINA', grado: 's3', competencias: 'varios' },
          { nombre: 'PILCO ZEVALLOS PATRICK ARTURO GUILLERMO', grado: 's3', competencias: 'varios' },
          { nombre: 'QUISPE MAYO NATALY MIA', grado: 's3', competencias: 'varios' },
          { nombre: 'ROMAN SILVA BRANDON PIERO', grado: 's3', competencias: 'varios' },
          { nombre: 'SIFUENTES ESPINOZA RAFAELA DAYANA', grado: 's3', competencias: 'varios' },
          { nombre: 'SILVA SANCHEZ LUCAS ERLIN', grado: 's3', competencias: 'varios' },
          { nombre: 'VEGA CAYETANO DULCE CELENE', grado: 's3', competencias: 'varios' },
          { nombre: 'ANCHIRAICO AVENDAÑO FRANKLIN YERI', grado: 's4', competencias: 'varios' },
          { nombre: 'CAYO NAVIO HECTOR MATIAS', grado: 's4', competencias: 'varios' },
          { nombre: 'CHAVEZ LIVAQUE JESUS RICHARD', grado: 's4', competencias: 'varios' },
          { nombre: 'CONDORI YAURI BRENDA LIZET', grado: 's4', competencias: 'varios' },
          { nombre: 'CUMPA CRUZADO LUIS FABIANO', grado: 's4', competencias: 'varios' },
          { nombre: 'DE LA CRUZ ZEGARRA MASHIEL PERSEVERANDA', grado: 's4', competencias: 'varios' },
          { nombre: 'FALCON PINTADO ARIEL EZEQUIEL', grado: 's4', competencias: 'varios' },
          { nombre: 'FARFAN PANTOJA ZAID HOSUMI', grado: 's4', competencias: 'varios' },
          { nombre: 'HIDALGO RAMOS DALTON JOEL', grado: 's4', competencias: 'varios' },
          { nombre: 'PAREJA LAZO JULIAN FABRIZIO', grado: 's4', competencias: 'varios' },
          { nombre: 'QUEZADA DIEGO MAYCOL ZEILER', grado: 's4', competencias: 'varios' },
          { nombre: 'RAMIREZ CASIMIRO EMILY MILAGROS', grado: 's4', competencias: 'varios' },
          { nombre: 'ROSALES SANCHEZ DAYVE ADRIAN', grado: 's4', competencias: 'varios' },
          { nombre: 'VASQUEZ ESPINOZA CARLOS DANIEL', grado: 's4', competencias: 'varios' },
          { nombre: 'VEGA JARA JULIANCITO RAUL', grado: 's4', competencias: 'varios' },
          { nombre: 'ZEGARRA MORALES YOSHIRA MAYTE', grado: 's4', competencias: '3 cursos' },
          { nombre: 'ABRIGO CUENCA PIERO RONALDO', grado: 's5', competencias: 'varios' },
          { nombre: 'ALEGRE BUSTAMANTE ERICK ANTONY', grado: 's5', competencias: 'varios' },
          { nombre: 'GONZALES DIAZ YEFERSON YAMPIER', grado: 's5', competencias: 'varios' },
          { nombre: 'PEREZ VEGA ANGEL ALBERTO', grado: 's5', competencias: 'varios' },
          { nombre: 'TOLENTINO PILLACA ELIAS AARON', grado: 's5', competencias: '3 cursos' },
          { nombre: 'TREJO SOTO ADRIANO DAVID', grado: 's5', competencias: '3 crursos' },
          { nombre: 'VEGA CAYETANO HANS WAYRA', grado: 's5', competencias: 'varios' },
          { nombre: 'VELASQUEZ LOPES LEXS FRANCO', grado: 's5', competencias: 'varios' }
        ];
        const values = [];
        const params = [];
        SEED_ALUMNOS_PSICO.forEach((a, i) => {
          const base = i * 4;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
          params.push(a.nombre, a.grado, a.competencias, i);
        });
        await pool.query(
          `INSERT INTO psico_alumnos_seguimiento (nombre, grado, competencias, orden) VALUES ${values.join(', ')}`,
          params
        );
        console.log(`✅ Sembrados ${SEED_ALUMNOS_PSICO.length} alumnos iniciales en "psico_alumnos_seguimiento"`);
      }
    } catch (e) {
      console.error('⚠️  No se pudo sembrar "psico_alumnos_seguimiento":', e.message);
    }
  })
  .catch(err => console.error('⚠️  No se pudo verificar/crear la tabla "psico_alumnos_seguimiento":', err.message));

module.exports = pool;