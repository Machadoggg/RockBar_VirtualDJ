const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'payroll-rates.json');

// Valores iniciales: los 3 recargos fijos del Codigo Sustantivo del Trabajo
// (no cambian con frecuencia) y el historial de recargo dominical/festivo,
// que SI cambia cada 1 de julio segun la reforma laboral.
const DEFAULT_RATES = {
  fixed: {
    nightSurcharge: 0.35, // recargo nocturno (7pm-6am)
    extraDay: 0.25,       // hora extra diurna
    extraNight: 0.75,     // hora extra nocturna
  },
  dominicalFestivoTiers: [
    { vigenteDesde: '2025-07-01', vigenteHasta: '2026-06-30', recargo: 0.80 },
    { vigenteDesde: '2026-07-01', vigenteHasta: '2027-06-30', recargo: 0.90 },
    { vigenteDesde: '2027-07-01', vigenteHasta: null, recargo: 1.00 },
  ],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULT_RATES, null, 2), 'utf8');
}

function readRates() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return DEFAULT_RATES;
  }
}

function writeRates(data) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(() => fn());
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function getRates() {
  return readRates();
}

function isValidDateStr(s) {
  if (!s) return false;
  return !isNaN(new Date(s).getTime());
}

/**
 * Reemplaza el set completo de tasas (fijas + historial de dominical).
 * Se valida que cada tramo tenga fecha de inicio valida y que el
 * recargo sea un numero razonable (entre 0 y 3, es decir 0% a 300%,
 * para atajar errores de tipeo obvios sin ser demasiado restrictivo).
 */
function updateRates(payload) {
  return withLock(() => {
    const fixed = payload.fixed || {};
    const nightSurcharge = Number(fixed.nightSurcharge);
    const extraDay = Number(fixed.extraDay);
    const extraNight = Number(fixed.extraNight);

    if (![nightSurcharge, extraDay, extraNight].every((n) => Number.isFinite(n) && n >= 0 && n <= 3)) {
      return { ok: false, message: 'Los recargos fijos deben ser numeros validos entre 0 y 3 (ej: 0.35 para 35%).' };
    }

    const tiers = Array.isArray(payload.dominicalFestivoTiers) ? payload.dominicalFestivoTiers : [];
    if (!tiers.length) {
      return { ok: false, message: 'Debe haber al menos un tramo de recargo dominical/festivo.' };
    }

    for (const t of tiers) {
      if (!isValidDateStr(t.vigenteDesde)) {
        return { ok: false, message: 'Cada tramo necesita una fecha "vigente desde" valida.' };
      }
      if (t.vigenteHasta && !isValidDateStr(t.vigenteHasta)) {
        return { ok: false, message: 'La fecha "vigente hasta" no es valida (dejala vacia si sigue vigente).' };
      }
      const recargo = Number(t.recargo);
      if (!Number.isFinite(recargo) || recargo < 0 || recargo > 3) {
        return { ok: false, message: 'El recargo dominical/festivo debe ser un numero entre 0 y 3 (ej: 0.90 para 90%).' };
      }
    }

    const sorted = [...tiers].sort((a, b) => new Date(a.vigenteDesde) - new Date(b.vigenteDesde));

    const data = {
      fixed: { nightSurcharge, extraDay, extraNight },
      dominicalFestivoTiers: sorted.map((t) => ({
        vigenteDesde: t.vigenteDesde,
        vigenteHasta: t.vigenteHasta || null,
        recargo: Number(t.recargo),
      })),
    };

    writeRates(data);
    return { ok: true, rates: data };
  });
}

/**
 * Devuelve el recargo dominical/festivo vigente para una fecha dada.
 * Si la fecha cae antes del primer tramo o despues de todos (sin
 * "vigenteHasta" abierto que la cubra), se usa el tramo mas cercano
 * en vez de fallar, para nunca dejar una nomina sin calcular por un
 * hueco de configuracion.
 */
function getDominicalRateForDate(date) {
  const { dominicalFestivoTiers } = readRates();
  const t = date.getTime();

  for (const tier of dominicalFestivoTiers) {
    const desde = new Date(tier.vigenteDesde).getTime();
    const hasta = tier.vigenteHasta ? new Date(tier.vigenteHasta + 'T23:59:59').getTime() : Infinity;
    if (t >= desde && t <= hasta) return tier.recargo;
  }

  // Fallback: el tramo cuya fecha de inicio esta mas cerca de la fecha buscada.
  const ordenados = [...dominicalFestivoTiers].sort(
    (a, b) => Math.abs(new Date(a.vigenteDesde) - t) - Math.abs(new Date(b.vigenteDesde) - t)
  );
  return ordenados[0] ? ordenados[0].recargo : 0.9;
}

module.exports = { getRates, updateRates, getDominicalRateForDate };