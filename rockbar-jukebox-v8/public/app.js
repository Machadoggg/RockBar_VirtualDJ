(function () {
  // ---------- Elementos ----------
  const gateEl = document.getElementById('gate');
  const gateBarNameEl = document.getElementById('gateBarName');
  const nicknameInput = document.getElementById('nicknameInput');
  const nicknameError = document.getElementById('nicknameError');
  const gateIgHandleEl = document.getElementById('gateIgHandle');
  const igLink = document.getElementById('igLink');
  const igClaimBtn = document.getElementById('igClaimBtn');
  const igStatus = document.getElementById('igStatus');
  const continueBtn = document.getElementById('continueBtn');

  const mainAppEl = document.getElementById('mainApp');
  const barNameEl = document.getElementById('barName');
  const remainingInfo = document.getElementById('remainingInfo');
  const creditsBadge = document.getElementById('creditsBadge');
  const gamesBtn = document.getElementById('gamesBtn');
  const igHeaderBtn = document.getElementById('igHeaderBtn');

  const songListEl = document.getElementById('songList');
  const searchInput = document.getElementById('searchInput');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');
  const toastEl = document.getElementById('toast');

  const gameModal = document.getElementById('gameModal');
  const gameCloseBtn = document.getElementById('gameCloseBtn');
  const gameResult = document.getElementById('gameResult');
  const gameCooldownMsg = document.getElementById('gameCooldownMsg');

  const gameHubView = document.getElementById('gameHubView');
  const hubCooldownMsg = document.getElementById('hubCooldownMsg');
  const gameHubBtns = document.querySelectorAll('.game-hub-btn');
  const gameBackBtns = document.querySelectorAll('[data-back]');

  const gameWheelView = document.getElementById('gameWheelView');
  const wheelEl = document.getElementById('wheel');
  const spinBtn = document.getElementById('spinBtn');

  const gameDuckView = document.getElementById('gameDuckView');
  const duckArea = document.getElementById('duckArea');
  const duckTarget = document.getElementById('duckTarget');
  const duckStartBtn = document.getElementById('duckStartBtn');
  const duckHitsEl = document.getElementById('duckHits');
  const duckTimeEl = document.getElementById('duckTime');

  const gameTriviaView = document.getElementById('gameTriviaView');
  const triviaQuestionEl = document.getElementById('triviaQuestion');
  const triviaOptionsEl = document.getElementById('triviaOptions');

  // --- Juegos nuevos (iframe): Duck Hunt Pro, Beer Jump, Othello ---
  const gameDuckHuntView = document.getElementById('gameDuckHuntView');
  const duckHuntFrame = document.getElementById('duckHuntFrame');
  const duckHuntClaimBtn = document.getElementById('duckHuntClaimBtn');

  const gameBeerJumpView = document.getElementById('gameBeerJumpView');
  const beerJumpFrame = document.getElementById('beerJumpFrame');
  const beerJumpClaimBtn = document.getElementById('beerJumpClaimBtn');

  const gameOthelloView = document.getElementById('gameOthelloView');
  const othelloFrame = document.getElementById('othelloFrame');
  const othelloClaimBtn = document.getElementById('othelloClaimBtn');

  const GAME_VIEWS = {
    hub: gameHubView,
    wheel: gameWheelView,
    duck: gameDuckView,
    trivia: gameTriviaView,
    duckhunt: gameDuckHuntView,
    beerjump: gameBeerJumpView,
    othello: gameOthelloView,
  };

  // Juegos embebidos por iframe: se cargan solo cuando se abren y se
  // descargan (src = '') al salir, para que no sigan sonando/corriendo
  // en segundo plano ni consuman recursos con el modal cerrado.
  const IFRAME_GAMES = {
    duckhunt: { frame: duckHuntFrame, src: '/duckhunt/index.html', claimBtn: duckHuntClaimBtn },
    beerjump: { frame: beerJumpFrame, src: '/beerjump/index.html', claimBtn: beerJumpClaimBtn },
    othello: { frame: othelloFrame, src: '/othello/index.html', claimBtn: othelloClaimBtn },
  };

  const promoBtn = document.getElementById('promoBtn');
  const promoModal = document.getElementById('promoModal');
  const promoCloseBtn = document.getElementById('promoCloseBtn');
  const promoImageBg = document.getElementById('promoImageBg');
  const promoImageFg = document.getElementById('promoImageFg');
  const promoBadge = document.getElementById('promoBadge');
  const promoTitle = document.getElementById('promoTitle');
  const promoDesc = document.getElementById('promoDesc');
  const promoDots = document.getElementById('promoDots');
  const promoEmpty = document.getElementById('promoEmpty');

  const whatsappCta = document.getElementById('whatsappCta');


  // ---------- Estado ----------
  let cfg = null;
  let status = null;
  let allSongs = [];
  let requestInFlight = false;
  let toastTimer = null;
  let wheelRotation = 0;
  let duckTimer = null;
  let duckMoveTimer = null;

  let ads = [];
  let adIndex = 0;
  let adRotateTimer = null;

  function showToast(message, ms = 4000) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, ms);
  }

  function formatClock(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatMinutesLeft(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'ya';
    const mins = Math.ceil(ms / 60000);
    return mins <= 1 ? '1 min' : `${mins} min`;
  }

  // ---------- Estado global: remaining + creditos ----------
  function updateHeaderUI() {
    if (!cfg || !status) return;

    if (status.remainingFree > 0) {
      remainingInfo.textContent = `Te quedan ${status.remainingFree} de ${cfg.requestsPerWindow} canciones por pedir`;
    } else if (status.credits > 0) {
      remainingInfo.textContent = `Sin pedidos de canciones por ahora, pero tenes ${status.credits} credito(s) para pedir igual`;
    } else if (status.nextFreeSlotAt) {
      remainingInfo.textContent = `Sin pedidos de canciones. El proximo se habilita a las ${formatClock(status.nextFreeSlotAt)}`;
    } else {
      remainingInfo.textContent = `0 de ${cfg.requestsPerWindow} pedidos canciones disponibles`;
    }

    if (status.credits > 0) {
      creditsBadge.hidden = false;
      creditsBadge.textContent = `⭐ ${status.credits} credito${status.credits === 1 ? '' : 's'}`;
    } else {
      creditsBadge.hidden = true;
    }

    igHeaderBtn.textContent = status.instagramClaimed ? '📸 Instagram ✓' : '📸 Instagram (+' + cfg.creditsPerInstagram + ')';
    igHeaderBtn.disabled = status.instagramClaimed;
  }

  async function refreshStatus() {
    const res = await fetch('/api/status');
    status = await res.json();
    updateHeaderUI();
  }

  // ---------- Lista de canciones ----------
  function renderSongs(filterText) {
    const q = (filterText || '').trim().toLowerCase();
    const filtered = !q
      ? allSongs
      : allSongs.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));

    songListEl.innerHTML = '';
    emptyState.hidden = filtered.length !== 0;


    if (filtered.length === 0 && q) {
      updateWhatsappCta(filterText);
    }


    for (const song of filtered) {
      const li = document.createElement('li');
      li.className = 'song-item';

      const info = document.createElement('div');
      info.className = 'song-info';
      const title = document.createElement('div');
      title.className = 'song-title';
      title.textContent = song.title;
      const artist = document.createElement('div');
      artist.className = 'song-artist';
      artist.textContent = song.artist || '';
      info.appendChild(title);
      if (song.artist) info.appendChild(artist);

      const btn = document.createElement('button');
      btn.className = 'add-btn';
      if (song.queued) {
        btn.textContent = 'En lista ✓';
        btn.classList.add('queued');
        btn.disabled = true;
      } else {
        btn.textContent = 'Pedir';
        btn.addEventListener('click', () => requestSong(song, btn));
      }

      li.appendChild(info);
      li.appendChild(btn);
      songListEl.appendChild(li);
    }
  }

  async function requestSong(song, btn) {
    if (requestInFlight) return;
    requestInFlight = true;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Agregando...';

    try {
      const res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id }),
      });
      const data = await res.json();

      if (data.ok) {
        song.queued = true;
        showToast(data.message || 'Cancion agregada al Automix.');
      } else if (res.status === 400 && /nombre/i.test(data.message || '')) {
        showToast(data.message);
        openGate();
      } else {
        showToast(data.message || 'No se pudo agregar la cancion.');
      }
    } catch (err) {
      showToast('Error de conexion. Intenta de nuevo.');
    } finally {
      requestInFlight = false;
      await refreshStatus();
      renderSongs(searchInput.value);
      if (!song.queued) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  }

  async function loadSongs() {
    try {
      const res = await fetch('/api/songs');
      const data = await res.json();
      if (data.error) {
        errorState.hidden = false;
        errorState.textContent = data.error;
        return;
      }
      errorState.hidden = true;
      allSongs = data.songs;
      renderSongs(searchInput.value);
    } catch {
      errorState.hidden = false;
      errorState.textContent = 'No se pudo cargar la lista de canciones.';
    }
  }


