const staff = require('./staff');
const attendance = require('./attendance');
const { isSundayOrHoliday } = require('./holidays');
const config = require('./config');

// Multiplicadores sobre el valor de la hora ordinaria diurna
// (tarifaPorHora del empleado). Valores segun la normativa vigente
// desde julio 2026 (jornada de 42h/semana).
const MULT = {
  ordinaryDay: 1.0,      // hora ordinaria diurna (base)
  ordinaryNight: 1.35,   // recargo nocturno (35%)
  ordinaryDaySH: 1.90,   // dominical/festivo diurno (90%)
  ordinaryNightSH: 2.25, // dominical/festivo nocturno (125%)
  extraDay: 1.25,        // hora extra diurna (25%)
  extraNight: 1.75,      // hora extra nocturna (75%)
  extraDaySH: 2.15,      // hora extra diurna dominical/festiva (115%)
  extraNightSH: 2.65,    // hora extra nocturna dominical/festiva (165%)
};

const NIGHT_START_HOUR = 19; // 7:00 p.m.
const NIGHT_END_HOUR = 6;    // 6:00 a.m.

// Umbral de horas ordinarias POR TURNO (no semanal). Es una
// simplificacion: la ley define la hora extra sobre el limite semanal
// (42h), que depende de como se reparten los turnos de cada empleado
// en la semana. Contarlo por turno individual es razonable para un bar
// donde no suele haber turnos partidos el mismo dia, pero si algun
// empleado hace mas de un turno en un mismo dia, este calculo puede no
// coincidir exactamente con el limite legal semanal — conviene
// validarlo con un contador antes de pagar.
const ORDINARY_MINUTES_PER_SHIFT = 8 * 60;

