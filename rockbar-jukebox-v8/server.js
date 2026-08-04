const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');

const config = require('./lib/config');
//const { scanSongs } = require('./lib/songs');
const { getNightKey } = require('./lib/night');
const store = require('./lib/store');
const vdj = require('./lib/vdj');
const ads = require('./lib/ads');
const staff = require('./lib/staff');
const attendance = require('./lib/attendance');
const payroll = require('./lib/payroll');
const missingSongs = require('./lib/missingSongs');
const { scanSongs, getCategories } = require('./lib/songs');
const payrollRates = require('./lib/payrollRates');

const autoplay = require('./lib/autoplay');

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
let automixCache = { pathSet: new Set(), baseNameSet: new Set(), count: 0, fetchedAt: 0, error: null };

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
      count: result.paths.length, // ← nuevo: cantidad REAL de posiciones, sin deduplicar
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


let autoplayInFlight = false; // evita que dos chequeos se superpongan

async function checkAutoplay() {
  if (!config.autoplayEnabled) return;
  if (autoplayInFlight) return;
  autoplayInFlight = true;

  try {
    const cache = await refreshAutomixCache();
    if (cache.error) {
      if (config.debugVdj) console.log(`[autoplay] VirtualDJ no respondio: ${cache.error}`);
      return;
    }

    const queueCount = cache.count;
    if (config.debugVdj) console.log(`[autoplay] Chequeo — cola actual: ${queueCount} cancion(es).`);

    if (queueCount > config.autoplayMinQueue) {
      if (config.debugVdj) console.log(`[autoplay] Cola suficiente (${queueCount} > ${config.autoplayMinQueue}), no hago nada.`);
      return;
    }

    const { error, songs } = scanSongs(config);
    if (error || !songs.length) return;

    const availableForClients = songs.filter((s) => !isSongQueued(s, cache));
    if (!availableForClients.length) return;

    const song = autoplay.pickAutoplaySong(availableForClients, config.autoplayHistorySize);
    if (!song) return;

    if (queueCount === 0 && config.vdjAutomixStartScript) {
      console.log('[autoplay] Automix estaba vacio, activando motor de Automix...');
      await vdj.runStep(config, config.vdjAutomixStartScript);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const countBefore = cache.count;

    const result = await vdj.addToAutomix(config, {
      folder: path.dirname(song.fullPath),
      baseName: song.baseName,
    });

    if (!result.ok) {
      if (config.debugVdj) console.log(`[autoplay] No se pudo agregar: ${result.error}`);
      return;
    }

    // Verificacion real: VDJ puede devolver "true" en el script aunque la
    // cancion no haya quedado realmente en el Automix (esto pasa cuando
    // el Automix arranca vacio y el motor no esta "activo"). Confirmamos
    // consultando el conteo real despues de agregar.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const verifyCache = await refreshAutomixCache();

    if (verifyCache.ok !== false && verifyCache.count > countBefore) {
      markRecentlyAdded(song);
      autoplay.recordAutoplay(song);
      console.log(`🎵 Automix bajo — se agrego automaticamente: "${song.title}"`);
    } else {
      console.log(`⚠️  Automix bajo — se INTENTO agregar "${song.title}" pero VirtualDJ no la sumo realmente (conteo antes=${countBefore}, despues=${verifyCache.count}). Revisar si el Automix esta activo.`);
    }
  } catch (err) {
    if (config.debugVdj) console.log('[autoplay] Error inesperado:', err.message);
  } finally {
    autoplayInFlight = false;
  }
}

if (config.autoplayEnabled) {
  setInterval(checkAutoplay, config.autoplayCheckIntervalSeconds * 1000);
}


// Canciones que ESTA APP agrego hace poco. Mientras esten dentro del
// margen de gracia, se muestran "En lista" SIEMPRE, sin importar lo que
// diga (o no detecte) la consulta en vivo a VirtualDJ en ese rato. Esto
// blinda contra el boton "parpadeando" de vuelta a Agregar a los pocos
// segundos si la consulta en vivo tarda en reflejar el cambio.
const recentlyAdded = new Map(); // normalizedPath -> timestamp (ms)

function markRecentlyAdded(song) {
  recentlyAdded.set(vdj.normalizePath(song.fullPath), Date.now());
}

function isWithinGrace(song) {
  const key = vdj.normalizePath(song.fullPath);
  const addedAt = recentlyAdded.get(key);
  if (!addedAt) return false;
  const graceMs = config.automixRecentGraceMinutes * 60 * 1000;
  if (Date.now() - addedAt > graceMs) {
    recentlyAdded.delete(key); // ya vencio, limpiamos
    return false;
  }
  return true;
}

/**
 * Si una cancion esta en el Automix ahora mismo. Primero respeta el
 * margen de gracia de lo que esta app agrego hace poco; si no aplica,
 * compara contra la consulta en vivo por ruta completa y, si no matchea,
 * por nombre de archivo solo (mas tolerante a diferencias de mayusculas/
 * unidad de red/barra final entre como esta app arma la ruta y como la
 * reporta VirtualDJ).
 */
function isSongQueued(song, cache) {
  if (isWithinGrace(song)) return true;
  if (cache.pathSet.has(vdj.normalizePath(song.fullPath))) return true;
  return cache.baseNameSet.has(baseNameOf(song.fullPath));
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
    whatsappNumber: config.whatsappNumber,
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
      category: s.category,
      queued: isSongQueued(s, cache),
    })),
  });
});

