const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ADS_FILE = path.join(DATA_DIR, 'ads.json');

function ensureAdsFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ADS_FILE)) fs.writeFileSync(ADS_FILE, JSON.stringify([]), 'utf8');
}

function readAds() {
  ensureAdsFile();
  try {
    const raw = fs.readFileSync(ADS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch {
    return [];
  }
}

function writeAds(ads) {
  ensureAdsFile();
  fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2), 'utf8');
}

// Misma idea de cola que usa lib/store.js, para que dos guardados
// concurrentes no se pisen al escribir el archivo.
let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(() => fn());
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function getAllAds() {
  return readAds().sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

function getActiveAds() {
  return getAllAds().filter((ad) => ad.isActive);
}

function createAd(payload) {
  return withLock(() => {
    const ads = readAds();
    const nextId = ads.reduce((max, ad) => Math.max(max, ad.id), 0) + 1;
    const ad = {
      id: nextId,
      title: String(payload.title || '').trim(),
      description: payload.description ? String(payload.description).trim() : null,
      imageUrl: payload.imageUrl ? String(payload.imageUrl).trim() : null,
      emoji: payload.emoji ? String(payload.emoji).trim() : null,
      badge: payload.badge ? String(payload.badge).trim() : null,
      displayOrder: Number.isFinite(Number(payload.displayOrder)) ? Number(payload.displayOrder) : 0,
      isActive: payload.isActive !== false,
    };
    ads.push(ad);
    writeAds(ads);
    return ad;
  });
}

function updateAd(id, payload) {
  return withLock(() => {
    const ads = readAds();
    const idx = ads.findIndex((ad) => ad.id === id);
    if (idx === -1) return null;
    ads[idx] = {
      ...ads[idx],
      title: payload.title !== undefined ? String(payload.title).trim() : ads[idx].title,
      description: payload.description ? String(payload.description).trim() : null,
      imageUrl: payload.imageUrl ? String(payload.imageUrl).trim() : null,
      emoji: payload.emoji ? String(payload.emoji).trim() : null,
      badge: payload.badge ? String(payload.badge).trim() : null,
      displayOrder: Number.isFinite(Number(payload.displayOrder)) ? Number(payload.displayOrder) : ads[idx].displayOrder,
      isActive: payload.isActive !== false,
    };
    writeAds(ads);
    return ads[idx];
  });
}

function deleteAd(id) {
  return withLock(() => {
    const ads = readAds();
    const next = ads.filter((ad) => ad.id !== id);
    writeAds(next);
    return next.length !== ads.length;
  });
}

module.exports = { getAllAds, getActiveAds, createAd, updateAd, deleteAd };