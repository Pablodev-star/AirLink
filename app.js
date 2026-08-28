/*
 * AirLink — envia la camara del movil a AirTouch por WebRTC.
 *
 * Como funciona
 * -------------
 * 1. Esta pagina pide la camara con getUserMedia (hace falta HTTPS).
 * 2. Abre un WebSocket seguro contra el PC: solo se usa para el saludo
 *    (unos 3 KB de SDP y candidatos ICE).
 * 3. Monta una RTCPeerConnection y le anade la pista de video. A partir de
 *    ahi el video va DIRECTO del movil al PC por la red local, cifrado y
 *    codificado por hardware. No pasa por ningun servidor.
 *
 * No hay dependencias externas a proposito: la pagina entera pesa unos pocos
 * KB y arranca al instante aunque el WiFi vaya justo.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const LS = 'airlink.settings.v1';

const state = {
  pc: null,
  ws: null,
  stream: null,
  wakeLock: null,
  statsTimer: null,
  reconnect: 0,
  stopping: false,
  lastBytes: 0,
  lastStatsAt: 0,
};

const settings = {
  host: '', port: '8443', token: '',
  res: '1920x1080', fps: '60', cam: 'environment', remember: true,
};

// ---------------------------------------------------------------- ajustes
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem(LS) || '{}')); }
  catch (_) { /* primera vez */ }

  // Los parametros de la URL mandan: es lo que trae el QR del PC.
  const q = new URLSearchParams(location.search);
  for (const k of ['host', 'port', 'token']) {
    if (q.get(k)) settings[k] = q.get(k);
  }
  if (q.get('res')) settings.res = q.get('res');
  if (q.get('fps')) settings.fps = q.get('fps');
}

function saveSettings() {
  if (!settings.remember) { localStorage.removeItem(LS); return; }
  try { localStorage.setItem(LS, JSON.stringify(settings)); } catch (_) {}
}

function applySettingsToForm() {
  $('host').value = settings.host;
  $('port').value = settings.port;
  $('token').value = settings.token;
  $('remember').checked = settings.remember;
  markSeg('seg-res', settings.res);
  markSeg('seg-fps', settings.fps);
  markSeg('seg-cam', settings.cam);
}

function markSeg(id, value) {
  for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === String(value));
}

function wireSeg(id, key) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[key] = b.dataset.v;
    markSeg(id, b.dataset.v);
  });
}

// ---------------------------------------------------------------- vistas
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.classList.remove('active');
  $(view).classList.add('active');
}

function setState(text, kind) {
  $('state').textContent = text;
  $('dot').className = 'dot' + (kind ? ' ' + kind : '');
}

function fail(message) {
  const el = $('pair-error');
  el.textContent = message;
  el.hidden = false;
  $('btn-connect').disabled = false;
  $('btn-connect').textContent = 'Conectar';
}

// ---------------------------------------------------------------- camara
async function openCamera() {
  const [w, h] = settings.res.split('x').map(Number);
  const fps = Number(settings.fps);

  // "ideal" y no "exact": si la camara no llega a 4K60 preferimos que baje
  // sola antes de fallar con un error que no dice nada.
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: settings.cam },
      width: { ideal: w },
      height: { ideal: h },
      frameRate: { ideal: fps, min: 24 },
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const track = stream.getVideoTracks()[0];

  // Segundo intento: algunos iPhone entregan 30 fps si no se les insiste.
  if (fps > 30) {
    try { await track.applyConstraints({ frameRate: { ideal: fps } }); }
    catch (_) { /* la camara no da mas: seguimos igualmente */ }
  }
  return stream;
}

function describeTrack() {
  const t = state.stream && state.stream.getVideoTracks()[0];
  if (!t) return {};
  const s = t.getSettings ? t.getSettings() : {};
  return { w: s.width, h: s.height, fps: Math.round(s.frameRate || 0) };
}

