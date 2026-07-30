const staff = require('./staff');
const attendance = require('./attendance');

function hoursOf(turno) {
  // Turnos sin salida (todavia en curso) no suman horas hasta que se cierren.
  if (!turno.salida) return 0;
  const ms = new Date(turno.salida) - new Date(turno.entrada);
  return ms / 3600000;
}

function isWithinRange(turno, desde, hasta) {
  const entrada = new Date(turno.entrada).getTime();
  return entrada >= desde.getTime() && entrada <= hasta.getTime();
}

/**
 * Totaliza horas y pago estimado por empleado en un rango de fechas.
 * Incluye empleados inactivos si tuvieron turnos en ese rango (por si
 * alguien se dio de baja a mitad de la quincena, sus horas previas
 * igual deben aparecer en el reporte).
 */
function computeTotals(desdeStr, hastaStr) {
  const desde = new Date(desdeStr);
  const hasta = new Date(hastaStr);
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    return { ok: false, message: 'Rango de fechas invalido.' };
  }

  const allStaff = staff.getAllStaff();
  const allShifts = attendance.getAllShifts();

  const rows = allStaff
    .map((emp) => {
      const shiftsDelEmpleado = allShifts.filter(
        (t) => t.empleadoId === emp.id && isWithinRange(t, desde, hasta)
      );
      if (!shiftsDelEmpleado.length) return null; // no trabajo en este rango, no aparece

      const turnosAbiertos = shiftsDelEmpleado.filter((t) => !t.salida).length;
      const horas = shiftsDelEmpleado.reduce((sum, t) => sum + hoursOf(t), 0);
      const total = horas * emp.tarifaPorHora;

      return {
        empleadoId: emp.id,
        nombre: emp.nombre,
        rol: emp.rol,
        tarifaPorHora: emp.tarifaPorHora,
        turnos: shiftsDelEmpleado.length,
        turnosAbiertos,
        horas: Math.round(horas * 100) / 100,
        total: Math.round(total),
      };
    })
    .filter(Boolean);

  return { ok: true, desde: desde.toISOString(), hasta: hasta.toISOString(), rows };
}

function toCsv(rows) {
  const header = ['Empleado', 'Rol', 'Tarifa/hora', 'Turnos', 'Turnos abiertos', 'Horas', 'Total a pagar'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        `"${(r.nombre || '').replace(/"/g, '""')}"`,
        `"${(r.rol || '').replace(/"/g, '""')}"`,
        r.tarifaPorHora,
        r.turnos,
        r.turnosAbiertos,
        r.horas,
        r.total,
      ].join(',')
    );
  }
  return lines.join('\n');
}

module.exports = { computeTotals, toCsv };