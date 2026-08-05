const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Convierte un nombre de archivo "Titulo - Artista.ext" en { title, artist }.
 * Si no tiene el separador " - ", se usa el nombre completo como titulo.
 */
function parseTitleArtist(baseName) {
  const sep = ' - ';
  const idx = baseName.indexOf(sep);
  if (idx === -1) {
    return { title: baseName.trim(), artist: '' };
  }
  const title = baseName.slice(0, idx).trim();
  const artist = baseName.slice(idx + sep.length).trim();
  return { title, artist };
}

function stableId(fullPath) {
  return crypto.createHash('sha1').update(fullPath).digest('hex').slice(0, 16);
}

const UNCATEGORIZED_LABEL = 'Sin categoria';

/**
 * Escanea UNA carpeta (no recursivo dentro de si misma) y le asigna la
 * categoria indicada a cada cancion encontrada ahi.
 */
function scanFolder(folderPath, videoExtensions, category) {
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isFile())
    .filter((e) => videoExtensions.includes(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const ext = path.extname(e.name);
      const baseName = path.basename(e.name, ext);
      const { title, artist } = parseTitleArtist(baseName);
      const fullPath = path.join(folderPath, e.name);
      return {
        id: stableId(fullPath),
        filename: e.name,
        baseName,
        title: title || baseName,
        artist,
        category,
        fullPath,
      };
    });
}

/**
 * Escanea la carpeta raiz de videos, un nivel de profundidad:
 * - Archivos sueltos directo en la raiz -> categoria "Sin categoria"
 *   (mantiene compatibilidad con lo que ya tenias antes de organizar en
 *   subcarpetas).
 * - Cada subcarpeta de primer nivel (ej: "Metal", "Español", "80s") se
 *   usa tal cual como nombre de categoria.
 * No se baja mas de un nivel (subcarpetas dentro de subcarpetas se ignoran).
 */
function scanSongs(config) {
  const { videosFolder, videoExtensions } = config;
  if (!videosFolder || !fs.existsSync(videosFolder)) {
    return { error: `La carpeta de videos no existe o no esta configurada: "${videosFolder}"`, songs: [] };
  }

  let rootEntries;
  try {
    rootEntries = fs.readdirSync(videosFolder, { withFileTypes: true });
  } catch (err) {
    return { error: `No se pudo leer la carpeta de videos: ${err.message}`, songs: [] };
  }

  let songs = [];

  songs = songs.concat(scanFolder(videosFolder, videoExtensions, UNCATEGORIZED_LABEL));

  const subfolders = rootEntries.filter((e) => e.isDirectory());
  for (const dir of subfolders) {
    const categoryFolder = path.join(videosFolder, dir.name);
    songs = songs.concat(scanFolder(categoryFolder, videoExtensions, dir.name));
  }

  songs.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));

  return { error: null, songs };
}

/**
 * Lista de categorias distintas encontradas actualmente (para pintar los
 * chips de filtro sin tener que derivarlo del lado del cliente).
 */
function getCategories(config) {
  const { songs } = scanSongs(config);
  const set = new Set(songs.map((s) => s.category));
  return [...set].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

// ---------- Cache ----------
// scanSongs() usa fs.readdirSync (SINCRONO Y BLOQUEANTE): mientras lee el
// disco, Node se congela para TODOS los usuarios conectados a la vez, no
// solo para quien pidio esa request. Con muchos celulares haciendo su
// auto-refresh casi al mismo tiempo, eso se traduce en escaneos de disco
// repetidos e innecesarios (el catalogo no cambia segundo a segundo).
// Este cache evita releer la carpeta si el ultimo escaneo tiene menos de
// CACHE_TTL_MS de antiguedad.
const CACHE_TTL_MS = 8000;
let songsCache = { result: null, fetchedAt: 0 };

function scanSongsCached(config) {
  const now = Date.now();
  if (songsCache.result && now - songsCache.fetchedAt < CACHE_TTL_MS) {
    return songsCache.result;
  }
  const result = scanSongs(config);
  if (!result.error) {
    songsCache = { result, fetchedAt: now };
  }
  return result;
}

/**
 * Invalida el cache manualmente (por ejemplo justo despues de un pedido
 * exitoso, para que el "En lista" se refleje al toque sin esperar el TTL).
 */
function invalidateSongsCache() {
  songsCache = { result: null, fetchedAt: 0 };
}

function getCategoriesCached(config) {
  const { songs } = scanSongsCached(config);
  const set = new Set(songs.map((s) => s.category));
  return [...set].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

module.exports = {
  scanSongs: scanSongsCached,
  getCategories: getCategoriesCached,
  invalidateSongsCache,
  parseTitleArtist,
  UNCATEGORIZED_LABEL,
};