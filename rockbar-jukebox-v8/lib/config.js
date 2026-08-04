const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseExtensions(str) {
  return (str || '.mp4,.avi,.mkv,.mov,.wmv,.flv,.webm,.m4v')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith('.') ? s : '.' + s));
}

const config = {
  videosFolder: process.env.VIDEOS_FOLDER || '',
  videoExtensions: parseExtensions(process.env.VIDEO_EXTENSIONS),
  port: parseInt(process.env.PORT, 10) || 3000,
  publicUrl: process.env.PUBLIC_URL || '',

  vdjHost: process.env.VDJ_HOST || '127.0.0.1',
  vdjPort: parseInt(process.env.VDJ_PORT, 10) || 8093,
  vdjBearer: process.env.VDJ_BEARER || '',
  // Pasos separados por "||". Se mandan uno por uno (llamadas HTTP separadas),
  // con una pausa real de vdjStepDelayMs entre cada uno, porque VDJscript no
  // tiene forma de esperar dentro de un mismo comando. Ver lib/vdj.js.
  vdjSelectScript:
    process.env.VDJ_SELECT_SCRIPT ||
    'browser_gotofolder "{folder}" || search "{query}" || playlist_add & search ""',
  vdjStepDelayMs: parseInt(process.env.VDJ_STEP_DELAY_MS, 10) || 400,

  // Cuantos minutos se muestra SIEMPRE "En lista" una cancion recien
  // agregada, sin importar lo que diga la consulta en vivo al Automix.
  // Es un blindaje para que el boton no "parpadee" de vuelta a Agregar si
  // la consulta en vivo tarda o no detecta el cambio de inmediato. Subilo
  // si tus videos duran mas que esto en promedio.
  automixRecentGraceMinutes: parseInt(process.env.AUTOMIX_RECENT_GRACE_MINUTES, 10) || 10,

  // --- Limite base: pedidos "gratis" por ventana rodante ---
  requestsPerWindow: parseInt(process.env.REQUESTS_PER_WINDOW, 10) || 2,
  requestWindowMinutes: parseInt(process.env.REQUEST_WINDOW_MINUTES, 10) || 120,

  nightResetHour: (() => {
    const h = parseInt(process.env.NIGHT_RESET_HOUR, 10);
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 6;
  })(),

  // --- Nombre del usuario ---
  nicknameRequired: (process.env.NICKNAME_REQUIRED || 'true').toLowerCase() !== 'false',

  // --- Creditos extra (Instagram + juego) ---
  creditsPerInstagram: parseInt(process.env.CREDITS_PER_INSTAGRAM, 10) || 1,
  creditsPerGame: parseInt(process.env.CREDITS_PER_GAME, 10) || 1,
  gameCooldownMinutes: parseInt(process.env.GAME_COOLDOWN_MINUTES, 10) || 30,
  instagramHandle: process.env.INSTAGRAM_HANDLE || '@barracudabar',
  instagramUrl: process.env.INSTAGRAM_URL || 'https://instagram.com/barracudabar',

  whatsappNumber: process.env.WHATSAPP_NUMBER || null,

  auxilioTransporteMensual: parseInt(process.env.AUXILIO_TRANSPORTE_MENSUAL, 10) || 0,
  auxilioTransporteDiasMes: parseInt(process.env.AUXILIO_TRANSPORTE_DIAS_MES, 10) || 30,

  adminToken: process.env.ADMIN_TOKEN || 'cambiar-esta-clave',
  barName: process.env.BAR_NAME || 'Rock Bar',
  superAdminToken: process.env.SUPER_ADMIN_TOKEN || null,
};

module.exports = config;
