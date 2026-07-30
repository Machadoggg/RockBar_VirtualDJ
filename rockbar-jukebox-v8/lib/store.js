const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'requests.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}), 'utf8');
}

function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Cola simple para evitar que dos escrituras concurrentes se pisen
// (el volumen de pedidos de un bar es bajo, esto alcanza sin sumar una DB real).
let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(() => fn());
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Estructura de datos por noche (data[nightKey]):
 * {
 *   devices: {
 *     [deviceId]: {
 *       nickname: string|null,
 *       ip: string,
 *       requests: [{ songId, at, viaCredit }],
 *       credits: number,
 *       creditLog: [{ type: 'instagram'|'game', amount, at }],
 *       instagramClaimed: boolean,
 *       lastGameAt: string|null,
 *     }
 *   }
 * }
 *
 * NOTA: que canciones estan "en el Automix ahora" ya NO se guarda aca — se
 * consulta en vivo a VirtualDJ (ver server.js / lib/vdj.js,
 * getLiveAutomixPathSet). Antes se llevaba una marca propia por noche, pero
 * quedaba pegada en "En lista" para siempre aunque la cancion ya hubiera
 * terminado de sonar y VirtualDJ la hubiera sacado de su lista.
 */

function blankDevice() {
  return {
    nickname: null,
    ip: '',
    requests: [],
    credits: 0,
    creditLog: [],
    instagramClaimed: false,
    lastGameAt: null,
  };
}

function ensureNight(data, nightKey) {
  if (!data[nightKey]) data[nightKey] = { devices: {} };
  if (!data[nightKey].devices) data[nightKey].devices = {};
  return data[nightKey];
}

function ensureDevice(night, deviceId) {
  if (!night.devices[deviceId]) night.devices[deviceId] = blankDevice();
  return night.devices[deviceId];
}

/**
 * Cuenta cuantos pedidos "gratis" (no pagados con credito) hizo el
 * dispositivo dentro de la ventana rodante de windowMinutes, y calcula
 * cuando se libera el proximo lugar gratis si ya no le quedan.
 */
function computeWindowStatus(device, windowMinutes, maxPerWindow) {
  const windowMs = windowMinutes * 60 * 1000;
  const now = Date.now();
  const freeInWindow = device.requests
    .filter((r) => !r.viaCredit)
    .map((r) => new Date(r.at).getTime())
    .filter((t) => now - t < windowMs)
    .sort((a, b) => a - b);

  const used = freeInWindow.length;
  const remainingFree = Math.max(0, maxPerWindow - used);
  let nextFreeSlotAt = null;
  if (remainingFree === 0 && freeInWindow.length > 0) {
    nextFreeSlotAt = new Date(freeInWindow[0] + windowMs).toISOString();
  }
  return { usedInWindow: used, remainingFree, nextFreeSlotAt };
}

/**
 * Devuelve el estado completo de un dispositivo para mostrar en el celular:
 * nickname, creditos, cupo libre de la ventana, y si ya reclamo instagram /
 * cuando puede volver a jugar.
 */
function getDeviceStatus(nightKey, deviceId, config) {
  const data = readData();
  const night = data[nightKey] || { devices: {} };
  const device = night.devices[deviceId] || blankDevice();

  const windowStatus = computeWindowStatus(device, config.requestWindowMinutes, config.requestsPerWindow);

  let gameAvailableAt = null;
  if (device.lastGameAt) {
    const nextAt = new Date(device.lastGameAt).getTime() + config.gameCooldownMinutes * 60 * 1000;
    if (nextAt > Date.now()) gameAvailableAt = new Date(nextAt).toISOString();
  }

  return {
    nickname: device.nickname,
    credits: device.credits,
    instagramClaimed: device.instagramClaimed,
    gameAvailableAt,
    ...windowStatus,
  };
}

/**
 * Guarda/actualiza el nickname de un dispositivo para la noche actual.
 */
function setNickname(nightKey, deviceId, nickname, ip) {
  return withLock(() => {
    const data = readData();
    const night = ensureNight(data, nightKey);
    const device = ensureDevice(night, deviceId);
    device.nickname = nickname;
    device.ip = ip;
    writeData(data);
    return { ok: true };
  });
}

/**
 * Intenta registrar un pedido. Primero consume un lugar gratis de la
 * ventana rodante; si no hay, consume 1 credito ganado. Si no hay ni
 * cupo libre ni creditos, rechaza.
 */
function tryRegisterRequest({ nightKey, deviceId, ip, songId, config }) {
  return withLock(() => {
    const data = readData();
    const night = ensureNight(data, nightKey);
    const device = ensureDevice(night, deviceId);
    device.ip = ip;

    const windowStatus = computeWindowStatus(device, config.requestWindowMinutes, config.requestsPerWindow);

    let viaCredit = false;
    if (windowStatus.remainingFree <= 0) {
      if (device.credits > 0) {
        viaCredit = true;
      } else {
        return {
          ok: false,
          reason: 'limit',
          nextFreeSlotAt: windowStatus.nextFreeSlotAt,
          credits: device.credits,
        };
      }
    }

    if (viaCredit) device.credits -= 1;
    device.requests.push({ songId, at: new Date().toISOString(), viaCredit });

    writeData(data);

    const after = computeWindowStatus(device, config.requestWindowMinutes, config.requestsPerWindow);
    return { ok: true, viaCredit, credits: device.credits, remainingFree: after.remainingFree, nextFreeSlotAt: after.nextFreeSlotAt };
  });
}