app.get('/api/categories', (req, res) => {
  res.json({ categories: getCategories(config) });
});

// Publico: lo que consume el carrusel de promociones del cliente
app.get('/api/ads/active', (req, res) => {
  res.json(ads.getActiveAds());
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
  const { gameId } = req.body || {};

  const validGames = ['duckhunt', 'beerjump', 'othello'];
  if (!gameId || !validGames.includes(gameId)) {
    return res.status(400).json({ ok: false, message: 'Falta indicar que juego se jugo.' });
  }

  const result = await store.claimGameCredit(nightKey, deviceId, gameId, config.creditsPerGame, config.gameCooldownMinutes);
  if (!result.ok) {
    return res.status(429).json({ ok: false, message: 'Todavia no podes volver a jugar este juego.', nextAvailableAt: result.nextAvailableAt, credits: result.credits });
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
    folder: path.dirname(song.fullPath),
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

  // Queda "En lista" garantizado por config.automixRecentGraceMinutes,
  // pase lo que pase con la consulta en vivo mientras tanto.
  markRecentlyAdded(song);

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

// ---------- Admin: gestion de publicidad ----------

app.get('/api/admin/ads', (req, res) => {
  if (!checkAdminToken(req, res)) return;
  res.json(ads.getAllAds());
});

app.post('/api/admin/ads', async (req, res) => {
  if (!checkAdminToken(req, res)) return;
  const title = (req.body && req.body.title || '').trim();
  if (!title) {
    return res.status(400).json({ ok: false, message: 'El titulo es obligatorio.' });
  }
  const ad = await ads.createAd(req.body);
  res.json({ ok: true, ad });
});

app.put('/api/admin/ads/:id', async (req, res) => {
  if (!checkAdminToken(req, res)) return;
  const id = Number(req.params.id);
  const ad = await ads.updateAd(id, req.body || {});
  if (!ad) return res.status(404).json({ ok: false, message: 'Anuncio no encontrado.' });
  res.json({ ok: true, ad });
});

app.delete('/api/admin/ads/:id', async (req, res) => {
  if (!checkAdminToken(req, res)) return;
  const id = Number(req.params.id);
  const removed = await ads.deleteAd(id);
  res.json({ ok: removed });
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


app.post('/api/admin/wipe', async (req, res) => {
  if (!checkAdminToken(req, res)) return;
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  await store.wipeNight(nightKey);
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
  console.log(`>>> Proceso Node PID: ${process.pid} — iniciado ${new Date().toLocaleTimeString()}`);
  console.log('==========================================');
});


// Limpieza automatica de noches viejas (deja las ultimas 3 noches en el
// archivo, borra el resto). Se chequea cada hora; si ya se limpio hoy, no
// hace nada extra.
setInterval(() => {
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  store.purgeOldNights(nightKey, 3).catch(() => {});
}, 60 * 60 * 1000); // cada hora



function checkSuperAdminToken(req, res) {
  const token = req.query.token || req.body?.token || req.headers['x-super-admin-token'];
  if (!config.superAdminToken || !token || token !== config.superAdminToken) {
    res.status(401).json({ error: 'Token invalido.' });
    return false;
  }
  return true;
}

// ---------- Superadmin: personal ----------

app.get('/api/superadmin/staff', (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  res.json(staff.getAllStaff());
});

app.post('/api/superadmin/staff', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await staff.createStaff(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.put('/api/superadmin/staff/:id', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await staff.updateStaff(Number(req.params.id), req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/superadmin/staff/:id/deactivate', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await staff.deactivateStaff(Number(req.params.id));
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/superadmin/staff/:id/reactivate', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await staff.reactivateStaff(Number(req.params.id));
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});


// ---------- Publico: kiosco de fichaje ----------

app.get('/api/staff/list', (req, res) => {
  // Solo nombre e id — nunca tarifa ni PIN — para pintar el kiosco.
  const list = staff.getActiveStaff().map((s) => ({ id: s.id, nombre: s.nombre, rol: s.rol }));
  res.json(list);
});

app.post('/api/staff/clock', async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ ok: false, message: 'Falta el PIN.' });
  const result = await attendance.clockByPin(pin);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ---------- Superadmin: turnos ----------

app.get('/api/superadmin/attendance', (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  res.json(attendance.getAllShifts());
});

app.put('/api/superadmin/attendance/:id', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await attendance.editShift(Number(req.params.id), req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/superadmin/attendance', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await attendance.createManualShift(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/superadmin/attendance/:id', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await attendance.deleteShift(Number(req.params.id));
  res.json(result);
});


// ---------- Superadmin: payroll ----------

app.get('/api/superadmin/payroll', (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const { desde, hasta } = req.query;
  if (!desde || !hasta) return res.status(400).json({ ok: false, message: 'Faltan fechas.' });
  const result = payroll.computeTotals(desde, hasta);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/superadmin/payroll/csv', (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const { desde, hasta } = req.query;
  if (!desde || !hasta) return res.status(400).send('Faltan fechas.');
  const result = payroll.computeTotals(desde, hasta);
  if (!result.ok) return res.status(400).send(result.message);

  const csv = payroll.toCsv(result.rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="nomina_${desde.slice(0, 10)}_a_${hasta.slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM: para que Excel abra bien las tildes/eñes
});


app.post('/api/missing-song', async (req, res) => {
  const deviceId = getOrSetDeviceId(req, res);
  const nightKey = getNightKey(new Date(), config.nightResetHour);
  const status = store.getDeviceStatus(nightKey, deviceId, config);
  const { query } = req.body || {};

  await missingSongs.logMissingSong(query, status.nickname);
  res.json({ ok: true });
});

// Para que puedas revisarlas despues desde el admin
app.get('/api/admin/missing-songs', (req, res) => {
  if (!checkAdminToken(req, res)) return;
  res.json(missingSongs.getAll());
});


app.get('/api/superadmin/payroll-rates', (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  res.json(payrollRates.getRates());
});

app.put('/api/superadmin/payroll-rates', async (req, res) => {
  if (!checkSuperAdminToken(req, res)) return;
  const result = await payrollRates.updateRates(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});


app.get('/api/admin/autoplay-log', (req, res) => {
  if (!checkAdminToken(req, res)) return;
  res.json(autoplay.getRecentLog(30));
});