// ---------------------------------------------------------------- pantalla
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && !state.stopping) {
          try { state.wakeLock = await navigator.wakeLock.request('screen'); }
          catch (_) {}
        }
      });
    }
  } catch (_) { /* sin bloqueo de pantalla: no es critico */ }
}

// ---------------------------------------------------------------- conexion
function signalUrl() {
  const host = settings.host.trim();
  const port = (settings.port || '8443').trim();
  const token = encodeURIComponent(settings.token.trim());
  return `wss://${host}:${port}/signal?role=phone&token=${token}`;
}

async function connect() {
  settings.host = $('host').value.trim();
  settings.port = $('port').value.trim() || '8443';
  settings.token = $('token').value.trim();
  settings.remember = $('remember').checked;

  if (!settings.host) return fail('Falta la dirección del PC.');
  if (!settings.token) return fail('Falta el código de emparejamiento.');
  saveSettings();

  $('pair-error').hidden = true;
  $('btn-connect').disabled = true;
  $('btn-connect').textContent = 'Pidiendo la cámara…';

  try {
    state.stream = await openCamera();
  } catch (err) {
    return fail(cameraError(err));
  }

  $('preview').srcObject = state.stream;
  $('preview').style.transform =
    settings.cam === 'user' ? 'scaleX(-1)' : 'none';
  show('view-live');
  setState('Conectando…');
  keepAwake();
  openSignal();
}

function cameraError(err) {
  const n = err && err.name;
  if (n === 'NotAllowedError') {
    return 'Has denegado el acceso a la cámara. Actívalo en Ajustes → Safari.';
  }
  if (n === 'NotFoundError') return 'No se ha encontrado ninguna cámara.';
  if (n === 'NotReadableError') {
    return 'Otra app está usando la cámara. Ciérrala y vuelve a intentarlo.';
  }
  if (location.protocol !== 'https:') {
    return 'La cámara solo funciona por HTTPS. Abre la página con https://';
  }
  return 'No se ha podido abrir la cámara: ' + (err && err.message ? err.message : err);
}

function openSignal() {
  let ws;
  try {
    ws = new WebSocket(signalUrl());
  } catch (err) {
    setState('No se pudo abrir la conexión', 'bad');
    return;
  }
  state.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'hello',
      device: navigator.userAgent,
      camera: settings.cam,
      requested: { res: settings.res, fps: Number(settings.fps) },
    }));
    startWebrtc();
  };

  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }

    if (msg.type === 'answer') {
      await state.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      setState('Transmitiendo', 'ok');
      state.reconnect = 0;
    } else if (msg.type === 'ice' && msg.candidate) {
      try { await state.pc.addIceCandidate(msg.candidate); } catch (_) {}
    } else if (msg.type === 'error') {
      setState(msg.message || 'El PC ha rechazado la conexión', 'bad');
      teardown(false);
    } else if (msg.type === 'bye') {
      setState('El PC ha cerrado la sesión', 'bad');
      teardown(false);
    }
  };

  ws.onclose = () => {
    if (state.stopping) return;
    setState('Conexión perdida, reintentando…', 'bad');
    retry();
  };
  ws.onerror = () => { /* onclose se encarga */ };
}

function retry() {
  state.reconnect += 1;
  if (state.reconnect > 12) {
    setState('No se puede alcanzar el PC', 'bad');
    return;
  }
  const wait = Math.min(1000 * state.reconnect, 6000);
  setTimeout(() => {
    if (state.stopping) return;
    closePeer();
    openSignal();
  }, wait);
}