function isNightMinute(date) {
  const h = date.getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

/**
 * Clasifica cada minuto de un turno cerrado en una de las 8 categorias
 * legales, avanzando minuto a minuto (asi el cruce de medianoche y el
 * cambio domingo/festivo quedan siempre bien ubicados en el dia
 * calendario que corresponde).
 */
function classifyShiftMinutes(turno) {
  if (!turno.salida) return null; // turno abierto: no se cuenta todavia

  const start = new Date(turno.entrada);
  const end = new Date(turno.salida);
  const totalMinutes = Math.round((end - start) / 60000);
  if (totalMinutes <= 0) return null;

  const buckets = {
    ordinaryDay: 0, ordinaryNight: 0, ordinaryDaySH: 0, ordinaryNightSH: 0,
    extraDay: 0, extraNight: 0, extraDaySH: 0, extraNightSH: 0,
  };

  let cursor = start.getTime();
  for (let i = 0; i < totalMinutes; i++) {
    const cursorDate = new Date(cursor);
    const night = isNightMinute(cursorDate);
    const sh = isSundayOrHoliday(cursorDate);
    const ordinary = i < ORDINARY_MINUTES_PER_SHIFT;

    let key;
    if (ordinary) {
      key = sh ? (night ? 'ordinaryNightSH' : 'ordinaryDaySH') : (night ? 'ordinaryNight' : 'ordinaryDay');
    } else {
      key = sh ? (night ? 'extraNightSH' : 'extraDaySH') : (night ? 'extraNight' : 'extraDay');
    }
    buckets[key]++;
    cursor += 60000;
  }

  return buckets;
}

function sumBuckets(a, b) {
  const out = {};
  for (const key of Object.keys(MULT)) out[key] = (a[key] || 0) + (b[key] || 0);
  return out;
}

function emptyBuckets() {
  const out = {};
  for (const key of Object.keys(MULT)) out[key] = 0;
  return out;
}

function payFromBuckets(buckets, tarifaPorHora) {
  let total = 0;
  for (const key of Object.keys(MULT)) {
    total += (buckets[key] / 60) * tarifaPorHora * MULT[key];
  }
  return total;
}

function isWithinRange(turno, desde, hasta) {
  const entrada = new Date(turno.entrada).getTime();
  return entrada >= desde.getTime() && entrada <= hasta.getTime();
}

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
      if (!shiftsDelEmpleado.length) return null;

      const turnosAbiertos = shiftsDelEmpleado.filter((t) => !t.salida).length;
      let buckets = emptyBuckets();

      for (const t of shiftsDelEmpleado) {
        const b = classifyShiftMinutes(t);
        if (b) buckets = sumBuckets(buckets, b);
      }

      const horasTotales = Object.values(buckets).reduce((s, m) => s + m, 0) / 60;
      const horasNocturnas = (buckets.ordinaryNight + buckets.ordinaryNightSH + buckets.extraNight + buckets.extraNightSH) / 60;
      const horasDominicalFestivo = (buckets.ordinaryDaySH + buckets.ordinaryNightSH + buckets.extraDaySH + buckets.extraNightSH) / 60;
      const horasExtra = (buckets.extraDay + buckets.extraNight + buckets.extraDaySH + buckets.extraNightSH) / 60;

      const totalHoras = payFromBuckets(buckets, emp.tarifaPorHora);

      // --- Auxilio de transporte (Paso 1.3) ---
      let auxilioTransporte = 0;
      let diasConAuxilio = 0;
      if (emp.aplicaAuxilioTransporte) {
        diasConAuxilio = countWorkedDays(shiftsDelEmpleado, desde, hasta);
        const valorDiario = config.auxilioTransporteMensual / config.auxilioTransporteDiasMes;
        auxilioTransporte = Math.round(diasConAuxilio * valorDiario);
      }

      const total = Math.round(totalHoras) + auxilioTransporte;

      return {
        empleadoId: emp.id,
        nombre: emp.nombre,
        rol: emp.rol,
        tarifaPorHora: emp.tarifaPorHora,
        turnos: shiftsDelEmpleado.length,
        turnosAbiertos,
        horasTotales: Math.round(horasTotales * 100) / 100,
        horasNocturnas: Math.round(horasNocturnas * 100) / 100,
        horasDominicalFestivo: Math.round(horasDominicalFestivo * 100) / 100,
        horasExtra: Math.round(horasExtra * 100) / 100,
        diasConAuxilio,
        auxilioTransporte,
        total,
      };
    })
    .filter(Boolean);

  return { ok: true, desde: desde.toISOString(), hasta: hasta.toISOString(), rows };
}


function toCsv(rows) {
  const header = [
    'Empleado', 'Rol', 'Tarifa/hora', 'Turnos', 'Turnos abiertos',
    'Horas totales', 'Horas nocturnas', 'Horas dominical/festivo', 'Horas extra',
    'Dias con auxilio', 'Auxilio transporte', 'Total a pagar',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        `"${(r.nombre || '').replace(/"/g, '""')}"`,
        `"${(r.rol || '').replace(/"/g, '""')}"`,
        r.tarifaPorHora,
        r.turnos,
        r.turnosAbiertos,
        r.horasTotales,
        r.horasNocturnas,
        r.horasDominicalFestivo,
        r.horasExtra,
        r.diasConAuxilio,
        r.auxilioTransporte,
        r.total,
      ].join(',')
    );
  }
  return lines.join('\n');
}


/**
 * Cuenta cuantos dias CALENDARIO distintos tuvo el empleado con al menos
 * un turno CERRADO (con salida) dentro del rango [desde, hasta]. Un mismo
 * dia con 2 turnos (por ejemplo entrada temprano y otra entrada de noche)
 * cuenta como 1 solo dia para el prorrateo del auxilio.
 */
function countWorkedDays(shifts, desde, hasta) {
  const dias = new Set();
  for (const t of shifts) {
    if (!t.salida) continue; // turnos abiertos no cuentan para el prorrateo
    const entrada = new Date(t.entrada);
    if (entrada < desde || entrada > hasta) continue;
    const key = `${entrada.getFullYear()}-${entrada.getMonth()}-${entrada.getDate()}`;
    dias.add(key);
  }
  return dias.size;
}


module.exports = { computeTotals, toCsv, MULT };