// ---------- Whatsapp ----------
  function updateWhatsappCta(query) {
    if (!whatsappCta) return;
    	if (!cfg || !cfg.whatsappNumber) {
          whatsappCta.hidden = true;
      	  return;
    		}
    	  whatsappCta.hidden = false;

    	  const nombre = status && status.nickname ? status.nickname : 'un cliente';
    	  const cancionTxt = query ? `"${query}"` : '(no escribio nada especifico)';
    	  const mensaje = `Hola DJ! Soy ${nombre}. No encontre la cancion ${cancionTxt} en la lista, la puedes agregar por favor.`;

    	  whatsappCta.href = `https://wa.me/${cfg.whatsappNumber}?text=${encodeURIComponent(mensaje)}`;
  	}

  	// Fire-and-forget: no bloquea al usuario ni depende de que responda el
  	// servidor, solo deja registro para que el DJ pueda revisar despues
  	// que canciones piden seguido y no estan en la biblioteca.
  	function logMissingSongAttempt(query) {
    	  fetch('/api/missing-song', {
      	  method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        }).catch(() => {});
  }


  // ---------- Instagram ----------
  async function claimInstagram(statusEl) {
    try {
      const res = await fetch('/api/credits/instagram', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = data.message;
        }
        showToast(data.message);
      } else {
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'Ya habias sumado ese credito esta noche.';
        }
      }
      await refreshStatus();
    } catch {
      showToast('No se pudo conectar. Intenta de nuevo.');
    }
  }

  igClaimBtn.addEventListener('click', () => claimInstagram(igStatus));
  igHeaderBtn.addEventListener('click', () => claimInstagram(null));

  whatsappCta.addEventListener('click', () => {
    logMissingSongAttempt(searchInput.value.trim());
  });