async function startWebrtc() {
  const pc = new RTCPeerConnection({
    // Solo red local: no hacen falta STUN ni TURN, y asi no se filtra
    // absolutamente nada fuera de tu WiFi.
    iceServers: [],
    bundlePolicy: 'max-bundle',
  });
  state.pc = pc;

  const track = state.stream.getVideoTracks()[0];
  const sender = pc.addTrack(track, state.stream);

  // Calidad: nada de bajar resolucion para ahorrar ancho de banda. En una LAN
  // sobra, y aqui la nitidez es justo lo que hace falta.
  try {
    const p = sender.getParameters();
    p.encodings = [{
      maxBitrate: 24_000_000,
      maxFramerate: Number(settings.fps),
      degradationPreference: 'maintain-resolution',
    }];
    p.degradationPreference = 'maintain-resolution';
    await sender.setParameters(p);
  } catch (_) { /* si el navegador no deja, se queda en automatico */ }

  pc.onicecandidate = (e) => {
    if (e.candidate && state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') setState('Transmitiendo', 'ok');
    else if (s === 'connecting') setState('Estableciendo vídeo…');
    else if (s === 'failed') { setState('Vídeo caído, reintentando…', 'bad'); retry(); }
    else if (s === 'disconnected') setState('Reconectando…', 'bad');
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));

  startStats();
}

// ---------------------------------------------------------------- metricas
function startStats() {
  stopStats();
  state.statsTimer = setInterval(async () => {
    if (!state.pc) return;
    const info = describeTrack();
    if (info.w) $('s-res').textContent = info.w + '×' + info.h;

    let fps = info.fps || 0;
    let mbps = 0;
    let rtt = 0;
    try {
      const report = await state.pc.getStats();
      report.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          if (r.framesPerSecond) fps = Math.round(r.framesPerSecond);
          const now = r.timestamp;
          if (state.lastStatsAt && r.bytesSent > state.lastBytes) {
            const dt = (now - state.lastStatsAt) / 1000;
            if (dt > 0) {
              mbps = ((r.bytesSent - state.lastBytes) * 8) / dt / 1e6;
            }
          }
          state.lastBytes = r.bytesSent;
          state.lastStatsAt = now;
        }
        if (r.type === 'candidate-pair' && r.state === 'succeeded' &&
            r.currentRoundTripTime != null) {
          rtt = Math.round(r.currentRoundTripTime * 1000);
        }
      });
    } catch (_) {}

    $('s-fps').textContent = fps || '—';
    $('s-kbps').textContent = mbps ? mbps.toFixed(1) : '—';
    $('s-rtt').textContent = rtt || '—';
  }, 1000);
}

function stopStats() {
  if (state.statsTimer) clearInterval(state.statsTimer);
  state.statsTimer = null;
}

// ---------------------------------------------------------------- cierre
function closePeer() {
  if (state.pc) { try { state.pc.close(); } catch (_) {} state.pc = null; }
  if (state.ws) {
    try { state.ws.onclose = null; state.ws.close(); } catch (_) {}
    state.ws = null;
  }
}

function teardown(goBack = true) {
  state.stopping = true;
  stopStats();
  closePeer();
  if (state.stream) {
    for (const t of state.stream.getTracks()) t.stop();
    state.stream = null;
  }
  if (state.wakeLock) { try { state.wakeLock.release(); } catch (_) {} state.wakeLock = null; }
  if (goBack) {
    show('view-pair');
    $('btn-connect').disabled = false;
    $('btn-connect').textContent = 'Conectar';
  }
  state.stopping = false;
}

// ---------------------------------------------------------------- arranque
loadSettings();
applySettingsToForm();
wireSeg('seg-res', 'res');
wireSeg('seg-fps', 'fps');
wireSeg('seg-cam', 'cam');

$('btn-connect').addEventListener('click', connect);
$('btn-stop').addEventListener('click', () => {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: 'bye' }));
  }
  teardown(true);
});
window.addEventListener('pagehide', () => teardown(false));

// isSecureContext es la comprobacion correcta: cubre https, localhost y
// 127.0.0.1 sin tener que enumerarlos a mano.
if (!window.isSecureContext) {
  fail('Esta página necesita HTTPS para poder usar la cámara.');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
