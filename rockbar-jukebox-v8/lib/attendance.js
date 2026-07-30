const fs = require('fs');
const path = require('path');
const staff = require('./staff');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ATTENDANCE_FILE)) fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify([]), 'utf8');
}

function readAttendance() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeAttendance(list) {
  ensureFile();
  fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// Misma cola que los otros modulos, para que dos fichadas simultaneas
// (dos empleados fichando casi al mismo tiempo en el kiosco) no se pisen.
let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(() => fn());
  queue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Busca si el empleado tiene un turno ABIERTO (entrada sin salida).
 */
function findOpenShift(list, empleadoId) {
  return list.find((t) => t.empleadoId === empleadoId && t.salida === null);
}

/**
 * Fichar por PIN: identifica al empleado, y decide solo segun el
 * estado actual si corresponde abrir turno (entrada) o cerrarlo
 * (salida) — el kiosco no le pregunta al empleado cual de las dos es,
 * evita el error de tocar "Entrada" dos veces seguidas por accidente.
 */
function clockByPin(pin) {
  return withLock(() => {
    const empleado = staff.getActiveStaff().find((s) => s.pin === String(pin || '').trim());
    if (!empleado) {
      return { ok: false, message: 'PIN no reconocido.' };
    }

    const list = readAttendance();
    const open = findOpenShift(list, empleado.id);

    if (open) {
      // Habia un turno abierto: esto es la salida.
      open.salida = new Date().toISOString();
      writeAttendance(list);
      return { ok: true, tipo: 'salida', empleado: empleado.nombre, turno: open };
    }

    // No habia turno abierto: esto es la entrada.
    const nextId = list.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const turno = {
      id: nextId,
      empleadoId: empleado.id,
      entrada: new Date().toISOString(),
      salida: null,
      origen: 'kiosco',
      notas: null,
      editadoPor: null,
    };
    list.push(turno);
    writeAttendance(list);
    return { ok: true, tipo: 'entrada', empleado: empleado.nombre, turno };
  });
}

function getAllShifts() {
  return readAttendance().sort((a, b) => new Date(b.entrada) - new Date(a.entrada));
}

function getOpenShifts() {
  return readAttendance().filter((t) => t.salida === null);
}

/**
 * Correccion manual desde el superadmin: ajustar entrada/salida de un
 * turno (por ej. alguien se olvido de fichar salida), o agregar notas.
 * Queda registrado que fue editado, para trazabilidad ante un reclamo.
 */
function editShift(id, payload, editorLabel) {
  return withLock(() => {
    const list = readAttendance();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return { ok: false, message: 'Turno no encontrado.' };

    const turno = list[idx];

    if (payload.entrada) {
      const d = new Date(payload.entrada);
      if (isNaN(d.getTime())) return { ok: false, message: 'Fecha de entrada invalida.' };
      turno.entrada = d.toISOString();
    }

    if (payload.salida !== undefined) {
      if (payload.salida === null || payload.salida === '') {
        turno.salida = null;
      } else {
        const d = new Date(payload.salida);
        if (isNaN(d.getTime())) return { ok: false, message: 'Fecha de salida invalida.' };
        turno.salida = d.toISOString();
      }
    }

    if (turno.salida && new Date(turno.salida) <= new Date(turno.entrada)) {
      return { ok: false, message: 'La salida debe ser posterior a la entrada.' };
    }

    if (payload.notas !== undefined) turno.notas = payload.notas ? String(payload.notas).trim() : null;

    turno.editadoPor = editorLabel || 'superadmin';
    writeAttendance(list);
    return { ok: true, turno };
  });
}

/**
 * Crear un turno manualmente (ej: el empleado nunca ficho ese dia pero
 * si trabajo, y el superadmin lo carga a mano).
 */
function createManualShift(payload, editorLabel) {
  return withLock(() => {
    const empleadoId = Number(payload.empleadoId);
    const empleado = staff.getAllStaff().find((s) => s.id === empleadoId);
    if (!empleado) return { ok: false, message: 'Empleado no encontrado.' };

    const entrada = new Date(payload.entrada);
    if (isNaN(entrada.getTime())) return { ok: false, message: 'Fecha de entrada invalida.' };

    let salida = null;
    if (payload.salida) {
      salida = new Date(payload.salida);
      if (isNaN(salida.getTime())) return { ok: false, message: 'Fecha de salida invalida.' };
      if (salida <= entrada) return { ok: false, message: 'La salida debe ser posterior a la entrada.' };
    }

    const list = readAttendance();
    const nextId = list.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const turno = {
      id: nextId,
      empleadoId,
      entrada: entrada.toISOString(),
      salida: salida ? salida.toISOString() : null,
      origen: 'manual',
      notas: payload.notas ? String(payload.notas).trim() : null,
      editadoPor: editorLabel || 'superadmin',
    };
    list.push(turno);
    writeAttendance(list);
    return { ok: true, turno };
  });
}

function deleteShift(id) {
  return withLock(() => {
    const list = readAttendance();
    const next = list.filter((t) => t.id !== id);
    writeAttendance(next);
    return { ok: next.length !== list.length };
  });
}

module.exports = {
  clockByPin,
  getAllShifts,
  getOpenShifts,
  editShift,
  createManualShift,
  deleteShift,
};