const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STAFF_FILE = path.join(DATA_DIR, 'staff.json');

function ensureStaffFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STAFF_FILE)) fs.writeFileSync(STAFF_FILE, JSON.stringify([]), 'utf8');
}

function readStaff() {
  ensureStaffFile();
  try {
    return JSON.parse(fs.readFileSync(STAFF_FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeStaff(list) {
  ensureStaffFile();
  fs.writeFileSync(STAFF_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// Misma cola que lib/store.js y lib/ads.js, para que dos guardados
// concurrentes no se pisen.
let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(() => fn());
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

/**
 * Chequea que el PIN no lo tenga ya otro empleado ACTIVO (dos empleados
 * inactivos pueden compartir un PIN viejo sin problema, ya no se usan
 * para fichar).
 */
function pinTakenByOther(list, pin, excludeId) {
  return list.some((s) => s.activo && s.pin === pin && s.id !== excludeId);
}

function getAllStaff() {
  return readStaff().sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function getActiveStaff() {
  return getAllStaff().filter((s) => s.activo);
}

function createStaff(payload) {
  return withLock(() => {
    const list = readStaff();

    const nombre = String(payload.nombre || '').trim();
    if (!nombre) return { ok: false, message: 'El nombre es obligatorio.' };

    const pin = String(payload.pin || '').trim();
    if (!isValidPin(pin)) return { ok: false, message: 'El PIN debe ser de 4 digitos.' };
    if (pinTakenByOther(list, pin, null)) {
      return { ok: false, message: 'Ese PIN ya lo usa otro empleado activo.' };
    }

    const tarifaPorHora = Number(payload.tarifaPorHora);
    if (!Number.isFinite(tarifaPorHora) || tarifaPorHora < 0) {
      return { ok: false, message: 'La tarifa por hora debe ser un numero valido.' };
    }

    const nextId = list.reduce((max, s) => Math.max(max, s.id), 0) + 1;
    const empleado = {
      id: nextId,
      nombre,
      rol: payload.rol ? String(payload.rol).trim() : null,
      pin,
      tarifaPorHora,
      activo: true,
      fechaIngreso: new Date().toISOString(),
    };

    list.push(empleado);
    writeStaff(list);
    return { ok: true, empleado };
  });
}

function updateStaff(id, payload) {
  return withLock(() => {
    const list = readStaff();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return { ok: false, message: 'Empleado no encontrado.' };

    const current = list[idx];

    const nombre = payload.nombre !== undefined ? String(payload.nombre).trim() : current.nombre;
    if (!nombre) return { ok: false, message: 'El nombre es obligatorio.' };

    let pin = current.pin;
    if (payload.pin !== undefined && payload.pin !== '') {
      pin = String(payload.pin).trim();
      if (!isValidPin(pin)) return { ok: false, message: 'El PIN debe ser de 4 digitos.' };
      if (pinTakenByOther(list, pin, id)) {
        return { ok: false, message: 'Ese PIN ya lo usa otro empleado activo.' };
      }
    }

    let tarifaPorHora = current.tarifaPorHora;
    if (payload.tarifaPorHora !== undefined) {
      tarifaPorHora = Number(payload.tarifaPorHora);
      if (!Number.isFinite(tarifaPorHora) || tarifaPorHora < 0) {
        return { ok: false, message: 'La tarifa por hora debe ser un numero valido.' };
      }
    }

    list[idx] = {
      ...current,
      nombre,
      rol: payload.rol !== undefined ? String(payload.rol).trim() || null : current.rol,
      pin,
      tarifaPorHora,
      activo: payload.activo !== undefined ? !!payload.activo : current.activo,
    };

    writeStaff(list);
    return { ok: true, empleado: list[idx] };
  });
}

/**
 * Baja logica (no se borra el registro): un empleado que se va deja de
 * poder fichar, pero su historial de turnos (Fase 2/3) sigue existiendo
 * para reportes de periodos pasados.
 */
function deactivateStaff(id) {
  return withLock(() => {
    const list = readStaff();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return { ok: false, message: 'Empleado no encontrado.' };
    list[idx].activo = false;
    writeStaff(list);
    return { ok: true, empleado: list[idx] };
  });
}

function reactivateStaff(id) {
  return withLock(() => {
    const list = readStaff();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return { ok: false, message: 'Empleado no encontrado.' };
    if (pinTakenByOther(list, list[idx].pin, id)) {
      return { ok: false, message: 'No se puede reactivar: otro empleado activo ya usa ese PIN. Cambialo primero.' };
    }
    list[idx].activo = true;
    writeStaff(list);
    return { ok: true, empleado: list[idx] };
  });
}

module.exports = {
  getAllStaff,
  getActiveStaff,
  createStaff,
  updateStaff,
  deactivateStaff,
  reactivateStaff,
};