// ---------- Promociones (carrusel de anuncios del admin) ----------
  // Se cargan una sola vez por apertura del modal (no se pollea en
  // background como el resto del estado) porque son promos del bar,
  // no cambian mientras el cliente tiene el modal abierto.
  // ---------- Promociones ----------
  async function fetchAds() {
    try {
      const res = await fetch('/api/ads/active');
      if (!res.ok) throw new Error();
      ads = await res.json();
    } catch {
      ads = [];
    }
  }

  function buildPromoDots() {
    promoDots.innerHTML = ads
      .map((_, i) => `<button class="promo-dot" data-idx="${i}"></button>`)
      .join('');
    promoDots.querySelectorAll('.promo-dot').forEach((dot) => {
      dot.addEventListener('click', () => renderAdSlide(Number(dot.dataset.idx)));
    });
  }

  function renderAdSlide(i) {
    if (!ads.length) return;
    adIndex = ((i % ads.length) + ads.length) % ads.length;
    const ad = ads[adIndex];

    if (ad.imageUrl) {
      promoImageBg.style.backgroundImage = `url('${ad.imageUrl}')`;
      promoImageFg.style.backgroundImage = `url('${ad.imageUrl}')`;
      promoImageFg.textContent = '';
    } else {
      promoImageBg.style.backgroundImage = '';
      promoImageFg.style.backgroundImage = '';
      promoImageFg.textContent = ad.emoji || '🍺';
    }

    promoBadge.hidden = !ad.badge;
    if (ad.badge) promoBadge.textContent = ad.badge;
    promoTitle.textContent = ad.title || '';
    promoDesc.textContent = ad.description || '';

    promoDots.querySelectorAll('.promo-dot').forEach((dot, idx) => dot.classList.toggle('active', idx === adIndex));

    clearTimeout(adRotateTimer);
    if (ads.length > 1 && !promoModal.hidden) {
      adRotateTimer = setTimeout(() => renderAdSlide(adIndex + 1), 6000);
    }
  }

  async function openPromoModal() {
    promoModal.hidden = false;
    promoEmpty.hidden = true;
    if (!ads.length) await fetchAds();

    if (!ads.length) {
      promoEmpty.hidden = false;
      promoDots.innerHTML = '';
      promoTitle.textContent = '';
      promoDesc.textContent = '';
      promoBadge.hidden = true;
      promoImageBg.style.backgroundImage = '';
      promoImageFg.style.backgroundImage = '';
      promoImageFg.textContent = '';
      return;
    }

    buildPromoDots();
    renderAdSlide(0);
  }

  function closePromoModal() {
    clearTimeout(adRotateTimer);
    promoModal.hidden = true;
  }

  promoBtn.addEventListener('click', openPromoModal);
  promoCloseBtn.addEventListener('click', closePromoModal);


  // ---------- Juegos: hub + juegos que comparten el mismo credito/cooldown ----------
  // Todos los juegos (Ruleta, Duck Hunt manual, Trivia Rock, Duck Hunt Pro,
  // Beer Jump, Othello) llaman a esta MISMA funcion al terminar. El servidor
  // es el que decide si corresponde credito o si todavia esta en cooldown
  // (ver /api/credits/game) — jugar cualquiera de ellos cuenta como "la
  // partida" del rato; no se puede sacar credito de mas jugando varios seguidos.
  async function claimGameCredit() {
    try {
      const res = await fetch('/api/credits/game', { method: 'POST' });
      const data = await res.json();

      gameResult.hidden = true;
      gameCooldownMsg.hidden = true;

      if (data.ok) {
        gameResult.hidden = false;
        gameResult.textContent = `🎉 ${data.message}`;
        showToast(data.message);
      } else {
        gameCooldownMsg.hidden = false;
        gameCooldownMsg.textContent = data.nextAvailableAt
          ? `Ya jugaste por ahora. Volve a intentar en ${formatMinutesLeft(data.nextAvailableAt)}.`
          : 'Todavia no podes volver a jugar.';
      }
      await refreshStatus();
      return data;
    } catch {
      showToast('Error de conexion. Intenta de nuevo.');
      return { ok: false };
    }
  }

  function isGameOnCooldown() {
    return !!(status && status.gameAvailableAt && new Date(status.gameAvailableAt).getTime() > Date.now());
  }

  // Carga (o recarga desde cero) el iframe de un juego embebido.
  function loadIframeGame(name) {
    const conf = IFRAME_GAMES[name];
    if (!conf) return;
    conf.frame.src = conf.src;
    conf.claimBtn.disabled = false;
    conf.claimBtn.textContent = 'Ya jugué, sumar crédito';
  }

  // Descarga un iframe (src vacio) para que deje de sonar/correr en
  // segundo plano cuando el usuario sale de esa vista.
  function unloadIframeGame(name) {
    const conf = IFRAME_GAMES[name];
    if (!conf) return;
    conf.frame.src = '';
  }

  function showGameView(name) {
    Object.entries(GAME_VIEWS).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    gameResult.hidden = true;
    gameCooldownMsg.hidden = true;
    if (name !== 'duck') stopDuckGame();

    // Descargar cualquier iframe de juego que no sea el que se esta mostrando.
    Object.keys(IFRAME_GAMES).forEach((key) => {
      if (key !== name) unloadIframeGame(key);
    });
  }

  function openGameModal() {
    gameModal.hidden = false;
    showGameView('hub');

    if (isGameOnCooldown()) {
      hubCooldownMsg.hidden = false;
      hubCooldownMsg.textContent = `Ya jugaste por ahora. Volves a poder jugar en ${formatMinutesLeft(status.gameAvailableAt)}.`;
      gameHubBtns.forEach((b) => (b.disabled = true));
    } else {
      hubCooldownMsg.hidden = true;
      gameHubBtns.forEach((b) => (b.disabled = false));
    }
  }

  gamesBtn.addEventListener('click', openGameModal);
  gameCloseBtn.addEventListener('click', () => {
    stopDuckGame();
    Object.keys(IFRAME_GAMES).forEach(unloadIframeGame);
    gameModal.hidden = true;
  });

  gameHubBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const game = btn.dataset.game;
      showGameView(game);
      if (game === 'trivia') startTrivia();
      if (game === 'wheel') {
        spinBtn.disabled = false;
        spinBtn.textContent = 'Girar';
      }
      if (game === 'duck') resetDuckView();
      if (IFRAME_GAMES[game]) loadIframeGame(game);
    });
  });

  gameBackBtns.forEach((btn) => {
    btn.addEventListener('click', () => openGameModal());
  });

  // --- Ruleta ---
  spinBtn.addEventListener('click', async () => {
    spinBtn.disabled = true;
    gameResult.hidden = true;
    gameCooldownMsg.hidden = true;

    // Animacion de giro (puramente visual, el resultado real lo decide el servidor).
    wheelRotation += 1080 + Math.floor(Math.random() * 360);
    wheelEl.style.transform = `rotate(${wheelRotation}deg)`;

    await new Promise((resolve) => setTimeout(resolve, 1400));
    await claimGameCredit();
    spinBtn.disabled = false;
  });

  // --- Duck Hunt (manual) ---
  const DUCK_HITS_NEEDED = 3;
  const DUCK_TIME_LIMIT_S = 8;
  let duckHits = 0;
  let duckSecondsLeft = DUCK_TIME_LIMIT_S;
  let duckRunning = false;

  function resetDuckView() {
    duckHits = 0;
    duckSecondsLeft = DUCK_TIME_LIMIT_S;
    duckRunning = false;
    duckTarget.hidden = true;
    duckHitsEl.textContent = `Aciertos: 0 / ${DUCK_HITS_NEEDED}`;
    duckTimeEl.textContent = `Tiempo: ${DUCK_TIME_LIMIT_S}s`;
    duckStartBtn.hidden = false;
    duckStartBtn.textContent = 'Empezar';
    duckStartBtn.disabled = false;
  }

  function stopDuckGame() {
    duckRunning = false;
    clearInterval(duckTimer);
    clearInterval(duckMoveTimer);
    duckTimer = null;
    duckMoveTimer = null;
  }

  function moveDuck() {
    const areaRect = duckArea.getBoundingClientRect();
    const size = 46;
    const maxX = Math.max(0, areaRect.width - size);
    const maxY = Math.max(0, areaRect.height - size);
    duckTarget.style.left = `${Math.floor(Math.random() * maxX)}px`;
    duckTarget.style.top = `${Math.floor(Math.random() * maxY)}px`;
  }

  async function endDuckGame(success) {
    stopDuckGame();
    duckTarget.hidden = true;
    duckStartBtn.hidden = false;
    duckStartBtn.disabled = false;
    duckStartBtn.textContent = 'Jugar de nuevo';
    if (success) {
      showToast('🦆 ¡Los 3 patos! Sumando tu credito...');
    } else {
      showToast('Se acabo el tiempo, pero igual sumaste tu credito por participar.');
    }
    await claimGameCredit();
  }

  duckStartBtn.addEventListener('click', () => {
    if (duckRunning) return;
    duckHits = 0;
    duckSecondsLeft = DUCK_TIME_LIMIT_S;
    duckRunning = true;
    duckHitsEl.textContent = `Aciertos: 0 / ${DUCK_HITS_NEEDED}`;
    duckTimeEl.textContent = `Tiempo: ${duckSecondsLeft}s`;
    duckStartBtn.hidden = true;
    duckTarget.hidden = false;
    moveDuck();

    duckMoveTimer = setInterval(moveDuck, 900);
    duckTimer = setInterval(() => {
      duckSecondsLeft -= 1;
      duckTimeEl.textContent = `Tiempo: ${Math.max(0, duckSecondsLeft)}s`;
      if (duckSecondsLeft <= 0) {
        endDuckGame(false);
      }
    }, 1000);
  });

  duckTarget.addEventListener('click', () => {
    if (!duckRunning) return;
    duckHits += 1;
    duckHitsEl.textContent = `Aciertos: ${duckHits} / ${DUCK_HITS_NEEDED}`;
    if (duckHits >= DUCK_HITS_NEEDED) {
      endDuckGame(true);
    } else {
      moveDuck();
    }
  });

  // --- Trivia Rock ---
  const TRIVIA_QUESTIONS = [
    { q: '¿En que ciudad se formo Black Sabbath?', options: ['Londres', 'Birmingham', 'Liverpool', 'Manchester'], correct: 1 },
    { q: '¿Quien es el vocalista de AC/DC desde 1980?', options: ['Bon Scott', 'Brian Johnson', 'Axl Rose', 'Ian Gillan'], correct: 1 },
    { q: '¿Que banda hizo "Master of Puppets"?', options: ['Megadeth', 'Slayer', 'Metallica', 'Anthrax'], correct: 2 },
    { q: '¿En que año murio Freddie Mercury?', options: ['1989', '1991', '1993', '1995'], correct: 1 },
    { q: '¿Quien toca la guitarra en Guns N Roses (clasica formacion)?', options: ['Slash', 'Kirk Hammett', 'Angus Young', 'Jimmy Page'], correct: 0 },
    { q: '¿Que banda edito "The Wall"?', options: ['Led Zeppelin', 'Pink Floyd', 'Queen', 'The Who'], correct: 1 },
    { q: '¿De que pais son AC/DC?', options: ['Estados Unidos', 'Reino Unido', 'Australia', 'Canada'], correct: 2 },
  ];

  async function startTrivia() {
    const item = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
    triviaQuestionEl.textContent = item.q;
    triviaOptionsEl.innerHTML = '';

    item.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'trivia-option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', async () => {
        [...triviaOptionsEl.children].forEach((b) => (b.disabled = true));
        btn.classList.add(idx === item.correct ? 'correct' : 'wrong');
        showToast(idx === item.correct ? '¡Correcto! 🤘' : `Casi... la correcta era "${item.options[item.correct]}"`);
        await claimGameCredit();
      });
      triviaOptionsEl.appendChild(btn);
    });
  }

  // --- Duck Hunt Pro / Beer Jump / Othello (iframe) ---
  // Estos juegos corren adentro de un iframe propio y no reportan su
  // resultado al padre, asi que el credito se reclama con un boton
  // manual una vez que el usuario termino de jugar (mismo /api/credits/game
  // que los demas, con el mismo cooldown).
  function wireIframeClaim(btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await claimGameCredit();
    });
  }

  wireIframeClaim(duckHuntClaimBtn);
  wireIframeClaim(beerJumpClaimBtn);
  wireIframeClaim(othelloClaimBtn);

  // ---------- Pantalla de bienvenida (gate) ----------
  function openGate() {
    gateEl.hidden = false;
    mainAppEl.hidden = true;
  }

  function closeGate() {
    gateEl.hidden = true;
    mainAppEl.hidden = false;
  }

  nicknameInput.addEventListener('input', () => {
    nicknameError.hidden = true;
  });

  continueBtn.addEventListener('click', async () => {
    const nickname = nicknameInput.value.trim();
    if (cfg.nicknameRequired && !nickname) {
      nicknameError.hidden = false;
      nicknameInput.focus();
      return;
    }

    if (nickname) {
      try {
        await fetch('/api/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname }),
        });
      } catch {
        // si falla la red, igual lo dejamos pasar; /api/request va a
        // volver a pedir el nombre si hace falta.
      }
    }

    closeGate();
    await enterMainApp();
  });

  // ---------- Refresco automatico ----------
  // Cada AUTO_REFRESH_MS se vuelve a pedir el estado (creditos, cupo libre)
  // y la lista de canciones (para que el boton "En lista" se actualice si
  // otro celular agrego algo mientras tenias la pagina abierta).
  const AUTO_REFRESH_MS = 15000;
  let refreshTimer = null;

  function startAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(async () => {
      if (mainAppEl.hidden) return; // seguimos en la pantalla de bienvenida
      if (requestInFlight) return; // no pisar un pedido que esta en curso
      await refreshStatus();
      await loadSongs();
    }, AUTO_REFRESH_MS);
  }

  // ---------- Arranque ----------
  async function enterMainApp() {
    barNameEl.textContent = `${cfg.barName}`;
    await refreshStatus();
    await loadSongs();
    startAutoRefresh();
  }

  async function init() {
    try {
      const [cfgRes, statusRes] = await Promise.all([fetch('/api/config'), fetch('/api/status')]);
      cfg = await cfgRes.json();
      status = await statusRes.json();

      gateBarNameEl.textContent = `${cfg.barName}`;
      gateIgHandleEl.textContent = cfg.instagramHandle;
      igLink.href = cfg.instagramUrl;

      const needsGate = cfg.nicknameRequired && !status.nickname;
      if (needsGate) {
        openGate();
      } else {
        closeGate();
        await enterMainApp();
      }
    } catch (err) {
      errorState.hidden = false;
      errorState.textContent = 'No se pudo conectar con el servidor.';
    }
  }

  searchInput.addEventListener('input', () => renderSongs(searchInput.value));

  init();
})();