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

/**
 * Escanea la carpeta de videos (no recursivo, para mantenerlo simple y
 * predecible) y devuelve la lista de canciones disponibles.
 */
function scanSongs(config) {
  const { videosFolder, videoExtensions } = config;

  if (!videosFolder || !fs.existsSync(videosFolder)) {
    return { error: `La carpeta de videos no existe o no esta configurada: "${videosFolder}"`, songs: [] };
  }

  let entries;
  try {
    entries = fs.readdirSync(videosFolder, { withFileTypes: true });
  } catch (err) {
    return { error: `No se pudo leer la carpeta de videos: ${err.message}`, songs: [] };
  }

  const songs = entries
    .filter((e) => e.isFile())
    .filter((e) => videoExtensions.includes(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const ext = path.extname(e.name);
      const baseName = path.basename(e.name, ext);
      const { title, artist } = parseTitleArtist(baseName);
      const fullPath = path.join(videosFolder, e.name);
      return {
        id: stableId(fullPath),
        filename: e.name,
        baseName,
        title: title || baseName,
        artist,
        fullPath,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));

  return { error: null, songs };
}

module.exports = { scanSongs, parseTitleArtist };
