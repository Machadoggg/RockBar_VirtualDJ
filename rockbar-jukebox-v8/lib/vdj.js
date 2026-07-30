/**
 * Cliente minimo para el "Network Control Plugin" de VirtualDJ (VDJ 2023+, Pro).
 * Documentacion oficial: https://virtualdj.com/wiki/NetworkControlPlugin.html
 *
 * El plugin expone:
 *   GET /execute?script=<VDJscript>[&bearer=<token>]
 *   GET /query?script=<VDJscript>[&bearer=<token>]
 * y responde texto plano "true"/"false" (execute) o el resultado (query).
 *
 * IMPORTANTE - por que esto se manda en VARIOS pasos y no en un solo script:
 * VDJscript no tiene forma de "esperar" dentro de un mismo comando (no existe
 * un verbo de delay). Si mandas todo junto, ej.
 *   browser_gotofolder "..." & search "..." & playlist_add
 * VirtualDJ puede ejecutar el playlist_add ANTES de que la busqueda termine
 * de mover la seleccion del browser, y termina agregando al Automix
 * cualquier cancion que haya quedado seleccionada antes (no la que pediste).
 *
 * Por eso VDJ_SELECT_SCRIPT en el .env se separa en pasos con "||", y esta
 * funcion los manda como llamadas HTTP separadas, con una pausa real
 * (VDJ_STEP_DELAY_MS) entre cada una, dandole tiempo a VirtualDJ de
 * actualizar la seleccion antes de agregar al Automix.
 */

function buildUrl(config, script) {
  const base = `http://${config.vdjHost}:${config.vdjPort}/execute`;
  const params = new URLSearchParams({ script });
  if (config.vdjBearer) params.set('bearer', config.vdjBearer);
  return `${base}?${params.toString()}`;
}

function buildQueryUrl(config, script) {
  const base = `http://${config.vdjHost}:${config.vdjPort}/query`;
  const params = new URLSearchParams({ script });
  if (config.vdjBearer) params.set('bearer', config.vdjBearer);
  return `${base}?${params.toString()}`;
}

function renderScript(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : ''));
}

/**
 * Escapa comillas dobles dentro de un valor que va a insertarse dentro de
 * comillas dobles en un VDJscript.
 */
function escapeForScript(value) {
  return String(value).replace(/"/g, '\\"');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta UN paso de VDJscript contra el Network Control Plugin.
 * Devuelve { ok, text, error }.
 */
async function runStep(config, script) {
  const url = buildUrl(config, script);

  let response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo conectar con VirtualDJ (${config.vdjHost}:${config.vdjPort}). ¿Esta VirtualDJ abierto y el plugin "Network Control" activado? Detalle: ${err.message}`,
    };
  }

  if (!response.ok) {
    return { ok: false, error: `VirtualDJ respondio con error HTTP ${response.status}. Revisa el token/bearer configurado.` };
  }

  const text = (await response.text()).trim().toLowerCase();
  if (text === 'true') {
    return { ok: true, text };
  }
  return { ok: false, text, error: `VirtualDJ no pudo ejecutar el paso "${script}" (respuesta: "${text}").` };
}

/**
 * Pide a VirtualDJ que agregue la cancion (song) al automix.
 * song = { folder, baseName } (folder = carpeta de videos, baseName = nombre
 * de archivo sin extension, usado como termino de busqueda unico).
 *
 * config.vdjSelectScript puede tener varios pasos separados por "||"
 * (ej: 'browser_gotofolder "{folder}" || search "{query}" || playlist_add & search ""').
 * Cada paso se manda por separado, esperando config.vdjStepDelayMs entre uno
 * y el siguiente.
 */
async function addToAutomix(config, song) {
  const vars = {
    folder: escapeForScript(song.folder),
    query: escapeForScript(song.baseName),
  };

  const steps = config.vdjSelectScript
    .split('||')
    .map((s) => renderScript(s.trim(), vars))
    .filter(Boolean);

  const delayMs = Number.isFinite(config.vdjStepDelayMs) ? config.vdjStepDelayMs : 400;

  for (let i = 0; i < steps.length; i++) {
    const result = await runStep(config, steps[i]);
    if (!result.ok) return result;
    // Pausa entre pasos (no hace falta esperar despues del ultimo paso).
    if (i < steps.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return { ok: true };
}

/**
 * Ejecuta una consulta (read-only) contra /query. A diferencia de /execute,
 * la respuesta es el VALOR pedido (un numero, una ruta, etc), no "true/false".
 * Confirmado contra una instancia real de VirtualDJ:
 *   file_count 'automix'        -> cantidad de canciones en el Automix ahora
 *   get_filepath 'automix' N    -> ruta completa de la cancion en la posicion N (0-based)
 */
async function runQuery(config, script) {
  const url = buildQueryUrl(config, script);

  let response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (err) {
    return { ok: false, error: `No se pudo conectar con VirtualDJ: ${err.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `VirtualDJ respondio con error HTTP ${response.status}.` };
  }

  const text = (await response.text()).trim();
  if (text.startsWith('error:')) {
    return { ok: false, error: `VirtualDJ respondio "${text}" para el script "${script}".` };
  }
  return { ok: true, text };
}

/**
 * Devuelve la lista de rutas de archivo que estan REALMENTE en el Automix
 * de VirtualDJ en este momento (para saber que boton mostrar como
 * "En lista" del lado de la app). Si algo falla a mitad de camino, devuelve
 * lo que se pudo leer hasta ahi en vez de tirar todo.
 */
async function getAutomixPaths(config) {
  const countResult = await runQuery(config, "file_count 'automix'");
  if (!countResult.ok) {
    return { ok: false, error: countResult.error, paths: [] };
  }

  const count = parseInt(countResult.text, 10);
  if (!Number.isFinite(count) || count < 0) {
    return { ok: false, error: `Respuesta inesperada de file_count 'automix': "${countResult.text}"`, paths: [] };
  }

  const paths = [];
  for (let i = 0; i < count; i++) {
    const result = await runQuery(config, `get_filepath 'automix' ${i}`);
    if (result.ok && result.text) paths.push(result.text);
  }

  return { ok: true, paths };
}

/**
 * Normaliza una ruta de archivo de Windows para poder comparar la que
 * devuelve VirtualDJ contra la que lee esta app del disco (mayusculas,
 * separadores, espacios, etc pueden variar sin ser realmente distintas).
 */
function normalizePath(p) {
  return String(p || '')
    .trim()
    .toLowerCase()
    .replace(/\//g, '\\');
}

module.exports = {
  addToAutomix,
  buildUrl,
  renderScript,
  escapeForScript,
  runStep,
  runQuery,
  getAutomixPaths,
  normalizePath,
};
