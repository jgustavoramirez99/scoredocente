const db = require('../db');

// Registra una acción en el log de auditoría.
// Nunca lanza error hacia arriba: si falla el registro de auditoría,
// no debe tumbar la operación principal (crear/editar/eliminar) que sí le importa al usuario.
//
// tabla: nombre lógico de la tabla/módulo afectado (ej: 'evaluaciones', 'asistencias')
// registro_id: id de la fila afectada
// accion: 'crear' | 'editar' | 'eliminar'
// usuario: req.usuario (viene del token, tiene id y nombre)
// descripcion: texto corto legible para humanos (ej: "Evaluación de Juan Pérez")
// datos: objeto opcional con snapshot de los datos relevantes (útil sobre todo en 'eliminar',
//        para poder reconstruir qué había si luego lo vuelven a registrar)
async function registrarAuditoria({ tabla, registro_id, accion, usuario, descripcion, datos }) {
  try {
    await db.query(
      `INSERT INTO auditoria (tabla, registro_id, accion, usuario_id, usuario_nombre, descripcion, datos)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tabla,
        registro_id || null,
        accion,
        usuario.id,
        usuario.nombre || usuario.email || 'Desconocido',
        descripcion || null,
        datos ? JSON.stringify(datos) : null
      ]
    );
  } catch (err) {
    console.error('⚠️  Error al registrar auditoría (no afecta la operación principal):', err.message);
  }
}

module.exports = { registrarAuditoria };
