const express = require('express');
const router = express.Router();
const db = require('../db');
const ExcelJS = require('exceljs');
const { verificarToken, esLaura } = require('./auth');

// Solo la psicóloga (y el director, como respaldo, igual que en otras rutas)
// puede ver o editar esta lista. Laura (auxiliar) también puede, a pedido de
// Gustavo — ver esLaura() en auth.js.
const ROLES_PERMITIDOS = ['psicologa', 'director'];

function permitirRoles(req, res, next) {
  if (!ROLES_PERMITIDOS.includes(req.usuario.rol) && !esLaura(req.usuario)) {
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  }
  next();
}

// GET /api/psico-alumnos — lista completa. Es una lista viva (no un
// historial por fecha), así que siempre se trae todo; el filtro por fecha
// se aplica en el frontend sobre estos mismos datos.
router.get('/', verificarToken, permitirRoles, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre, grado, competencias, observacion, responsable, fecha, orden
       FROM psico_alumnos_seguimiento
       ORDER BY orden, id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al listar alumnos de psicología:', err);
    res.status(500).json({ error: 'Error al obtener la lista' });
  }
});

// POST /api/psico-alumnos/guardar — reemplaza la lista completa en una
// transacción: actualiza los que traen id, inserta los nuevos (sin id) y
// borra los que ya no vienen en el arreglo (el alumno se quitó en el panel).
router.post('/guardar', verificarToken, permitirRoles, async (req, res) => {
  const { alumnos } = req.body;
  if (!Array.isArray(alumnos)) {
    return res.status(400).json({ error: 'Formato inválido' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const idsActuales = alumnos.filter(a => a.id).map(a => a.id);
    if (idsActuales.length) {
      await client.query('DELETE FROM psico_alumnos_seguimiento WHERE id != ALL($1::int[])', [idsActuales]);
    } else {
      await client.query('DELETE FROM psico_alumnos_seguimiento');
    }

    for (let i = 0; i < alumnos.length; i++) {
      const a = alumnos[i];
      const nombre = (a.nombre || '').trim();
      if (!nombre) continue;
      const grado = (a.grado || '').trim() || null;
      const competencias = (a.competencias || '').trim() || null;
      const observacion = (a.observacion || '').trim() || null;
      const responsable = (a.responsable || '').trim() || null;
      const fecha = a.fecha || null;

      if (a.id) {
        await client.query(
          `UPDATE psico_alumnos_seguimiento
           SET nombre=$1, grado=$2, competencias=$3, observacion=$4, responsable=$5, fecha=$6, orden=$7, actualizado_en=NOW()
           WHERE id=$8`,
          [nombre, grado, competencias, observacion, responsable, fecha, i, a.id]
        );
      } else {
        await client.query(
          `INSERT INTO psico_alumnos_seguimiento (nombre, grado, competencias, observacion, responsable, fecha, orden)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [nombre, grado, competencias, observacion, responsable, fecha, i]
        );
      }
    }

    await client.query('COMMIT');

    const result = await db.query(
      `SELECT id, nombre, grado, competencias, observacion, responsable, fecha, orden
       FROM psico_alumnos_seguimiento ORDER BY orden, id`
    );
    res.json({ mensaje: 'Lista guardada correctamente', alumnos: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al guardar lista de alumnos de psicología:', err);
    res.status(500).json({ error: 'Error al guardar', detalle: err.message });
  } finally {
    client.release();
  }
});
// GET /api/psico-alumnos/exportar-excel — genera el Excel de la lista de
// seguimiento. Acepta ?fecha=YYYY-MM-DD opcional para exportar solo lo
// filtrado en el panel (mismo filtro que usa el frontend).
router.get('/exportar-excel', verificarToken, permitirRoles, async (req, res) => {
  try {
    const { fecha } = req.query;
    let query = `SELECT nombre, grado, competencias, observacion, responsable, fecha
                 FROM psico_alumnos_seguimiento`;
    const params = [];
    if (fecha) {
      params.push(fecha);
      query += ` WHERE fecha = $1`;
    }
    query += ` ORDER BY orden, id`;
    const result = await db.query(query, params);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ScoreDocente';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Alumnos en seguimiento', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });

    sheet.columns = [
      { header: 'Nombre y Apellidos', key: 'nombre', width: 32 },
      { header: 'Grado', key: 'grado', width: 12 },
      { header: 'Competencias', key: 'competencias', width: 26 },
      { header: 'Observación', key: 'observacion', width: 30 },
      { header: 'Responsable', key: 'responsable', width: 22 },
      { header: 'Fecha', key: 'fecha', width: 14 },
    ];

    // Encabezado — lavanda suave
    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7D2F0' } };
      cell.font = { bold: true, color: { argb: 'FF33406B' }, size: 12, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFB8C4E0' } },
        bottom: { style: 'thin', color: { argb: 'FFB8C4E0' } },
        left: { style: 'thin', color: { argb: 'FFB8C4E0' } },
        right: { style: 'thin', color: { argb: 'FFB8C4E0' } },
      };
    });

    result.rows.forEach((a, i) => {
      const row = sheet.addRow({
        nombre: a.nombre || '',
        grado: a.grado || '',
        competencias: a.competencias || '',
        observacion: a.observacion || '—',
        responsable: a.responsable || '—',
        fecha: a.fecha ? new Date(a.fecha).toLocaleDateString('es-PE') : '—',
      });
      row.height = 20;
      const bg = i % 2 === 0 ? 'FFF3F5FB' : 'FFFFFFFF'; // filas alternadas
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { size: 11, color: { argb: 'FF3A3A3A' }, name: 'Calibri' };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE3E7F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE3E7F0' } },
          left: { style: 'thin', color: { argb: 'FFE3E7F0' } },
          right: { style: 'thin', color: { argb: 'FFE3E7F0' } },
        };
      });
    });

    sheet.autoFilter = { from: 'A1', to: 'F1' };

    const fileName = `alumnos_seguimiento_psicologia_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al exportar Excel de alumnos de psicología:', err);
    res.status(500).json({ error: 'Error al generar el Excel' });
  }
});
module.exports = router;