/**
 * Deshace el ultimo pedido de un dispositivo (usado cuando VirtualDJ no
 * pudo agregar la cancion), devolviendole el credito si se habia gastado
 * uno.
 */
function refundRequest(nightKey, deviceId, songId) {
  return withLock(() => {
    const data = readData();
    const night = data[nightKey];
    if (!night || !night.devices[deviceId]) return;
    const device = night.devices[deviceId];

    const idx = [...device.requests].reverse().findIndex((r) => r.songId === songId);
    if (idx === -1) return;
    const realIdx = device.requests.length - 1 - idx;
    const [removed] = device.requests.splice(realIdx, 1);
    if (removed && removed.viaCredit) device.credits += 1;

    writeData(data);
  });
}

/**
 * Otorga el credito por seguir Instagram (una sola vez por noche).
 */
function claimInstagramCredit(nightKey, deviceId, amount) {
  return withLock(() => {
    const data = readData();
    const night = ensureNight(data, nightKey);
    const device = ensureDevice(night, deviceId);

    if (device.instagramClaimed) {
      return { ok: false, reason: 'already-claimed', credits: device.credits };
    }

    device.instagramClaimed = true;
    device.credits += amount;
    device.creditLog.push({ type: 'instagram', amount, at: new Date().toISOString() });
    writeData(data);
    return { ok: true, awarded: amount, credits: device.credits };
  });
}

/**
 * Otorga credito por jugar, respetando el cooldown entre partidas.
 */
function claimGameCredit(nightKey, deviceId, amount, cooldownMinutes) {
  return withLock(() => {
    const data = readData();
    const night = ensureNight(data, nightKey);
    const device = ensureDevice(night, deviceId);

    if (device.lastGameAt) {
      const nextAt = new Date(device.lastGameAt).getTime() + cooldownMinutes * 60 * 1000;
      if (nextAt > Date.now()) {
        return { ok: false, reason: 'cooldown', nextAvailableAt: new Date(nextAt).toISOString(), credits: device.credits };
      }
    }

    device.lastGameAt = new Date().toISOString();
    device.credits += amount;
    device.creditLog.push({ type: 'game', amount, at: new Date().toISOString() });
    writeData(data);
    return { ok: true, awarded: amount, credits: device.credits };
  });
}

/**
 * Resumen de una noche para el panel de administracion.
 */
function getNightSummary(nightKey) {
  const data = readData();
  const night = data[nightKey];
  if (!night || !night.devices) return [];
  return Object.entries(night.devices).map(([deviceId, device]) => ({
    deviceId,
    nickname: device.nickname || null,
    ip: device.ip,
    count: device.requests.length,
    credits: device.credits,
    instagramClaimed: device.instagramClaimed,
    lastRequestAt: device.requests.length ? device.requests[device.requests.length - 1].at : null,
  }));
}

/**
 * Reinicia el cupo de pedidos de un dispositivo (para que pueda pedir
 * de nuevo antes de que pase la ventana de 2hs), sin desloguearlo:
 * conserva nickname, ip, creditos, creditLog e instagramClaimed.
 */
function resetDevice(nightKey, deviceId) {
  return withLock(() => {
    const data = readData();
    const night = data[nightKey];
    if (!night || !night.devices || !night.devices[deviceId]) return;
    night.devices[deviceId].requests = [];
    writeData(data);
  });
}

/**
 * Igual que resetDevice pero para todos los dispositivos de la noche:
 * vacia los pedidos de cada uno, sin borrar nicknames ni creditos.
 */
function resetNight(nightKey) {
  return withLock(() => {
    const data = readData();
    const night = data[nightKey];
    if (!night || !night.devices) return;
    for (const deviceId of Object.keys(night.devices)) {
      night.devices[deviceId].requests = [];
    }
    writeData(data);
  });
}


/**
 * Borra TODOS los registros de la noche (nickname, pedidos, creditos,
 * Instagram, todo). Pensado para usar al cerrar el bar, no durante la
 * noche — a diferencia de resetNight/resetDevice, que solo vacian el
 * cupo de pedidos y conservan al cliente identificado.
 */
function wipeNight(nightKey) {
  return withLock(() => {
    const data = readData();
    delete data[nightKey];
    writeData(data);
  });
}


module.exports = {
  getDeviceStatus,
  setNickname,
  tryRegisterRequest,
  refundRequest,
  claimInstagramCredit,
  claimGameCredit,
  getNightSummary,
  resetNight,
  resetDevice,
  wipeNight,
};


