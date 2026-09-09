(function activarTV() {
  'use strict';
  const P = window.SublichatTVPlatforms;
  if (!P) return;
  const API = '/api/activar-tv';
  let installed = false;
  const state = { platform: null, session: null, available: null, busy: false, timer: 0, owner: '', generation: 0, availabilityId: 0, requestId: '', saved: [] };
  const $ = id => document.getElementById(id);
  const user = () => String(localStorage.getItem('sublichat_user') || '').trim().toLowerCase();
  const active = () => $('screen-activar-tv')?.classList.contains('active');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const newId = () => crypto.randomUUID();
  const hidden = (id, value) => { const node = $(id); if (node) node.hidden = value; };
  function message(text, error = false) {
    const node = $('tvMessage'); if (!node) return;
    node.textContent = text || ''; node.classList.toggle('tv-error', error); node.hidden = !text;
  }
  async function api(payload) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(API, { method:'POST', headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify(payload), signal:controller.signal, cache:'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) { const error = new Error(data.error || 'No se pudo completar la operación.'); error.code = data.code; error.status = response.status; throw error; }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('La conexión tardó demasiado. Reintente para recuperar su sesión.');
      throw err;
    } finally { clearTimeout(timeout); }
  }
  function platformEnabled() { return !!state.platform && !!state.available?.available && state.available.platforms.includes(state.platform.id); }
  function draw() {
    const root = $('rbac-activar-tv'); if (!root) return;
    root.innerHTML = `<div class="tv-shell">
      <div class="tv-heading"><div><h2>📺 Activar TV</h2><p>Primero inicie sesión. Después introduzca el código del televisor.</p></div><button type="button" id="tvHome" class="tv-button">← Inicio</button></div>
      <div class="tv-platforms" aria-label="Elija una plataforma">${P.platforms.map(p => `<button type="button" class="tv-platform" data-tv-platform="${p.id}" aria-pressed="false"><img src="./assets/platformas/${p.logo}" alt="" width="96" height="96"><b>${p.name}</b></button>`).join('')}</div>
      <div id="tvAvailability" class="tv-notice" role="status">Comprobando conexión…</div>
      <button id="tvReconnect" class="tv-button" type="button" hidden>Reintentar conexión</button>
      <div id="tvWorkspace" hidden>
        <ol class="tv-steps" aria-label="Pasos de activación"><li id="tvStepLogin" aria-current="step"><span>1</span> Iniciar sesión</li><li id="tvStepCode"><span>2</span> Código del TV</li></ol>
        <div id="tvMessage" class="tv-notice" role="status" aria-live="polite" hidden></div>
        <form id="tvLoginForm" class="tv-card" autocomplete="off">
          <h3 id="tvLoginTitle">Iniciar sesión</h3>
          <p class="tv-help">Puede escribir cualquier cuenta, aunque no esté guardada en Sublichat.</p>
          <div class="tv-fields"><label>Correo<input id="tvEmail" type="email" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="Escriba el correo de la cuenta"></label>
          <label>Clave<div class="tv-key"><input id="tvPassword" type="password" autocomplete="new-password" maxlength="512" required placeholder="Escriba la clave"><button type="button" id="tvShowPassword" class="tv-button" aria-label="Mostrar clave">Ver</button></div></label></div>
          <details id="tvSavedDetails" class="tv-saved"><summary>Elegir una cuenta guardada (opcional)</summary><label>Buscar correo<input id="tvSavedSearch" type="search" placeholder="Buscar entre las cuentas disponibles" autocomplete="off"></label><div id="tvSavedList" class="tv-saved-list"></div></details>
          <button id="tvLogin" class="tv-button tv-primary" type="submit" disabled>Iniciar sesión</button>
        </form>
        <div id="tvAccount" class="tv-card tv-account" hidden><div><small id="tvAccountStatus">Iniciando sesión</small><strong id="tvAccountEmail"></strong></div><button id="tvChange" type="button" class="tv-button">Cambiar cuenta</button></div>
        <div id="tvConfirmBox" class="tv-card" hidden><p>La plataforma no muestra el correo completo. Revise la cuenta en la página de abajo antes de continuar.</p><label class="tv-checkbox"><input type="checkbox" id="tvConfirmCheck">Confirmo que la cuenta abierta corresponde al correo indicado arriba.</label><button type="button" id="tvConfirm" class="tv-button tv-primary" disabled>Confirmar cuenta</button></div>
        <button type="button" id="tvNext" class="tv-button tv-primary" hidden>Continuar al código del TV →</button>
        <form id="tvCodeForm" class="tv-card" hidden><h3>2. Código del TV</h3><label>Código que aparece en el televisor<input id="tvCode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="Escriba el código" required></label><button type="submit" id="tvActivate" class="tv-button tv-primary">Activar TV</button></form>
        <div id="tvDone" class="tv-card tv-success" hidden><h3>✓ TV activado</h3><p>La plataforma confirmó la vinculación.</p><button id="tvAnother" class="tv-button" type="button">Activar otra cuenta</button></div>
        <section id="tvRemote" class="tv-card tv-remote" hidden aria-label="Página de la plataforma">
          <div class="tv-remote-heading"><div><h3>Página de la plataforma</h3><small id="tvRemoteHost"></small></div><button type="button" id="tvZoom" class="tv-button" aria-pressed="false">Ampliar</button></div>
          <p class="tv-help">Toque los botones de la página para continuar. Si pide una verificación, complétela aquí.</p>
          <div id="tvRemoteViewport" class="tv-viewport"><img id="tvFrame" alt="Página actual de la plataforma. Toque para interactuar." draggable="false" tabindex="0"></div>
          <div class="tv-remote-tools"><button type="button" class="tv-button" data-tv-key="Tab">Siguiente campo</button><button type="button" class="tv-button" data-tv-key="Enter">Enter</button><button type="button" class="tv-button" data-tv-scroll="-500">↑ Subir</button><button type="button" class="tv-button" data-tv-scroll="500">↓ Bajar</button><button type="button" id="tvRefresh" class="tv-button">Actualizar página</button></div>
          <form id="tvRemoteTextForm"><label>Para escribir en la página, toque primero el campo<input id="tvRemoteText" type="password" autocomplete="new-password" maxlength="1024" placeholder="Texto o código de verificación"></label><button type="submit" class="tv-button">Escribir en el campo</button></form>
        </section>
      </div></div>`;
    $('tvHome').onclick = () => window.subliRBAC?.go('inicio');
    root.querySelectorAll('[data-tv-platform]').forEach(button => { button.onclick = () => selectPlatform(button.dataset.tvPlatform); });
    $('tvReconnect').onclick = availability;
    $('tvLoginForm').onsubmit = start;
    $('tvEmail').oninput = $('tvPassword').oninput = () => { state.requestId = ''; };
    $('tvShowPassword').onclick = () => {
      const reveal = $('tvPassword').type === 'password'; $('tvPassword').type = reveal ? 'text' : 'password';
      $('tvShowPassword').textContent = reveal ? 'Ocultar' : 'Ver'; $('tvShowPassword').setAttribute('aria-label', reveal ? 'Ocultar clave' : 'Mostrar clave');
    };
    $('tvSavedDetails').ontoggle = () => { if ($('tvSavedDetails').open) savedAccounts(); };
    $('tvSavedSearch').oninput = savedAccounts;
    $('tvChange').onclick = $('tvAnother').onclick = () => selectPlatform(state.platform.id);
    $('tvConfirmCheck').onchange = () => { $('tvConfirm').disabled = !$('tvConfirmCheck').checked || state.busy || state.session?.busy; };
    $('tvConfirm').onclick = () => command('confirm_account', { email:state.session.email });
    $('tvNext').onclick = () => command('activation_page');
    $('tvCodeForm').onsubmit = event => {
      event.preventDefault(); const value = P.code($('tvCode').value, state.platform);
      if (!value) { message('Revise el código que aparece en el TV.', true); $('tvCode').focus(); return; }
      void command('activate', { code:value });
    };
    $('tvRefresh').onclick = () => { clearTimeout(state.timer); void poll(); };
    $('tvZoom').onclick = () => {
      const zoom = $('tvRemoteViewport').classList.toggle('tv-zoomed');
      $('tvZoom').textContent = zoom ? 'Ajustar' : 'Ampliar'; $('tvZoom').setAttribute('aria-pressed', String(zoom));
    };
    $('tvFrame').onclick = event => {
      if (!state.session?.frame || state.busy || state.session.busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.min(999, Math.max(0, (event.clientX - rect.left) * 1000 / rect.width));
      const y = Math.min(759, Math.max(0, (event.clientY - rect.top) * 760 / rect.height));
      void interact({ type:'tap', x, y });
    };
    $('tvFrame').onkeydown = event => {
      if (['Enter','Tab','Backspace','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(event.key)) {
        event.preventDefault(); void interact({ type:'key', key:event.key === ' ' ? 'Space' : (event.key === 'Tab' && event.shiftKey ? 'Shift+Tab' : event.key) });
      }
    };
    root.querySelectorAll('[data-tv-key]').forEach(button => { button.onclick = () => interact({ type:'key', key:button.dataset.tvKey }); });
    root.querySelectorAll('[data-tv-scroll]').forEach(button => { button.onclick = () => interact({ type:'scroll', delta:Number(button.dataset.tvScroll) }); });
    $('tvRemoteTextForm').onsubmit = async event => {
      event.preventDefault(); const text = $('tvRemoteText').value; if (!text) return;
      $('tvRemoteText').value = ''; await interact({ type:'text', text });
    };
  }
  async function availability() {
    const availabilityId = ++state.availabilityId; hidden('tvReconnect', true);
    try {
      const result = await api({ action:'availability' }); if (availabilityId !== state.availabilityId || !active()) return;
      state.available = result;
      $('tvAvailability').textContent = result.available ? 'Seleccione una plataforma para iniciar.' :
        'Activar TV está pendiente de conexión o habilitación. Solicite a Sublicuentas conectar el servicio.';
      hidden('tvReconnect', !!result.available);
    } catch (err) {
      if (availabilityId !== state.availabilityId || !active()) return;
      state.available = null; $('tvAvailability').textContent = err.message; hidden('tvReconnect', false);
    }
    update();
  }
  function savedAccounts() {
    const source = window.sublichatControlData?.() || {};
    const records = [...(source.cuentas || []), ...(source.servicios || [])];
    const seen = new Set(); const query = String($('tvSavedSearch')?.value || '').trim().toLowerCase();
    state.saved = records.filter(row => {
      const email = String(row.correo || '').trim().toLowerCase();
      if (!email || seen.has(email) || P.match(row.plataforma)?.id !== state.platform?.id) return false;
      seen.add(email); return !query || email.includes(query);
    }).sort((a,b) => String(a.correo).localeCompare(String(b.correo), 'es')).slice(0,60);
    $('tvSavedList').innerHTML = state.saved.length ? state.saved.map((row,i) => `<button type="button" data-tv-saved="${i}">${esc(row.correo)}</button>`).join('') :
      '<p>No hay cuentas guardadas que coincidan. Escriba el correo y la clave arriba.</p>';
    $('tvSavedList').querySelectorAll('[data-tv-saved]').forEach(button => { button.onclick = () => {
      const row = state.saved[Number(button.dataset.tvSaved)]; if (!row) return;
      $('tvEmail').value = String(row.correo || '').trim(); $('tvPassword').value = String(row.clave || '');
      state.requestId = ''; $('tvSavedDetails').open = false; $('tvPassword').focus();
    }; });
  }
  function forget() {
    clearTimeout(state.timer); state.generation++; state.session = null; state.busy = false; state.requestId = ''; state.saved = [];
    for (const id of ['tvEmail','tvPassword','tvCode','tvRemoteText','tvSavedSearch']) if ($(id)) $(id).value = '';
    if ($('tvFrame')) $('tvFrame').removeAttribute('src');
    if ($('tvAccountEmail')) $('tvAccountEmail').textContent = '';
    if ($('tvSavedList')) $('tvSavedList').replaceChildren();
    if ($('tvRemoteHost')) $('tvRemoteHost').textContent = '';
    if ($('tvConfirmCheck')) $('tvConfirmCheck').checked = false;
  }
  async function closeCurrent() {
    const sessionId = state.session?.sessionId; forget();
    update();
    if (sessionId) await api({ action:'close', sessionId }).catch(() => {});
  }
  async function selectPlatform(id) {
    if (state.busy || state.session?.busy) return;
    const closing = closeCurrent(); const generation = state.generation;
    state.busy = true; update(); await closing;
    if (generation !== state.generation || !active()) return;
    state.busy = false; state.platform = P.get(id); if (!state.platform) return;
    $('tvLoginTitle').textContent = '1. Iniciar sesión en ' + state.platform.name;
    $('tvCode').inputMode = state.platform.numeric ? 'numeric' : 'text';
    $('tvCode').placeholder = state.platform.codeLength ? state.platform.codeLength + ' caracteres del TV' : 'Código que aparece en el TV';
    hidden('tvWorkspace', false); message(''); update(); $('tvEmail').focus();
  }
  function update() {
    const s = state.session; const busy = state.busy || !!s?.busy; const step = s?.state || '';
    if ($('tvRemote')) $('tvRemote').setAttribute('aria-busy', String(busy));
    document.querySelectorAll('[data-tv-platform]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.tvPlatform === state.platform?.id)); button.disabled = busy;
    });
    if (!$('tvLogin')) return;
    $('tvLogin').disabled = busy || !platformEnabled(); $('tvLogin').textContent = state.busy && !s ? 'Iniciando…' : 'Iniciar sesión';
    hidden('tvLoginForm', !!s); hidden('tvAccount', !s);
    hidden('tvConfirmBox', step !== 'verify_account'); hidden('tvNext', step !== 'ready');
    hidden('tvCodeForm', !['activation','submitting'].includes(step)); hidden('tvDone', step !== 'activated');
    hidden('tvRemote', !s?.frame || step === 'activated');
    const codeStep = ['activation','submitting','activated'].includes(step);
    $('tvStepLogin').setAttribute('aria-current', codeStep ? 'false' : 'step'); $('tvStepCode').setAttribute('aria-current', codeStep ? 'step' : 'false');
    for (const id of ['tvChange','tvConfirm','tvNext','tvActivate','tvRefresh']) $(id).disabled = busy || (id === 'tvConfirm' && !$('tvConfirmCheck').checked);
    $('tvRemote').querySelectorAll('button,input').forEach(element => { element.disabled = busy; });
    if (s) {
      $('tvAccountEmail').textContent = s.email;
      $('tvAccountStatus').textContent = ['ready','activation','submitting','activated'].includes(step) ?
        (s.verifiedBy === 'operator' ? 'Cuenta confirmada por usted' : 'Sesión iniciada') : 'Cuenta para iniciar sesión';
      if (s.frame) {
        $('tvFrame').src = 'data:image/jpeg;base64,' + s.frame.image;
        $('tvRemoteHost').textContent = s.frame.host;
      }
    }
  }
  async function start(event) {
    event.preventDefault(); if (state.busy || state.session || !platformEnabled()) return;
    const email = $('tvEmail').value.trim(); const password = $('tvPassword').value;
    if (!email || !password) return message('Escriba el correo y la clave de la cuenta.', true);
    state.requestId ||= newId(); const generation = state.generation;
    state.busy = true; update(); message('Abriendo una sesión para esta cuenta…');
    try {
      const result = await api({ action:'start', platform:state.platform.id, email, password, requestId:state.requestId });
      if (generation !== state.generation) { void api({ action:'close', sessionId:result.sessionId }).catch(() => {}); return; }
      state.session = result; $('tvPassword').value = ''; message(result.message);
    } catch (err) { if (generation === state.generation) message(err.message, true); }
    finally { if (generation === state.generation) { state.busy = false; update(); schedule(); } }
  }
  function schedule() {
    clearTimeout(state.timer);
    if (active() && state.session && state.session.state !== 'activated' && !document.hidden) state.timer = setTimeout(poll, 2200);
  }
  async function poll() {
    if (!state.session || state.busy || !active() || document.hidden) return schedule();
    const generation = state.generation; state.busy = true; update();
    try {
      const result = await api({ action:'poll', sessionId:state.session.sessionId });
      if (generation !== state.generation) return;
      state.session = result; message(result.message);
    } catch (err) {
      if (generation !== state.generation) return;
      if (err.code === 'TV_SESSION_GONE' || [401,403].includes(err.status)) forget();
      message(err.message, true);
    } finally { if (generation === state.generation) state.busy = false; update(); schedule(); }
  }
  async function command(action, extra = {}) {
    if (!state.session || state.busy || state.session.busy) return;
    const generation = state.generation; state.busy = true; clearTimeout(state.timer); update();
    try {
      const result = await api({ action, sessionId:state.session.sessionId, ...extra });
      if (generation !== state.generation) return;
      state.session = result; message(result.message);
      if (action === 'activate') $('tvCode').value = '';
      if (action === 'confirm_account') $('tvConfirmCheck').checked = false;
    } catch (err) {
      if (generation !== state.generation) return;
      if (err.code === 'TV_SESSION_GONE' || [401,403].includes(err.status)) forget();
      message(err.message, true);
    } finally { if (generation === state.generation) state.busy = false; update(); schedule(); }
  }
  function interact(event) { return command('interact', { event:{ id:newId(), ...event } }); }
  async function open() {
    if (!P.canUse(user())) return;
    state.owner = user(); state.available = null; state.platform = null;
    draw(); await availability();
  }
  function access() {
    const name = user(); const allowed = P.canUse(name);
    hidden('activarTvOpenBtn', !allowed);
    if (state.owner && (state.owner !== name || !document.body.classList.contains('ready'))) { void closeCurrent(); state.owner = ''; }
  }
  function install() {
    if (installed) return true;
    const button = $('activarTvOpenBtn'), screen = $('screen-activar-tv'); if (!button || !screen) return false;
    installed = true;
    button.onclick = () => window.subliRBAC?.go('activar-tv'); access();
    let wasActive = active();
    new MutationObserver(() => {
      const isActive = active(); if (isActive === wasActive) return; wasActive = isActive;
      if (isActive) void open(); else void closeCurrent();
    }).observe(screen, { attributes:true, attributeFilter:['class'] });
    new MutationObserver(access).observe(document.body, { attributes:true, attributeFilter:['class'] });
    window.addEventListener('storage', access);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(state.timer); else schedule(); });
    $('logoutBtn')?.addEventListener('click', () => { void closeCurrent(); }, true);
    window.addEventListener('pagehide', forget);
    if (wasActive) void open();
    return true;
  }
  window.SublichatActivarTV = { open, close:closeCurrent, refreshAccess:() => { install(); access(); } };
  let attempts = 0;
  const timer = setInterval(() => { if (install() || ++attempts > 120) clearInterval(timer); }, 100);
})();
