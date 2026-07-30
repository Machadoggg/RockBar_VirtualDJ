const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');

const config = require('./lib/config');
const { scanSongs } = require('./lib/songs');
const { getNightKey } = require('./lib/night');
const store = require('./lib/store');
const vdj = require('./lib/vdj');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => res.redirect('/admin.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));

const DEVICE_COOKIE = 'jukebox_device_id';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365; // 1 año

function getOrSetDeviceId(req, res) {
  let deviceId = req.cookies[DEVICE_COOKIE];
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    res.cookie(DEVICE_COOKIE, deviceId, {
      maxAge: COOKIE_MAX_AGE_MS,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  return deviceId;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function sanitizeNickname(raw) {
  return String(raw || '')
    .trim()
    .slice(0, 30)
    .replace(/[\r\n\t]/g, ' ');
}

// ---------- Estado "en vivo" del Automix de VirtualDJ ----------
// El boton "En lista" se basa en lo que VirtualDJ tiene REALMENTE en el
// Automix en este momento (no en un registro propio que quedaba pegado
// para siempre). Se cachea unos segundos para no golpear a VirtualDJ con
// una consulta completa cada vez que un celular pide la lista.
const AUTOMIX_CACHE_TTL_MS = 8000;
let automixCache = { pathSet: new Set(), baseNameSet: new Set(), fetchedAt: 0, error: null };

function baseNameOf(filePath) {
  // Las rutas de VirtualDJ siempre son de Windows (backslash), independiente
  // del sistema operativo donde corra este servidor, asi que usamos
  // explicitamente el parser de rutas de Windows.
  return vdj.normalizePath(path.win32.basename(String(filePath || '')));
}

async function refreshAutomixCache() {
  const result = await vdj.getAutomixPaths(config);
  if (result.ok) {
    automixCache = {
      pathSet: new Set(result.paths.map(vdj.normalizePath)),
      baseNameSet: new Set(result.paths.map(baseNameOf)),
      fetchedAt: Date.now(),
      error: null,
    };
  } else {
    // Si VirtualDJ no responde (cerrado, plugin apagado, etc), seguimos
    // usando lo ultimo que sabiamos en vez de romper la lista de canciones.
    automixCache.error = result.error;
  }
  return automixCache;
}

async function getAutomixCache() {
  const now = Date.now();
  if (now - automixCache.fetchedAt < AUTOMIX_CACHE_TTL_MS) {
    return automixCache;
  }
  return refreshAutomixCache();
}

/**
 * Si una cancion esta en el Automix ahora mismo. Se compara primero por
 * ruta completa, y si no matchea, por nombre de archivo solo (mas
 * tolerante a diferencias de mayusculas/unidad de red/barra final entre
 * como esta app arma la ruta y como la reporta VirtualDJ).
 */
function isSongQueued(song, cache) {
  if (cache.pathSet.has(vdj.normalizePath(song.fullPath))) return true;
  return cache.baseNameSet.has(baseNameOf(song.fullPath));
}

/**
 * Despues de agregar una cancion con exito no esperamos a que venza el
 * cache para reflejarlo: la sumamos directo, asi el "En lista" es
 * inmediato para todos en vez de aparecer y desaparecer hasta el proximo
 * refresco real.
 */
function markSongQueuedNow(song) {
  automixCache.pathSet.add(vdj.normalizePath(song.fullPath));
  automixCache.baseNameSet.add(baseNameOf(song.fullPath));
}

// ---------- API publica (clientes del bar) ----------

app.get('/api/config', (req, res) => {
  res.json({
    barName: config.barName,
    requestsPerWindow: config.requestsPerWindow,
    requestWindowMinutes: config.requestWindowMinutes,
    nicknameRequired: config.nicknameRequired,
    creditsPerInstagram: config.creditsPerInstagram,
    creditsPerGame: config.creditsPerGame,
    gameCooldownMinutes: config.gameCooldownMinutes,
    instagramHandle: config.instagramHandle,
    instagramUrl: config.instagramUrl,
  });
});

app.get('/api/songs', async (req, res) => {
  const { error, songs } = scanSongs(config);
  if (error) return res.status(500).json({ error });
  const cache = await getAutomixCache();
  res.json({
    songs: songs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      queued: isSongQueued(s, cache),
    })),
  });
});

app.get('/api/status', (req, res) => {
  const deviceId = getOrSetDeviceId(req, res);
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  const status = store.getDeviceStatus(nightKey, deviceId, config);
  res.json(status);
});

app.post('/api/identify', async (req, res) => {
  const deviceId = getOrSetDeviceId(req, res);
  const ip = getClientIp(req);
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  const nickname = sanitizeNickname(req.body && req.body.nickname);

  if (!nickname) {
    return res.status(400).json({ ok: false, message: 'Escribi un nombre valido.' });
  }

  await store.setNickname(nightKey, deviceId, nickname, ip);
  res.json({ ok: true, nickname });
});

app.post('/api/credits/instagram', async (req, res) => {
  const deviceId = getOrSetDeviceId(req, res);
  const nightKey = getNightKey(new Date(), config.nightResetHour);

  const result = await store.claimInstagramCredit(nightKey, deviceId, config.creditsPerInstagram);
  if (!result.ok) {
    return res.status(409).json({ ok: false, message: 'Ya reclamaste el credito de Instagram esta noche.', credits: result.credits });
  }
  res.json({ ok: true, awarded: result.awarded, credits: result.credits, message: `+${result.awarded} credito por seguirnos en Instagram.` });
});

app.post('/api/credits/game', async (req, res) => {
  const deviceId = getOrSetDeviceId(req, res);
  const nightKey = getNightKey(new Date(), config.nightResetHour);

  const result = await store.claimGameCredit(nightKey, deviceId, config.creditsPerGame, config.gameCooldownMinutes);
  if (!result.ok) {
    return res.status(429).json({ ok: false, message: 'Todavia no podes volver a jugar.', nextAvailableAt: result.nextAvailableAt, credits: result.credits });
  }
  res.json({ ok: true, awarded: result.awarded, credits: result.credits, message: `+${result.awarded} credito por jugar.` });
});

app.post('/api/request', async (req, res) => {
  const deviceId = getOrSetDeviceId(req, res);
  const ip = getClientIp(req);
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  const { songId } = req.body || {};

  if (!songId) {
    return res.status(400).json({ ok: false, message: 'Falta el id de la cancion.' });
  }

  if (config.nicknameRequired) {
    const status = store.getDeviceStatus(nightKey, deviceId, config);
    if (!status.nickname) {
      return res.status(400).json({ ok: false, message: 'Falta poner tu nombre antes de pedir una cancion.' });
    }
  }

  const { error, songs } = scanSongs(config);
  if (error) {
    return res.status(500).json({ ok: false, message: 'No se pudo leer la carpeta de canciones.' });
  }

  const song = songs.find((s) => s.id === songId);
  if (!song) {
    return res.status(404).json({ ok: false, message: 'Esa cancion ya no esta disponible.' });
  }

  const cache = await getAutomixCache();
  if (isSongQueued(song, cache)) {
    return res.status(409).json({ ok: false, message: 'Esa cancion ya esta en el Automix ahora mismo.' });
  }

  const reservation = await store.tryRegisterRequest({
    nightKey,
    deviceId,
    ip,
    songId,
    config,
  });

  if (!reservation.ok) {
    return res.status(429).json({
      ok: false,
      message: `Ya usaste tus ${config.requestsPerWindow} pedidos de las ultimas ${config.requestWindowMinutes} minutos y no te quedan creditos. Segui la cuenta de Instagram o jugá para ganar mas.`,
      nextFreeSlotAt: reservation.nextFreeSlotAt,
      credits: reservation.credits,
    });
  }

  const result = await vdj.addToAutomix(config, {
    folder: config.videosFolder,
    baseName: song.baseName,
  });

  if (!result.ok) {
    // No le cobramos el intento al cliente si VirtualDJ no pudo agregar la cancion.
    await store.refundRequest(nightKey, deviceId, songId);
    return res.status(502).json({
      ok: false,
      message: 'No se pudo agregar la cancion al Automix. Avisale al DJ.',
      debug: result.error,
    });
  }

  // No esperamos a que venza el cache de 8s para que se vea "En lista": la
  // marcamos ya mismo. El proximo refresco real (o cuando termine de sonar
  // y VirtualDJ la saque) va a corregir esto solo si hiciera falta.
  markSongQueuedNow(song);

  res.json({
    ok: true,
    message: `"${song.title}" se agrego al Automix.`,
    viaCredit: reservation.viaCredit,
    remainingFree: reservation.remainingFree,
    nextFreeSlotAt: reservation.nextFreeSlotAt,
    credits: reservation.credits,
  });
});

app.get('/qr.png', async (req, res) => {
  const url = config.publicUrl || `http://localhost:${config.port}`;
  try {
    const buffer = await QRCode.toBuffer(url, { width: 500, margin: 1 });
    res.type('png').send(buffer);
  } catch (err) {
    res.status(500).send('No se pudo generar el QR: ' + err.message);
  }
});

// ---------- Panel de administracion (DJ / encargado) ----------

function checkAdminToken(req, res) {
  const token = req.query.token || req.body?.token || req.headers['x-admin-token'];
  if (!token || token !== config.adminToken) {
    res.status(401).json({ error: 'Token invalido.' });
    return false;
  }
  return true;
}

app.get('/api/admin/summary', (req, res) => {
  if (!checkAdminToken(req, res)) return;
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  const summary = store.getNightSummary(nightKey);
  res.json({
    nightKey,
    requestsPerWindow: config.requestsPerWindow,
    requestWindowMinutes: config.requestWindowMinutes,
    devices: summary,
  });
});

app.post('/api/admin/reset', async (req, res) => {
  if (!checkAdminToken(req, res)) return;
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  const { deviceId } = req.body || {};
  if (deviceId) {
    await store.resetDevice(nightKey, deviceId);
  } else {
    await store.resetNight(nightKey);
  }
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log('==========================================');
  console.log(`  ${config.barName} - Jukebox Automix`);
  console.log(`  Escuchando en el puerto ${config.port}`);
  console.log(`  URL publica configurada: ${config.publicUrl || '(no configurada en .env)'}`);
  console.log(`  Carpeta de videos: ${config.videosFolder || '(no configurada en .env)'}`);
  console.log(`  VirtualDJ Network Control: ${config.vdjHost}:${config.vdjPort}`);
  console.log(`  Limite: ${config.requestsPerWindow} pedidos cada ${config.requestWindowMinutes} min (+ creditos)`);
  console.log('==========================================');
});
