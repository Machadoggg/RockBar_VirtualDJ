// Calendario de festivos de Colombia, calculado automaticamente para
// cualquier año — no requiere mantenimiento manual ni actualizar una
// lista cada 1 de enero.
//
// Fuente de las reglas: Ley 51 de 1983 (Ley Emiliani). Los festivos NO
// listados como "fijos" abajo se trasladan al lunes siguiente si no caen
// ya en lunes. Jueves y Viernes Santo son la excepcion: se calculan a
// partir de la Pascua pero NUNCA se trasladan (siempre caen jueves/viernes).

function computeEasterSunday(year) {
  // Algoritmo de Meeus/Jones/Butcher (calendario gregoriano).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function moveToNextMonday(date) {
  const dow = date.getDay(); // 0=domingo, 1=lunes, ...
  if (dow === 1) return date;
  const diasParaLunes = ((1 - dow + 7) % 7) || 7;
  return addDays(date, diasParaLunes);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const holidayCache = new Map();

function getColombianHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);

  // Festivos fijos: NUNCA se trasladan, caigan en el dia que caigan.
  const fijos = [
    new Date(year, 0, 1),   // Año Nuevo
    new Date(year, 4, 1),   // Dia del Trabajo
    new Date(year, 6, 20),  // Independencia
    new Date(year, 7, 7),   // Batalla de Boyaca
    new Date(year, 11, 8),  // Inmaculada Concepcion
    new Date(year, 11, 25), // Navidad
  ];

  // Festivos que se trasladan al lunes siguiente (Ley Emiliani).
  const trasladables = [
    new Date(year, 0, 6),   // Reyes Magos
    new Date(year, 2, 19),  // San Jose
    new Date(year, 5, 29),  // San Pedro y San Pablo
    new Date(year, 7, 15),  // Asuncion de la Virgen
    new Date(year, 9, 12),  // Dia de la Raza
    new Date(year, 10, 1),  // Todos los Santos
    new Date(year, 10, 11), // Independencia de Cartagena
  ].map(moveToNextMonday);

  // Basados en la fecha de Pascua.
  const pascua = computeEasterSunday(year);
  const basadosEnPascua = [
    addDays(pascua, -3),                     // Jueves Santo (no se traslada)
    addDays(pascua, -2),                     // Viernes Santo (no se traslada)
    moveToNextMonday(addDays(pascua, 39)),   // Ascension del Señor
    moveToNextMonday(addDays(pascua, 60)),   // Corpus Christi
    moveToNextMonday(addDays(pascua, 68)),   // Sagrado Corazon
  ];

  const todos = [...fijos, ...trasladables, ...basadosEnPascua];
  const set = new Set(todos.map(dateKey));
  holidayCache.set(year, set);
  return set;
}

function isHoliday(date) {
  return getColombianHolidays(date.getFullYear()).has(dateKey(date));
}

function isSundayOrHoliday(date) {
  return date.getDay() === 0 || isHoliday(date);
}

module.exports = { isHoliday, isSundayOrHoliday, getColombianHolidays };