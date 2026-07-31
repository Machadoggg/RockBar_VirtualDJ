const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'missing-songs.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([]), 'utf8');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeAll(list) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(() => fn());
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function logMissingSong(query, nickname) {
  return withLock(() => {
    const list = readAll();
    list.push({
      query: String(query || '').trim().slice(0, 100),
      nickname: nickname ? String(nickname).trim().slice(0, 30) : null,
      at: new Date().toISOString(),
    });
    writeAll(list);
    return { ok: true };
  });
}

function getAll() {
  return readAll().sort((a, b) => new Date(b.at) - new Date(a.at));
}

module.exports = { logMissingSong, getAll };