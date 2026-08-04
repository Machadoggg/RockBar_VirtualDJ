const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'autoplay-log.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([]), 'utf8');
}

function readLog() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeLog(list) {
  ensureFile();
  fs.writeFileSync(LOG_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// Historial en memoria de las ultimas N canciones autopuestas (para no
// repetir seguido). Se reinicia si el server se reinicia — no hace falta
// persistirlo, solo sirve para variar la seleccion durante la noche.
let recentIds = [];

/**
 * Elige una cancion al azar del catalogo, evitando las ultimas
 * `historySize` que ya se autopusieron. Si el catalogo es tan chico
 * que no queda ningun candidato fuera del historial, lo resetea y
 * elige de todo el catalogo — nunca se queda sin poder elegir nada.
 */
function pickAutoplaySong(allSongs, historySize) {
  if (!allSongs.length) return null;

  let candidates = allSongs.filter((s) => !recentIds.includes(s.id));
  if (!candidates.length) {
    recentIds = [];
    candidates = allSongs;
  }

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

  recentIds.push(chosen.id);
  if (recentIds.length > historySize) recentIds.shift();

  return chosen;
}

function recordAutoplay(song) {
  const list = readLog();
  list.push({
    songId: song.id,
    title: song.title,
    artist: song.artist,
    category: song.category,
    at: new Date().toISOString(),
  });
  writeLog(list.slice(-500)); // acotado, para que no crezca sin limite
}

function getRecentLog(limit = 20) {
  return readLog().slice(-limit).reverse();
}

module.exports = { pickAutoplaySong, recordAutoplay, getRecentLog };