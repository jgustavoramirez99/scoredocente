const db = require('./db');
db.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'evaluaciones\'')
.then(r => {
  console.log('Columnas:', r.rows);
  process.exit();
});
