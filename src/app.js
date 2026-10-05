// Browser UI: profile form, simulator canvas, voice/haptic output.
import { buildDemoRoom, DESTINATIONS, START_POSE } from './demo-room.js';
import { Grid, CELL_CM, WALL } from './grid.js';
import { makeProfile, deriveSettings } from './profile.js';
import { analyze } from './planner.js';
import { Navigator } from './session.js';
import { parseCommand } from './voice.js';
import { save, load } from './store.js';
import { relativeBearing } from './guidance.js';

const $ = (id) => document.getElementById(id);
const SCALE = 1.2; // canvas px per cm
const TICK_MS = 200;
const WALK_CM_PER_TICK = 20; // ~1 m/s
const TURN_DEG_PER_TICK = 40;

const UI = {
  mk: {
    idle: 'Подготвен. Кажи „оди до кујна“.',
    navigating: 'Навигација до',
    stopped: 'ЗАСТАНАТО',
    arrived: 'Стигнато',
    reasons: { localization_lost: 'изгубена локализација', no_route: 'нема безбеден пат', goal_blocked: 'целта не е достапна', user_stop: 'стоп' },
    warn: {
      unverified: 'Профилот не е потврден од стручно лице. Користете го само за тестирање.',
      preset_conflict: 'Избраната основа е построга од бројките. Се користи построгиот профил.',
      invalid: 'Невалиден внес: ',
      clamped: 'Вредноста е прилагодена: ',
    },
    haptic: { left: '◀ две лесни (лево)', right: 'една силна (десно) ▶', lost: '▮▮ долга (стоп)' },
    saved: 'Зачувано (енкриптирано).', loaded: 'Вчитано.', none: 'Нема зачувано.', wrong: 'Погрешна лозинка.',
    pass: 'Лозинка:', noScreen: 'Профилот е без екран: само глас и вибрации. Мапата е скриена.',
    mic: 'Микрофонот не е достапен во овој прелистувач. Користи го полето за текст.',
    dests: { door: 'Врата', table: 'Маса', kitchen: 'Кујна', bed: 'Кревет' },
  },
  en: {
    idle: 'Ready. Say "go to kitchen".',
    navigating: 'Navigating to',
    stopped: 'STOPPED',
    arrived: 'Arrived',
    reasons: { localization_lost: 'localization lost', no_route: 'no safe route', goal_blocked: 'goal not reachable', user_stop: 'stop' },
    warn: {
      unverified: 'Profile not verified by a professional. Use for testing only.',
      preset_conflict: 'The chosen preset is stricter than the numbers. Using the stricter profile.',
      invalid: 'Invalid input: ',
      clamped: 'Value adjusted: ',
    },
    haptic: { left: '◀ two light (left)', right: 'one strong (right) ▶', lost: '▮▮ long (stop)' },
    saved: 'Saved (encrypted).', loaded: 'Loaded.', none: 'Nothing saved.', wrong: 'Wrong passphrase.',
    pass: 'Passphrase:', noScreen: 'Screenless profile: voice and haptics only. Map hidden.',
    mic: 'Microphone not available in this browser. Use the text box.',
    dests: { door: 'Door', table: 'Table', kitchen: 'Kitchen', bed: 'Bed' },
  },
};

let grid = buildDemoRoom();
let pose = { ...START_POSE };
let settings;
let nav;
let analysis;
let localization = 1;
let profileInput = {};
let lastStatus = '';

function readForm() {
  return {
    preset: $('preset').value,
    acuity: $('acuity').value,
    fieldLoss: $('field').value,
    lightPerception: $('light').value,
    wheelchair: $('preset').value === 'wheelchair' || $('preset').value === 'combined',
    widthCm: $('width').value,
    maxThresholdCm: $('thr').value,
    approvedBy: $('approved').value,
    lang: $('lang').value,
  };
}

function writeForm(p) {
  $('preset').value = p.preset;
  $('acuity').value = p.acuity;
  $('field').value = p.fieldLoss;
  $('light').value = p.lightPerception;
  $('width').value = p.widthCm;
  $('thr').value = p.maxThresholdCm;
  $('approved').value = p.approvedBy;
  $('lang').value = p.lang;
}

// Picking a preset fills in typical numbers so the form never contradicts it.
function onPresetChange() {
  const defaults = {
    blind: { acuity: 0, light: 'none', field: 'none' },
    lowvision: { acuity: 0.15, light: 'normal', field: 'none' },
    wheelchair: { acuity: 1, light: 'normal', field: 'none' },
    combined: { acuity: 0.15, light: 'normal', field: 'none' },
  }[$('preset').value];
  $('acuity').value = defaults.acuity;
  $('light').value = defaults.light;
  $('field').value = defaults.field;
  $('wheel-fields').hidden = !['wheelchair', 'combined'].includes($('preset').value);
}

function log(text) {
  const li = document.createElement('li');
  li.textContent = text;
  $('log').prepend(li);
  while ($('log').children.length > 40) $('log').lastChild.remove();
}

function speak(text) {
  log(text);
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = settings.lang === 'en' ? 'en-US' : 'mk-MK';
    speechSynthesis.speak(u);
  } catch {
    /* speech is best-effort; the log line above is the fallback */
  }
}

function buzz(side, pattern) {
  $('haptic').textContent = UI[settings.lang].haptic[side] ?? side;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

function dispatch(events) {
  for (const e of events) {
    if (e.type === 'say') speak(e.text);
    else if (e.type === 'haptic') buzz(e.side, e.pattern);
    else if (e.type === 'state') updateStatus();
  }
  render();
}

function updateStatus() {
  const t = UI[settings.lang];
  const el = $('status');
  let text = t.idle;
  if (nav.state === 'navigating') text = `${t.navigating} ${nav.destName(nav.dest)}`;
  else if (nav.state === 'stopped') text = `${t.stopped}: ${t.reasons[nav.reason] ?? nav.reason}`;
  else if (nav.state === 'arrived') text = `${t.arrived}: ${nav.destName(nav.dest)}`;
  el.textContent = text;
  el.className = nav.state;
  lastStatus = text;
}

function buildDestButtons() {
  const box = $('dests');
  box.replaceChildren();
  for (const d of DESTINATIONS) {
    const b = document.createElement('button');
    b.textContent = UI[settings.lang].dests[d.id] ?? d.id;
    b.addEventListener('click', () => dispatch(nav.goTo(d.id, pose)));
    box.append(b);
  }
}

function applyProfile() {
  profileInput = readForm();
  const { profile, warnings } = makeProfile(profileInput);
  settings = deriveSettings(profile);
  const t = UI[settings.lang];
  $('warnings').replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = (t.warn[w.code] ?? w.code) + (w.field ? w.field : '');
      return li;
    }),
  );
  document.documentElement.dataset.contrast = settings.highContrast ? 'high' : '';
  if (!settings.highContrast) delete document.documentElement.dataset.contrast;
  document.documentElement.style.setProperty('--fs', settings.fontScale);
  document.documentElement.lang = settings.lang;
  $('map').hidden = !settings.screen;
  $('t-click').textContent = settings.screen ? '' : t.noScreen;
  const prev = nav;
  nav = new Navigator({ grid, destinations: DESTINATIONS, settings });
  if (prev?.dest && prev.state === 'navigating') {
    nav.dest = prev.dest;
    dispatch(nav.goTo(prev.dest.id, pose));
  }
  analysis = analyze(grid, settings);
  buildDestButtons();
  updateStatus();
  render();
}

// --- simulated user: follows the guidance at walking pace -------------------
function simTick() {
  if (nav.state !== 'navigating' || !nav.waypoints.length) return;
  const wp = nav.waypoints[0];
  const rel = relativeBearing(pose, wp);
  const turn = Math.max(-TURN_DEG_PER_TICK, Math.min(TURN_DEG_PER_TICK, rel));
  pose.heading = (pose.heading + turn + 360) % 360;
  if (Math.abs(rel) < 25) {
    const rad = (pose.heading * Math.PI) / 180;
    pose.x += Math.sin(rad) * WALK_CM_PER_TICK;
    pose.y -= Math.cos(rad) * WALK_CM_PER_TICK;
  }
  dispatch(nav.update(pose, { localization, now: performance.now() }));
}

// --- rendering --------------------------------------------------------------
function render() {
  const cv = $('map');
  if (cv.hidden) return;
  const ctx = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--fg').trim();
  const accent = css.getPropertyValue('--accent').trim();
  ctx.clearRect(0, 0, cv.width, cv.height);
  const s = CELL_CM * SCALE;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = grid.idx(c, r);
      const h = grid.h[i];
      if (h > 0) {
        ctx.fillStyle = h >= WALL ? fg : h > settings.maxStepCm ? '#888' : 'rgba(180,140,60,.5)';
        ctx.fillRect(c * s, r * s, s, s);
      } else if (!analysis.passable[i]) {
        ctx.fillStyle = 'rgba(220,60,40,.15)'; // too tight for this profile
        ctx.fillRect(c * s, r * s, s, s);
      }
    }
  }
  ctx.font = `${14 * Math.max(1, settings.fontScale * 0.8)}px system-ui`;
  for (const d of DESTINATIONS) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(d.pos.x * SCALE, d.pos.y * SCALE, 6, 0, 7);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(UI[settings.lang].dests[d.id], d.pos.x * SCALE + 9, d.pos.y * SCALE + 5);
  }
  if (nav.waypoints.length) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(pose.x * SCALE, pose.y * SCALE);
    for (const w of nav.waypoints) ctx.lineTo(w.x * SCALE, w.y * SCALE);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.save();
  ctx.translate(pose.x * SCALE, pose.y * SCALE);
  ctx.rotate((pose.heading * Math.PI) / 180);
  ctx.fillStyle = localization < 0.6 ? '#b42318' : fg;
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(9, 10);
  ctx.lineTo(-9, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- input ------------------------------------------------------------------
function runCommand(text) {
  dispatch(nav.handle(parseCommand(text, DESTINATIONS), pose, performance.now()));
}

function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('micBtn').disabled = true;
    $('micBtn').title = UI[settings.lang].mic;
    return;
  }
  $('micBtn').addEventListener('click', () => {
    const rec = new SR();
    rec.lang = settings.lang === 'en' ? 'en-US' : 'mk-MK';
    // Ask for on-device recognition where the browser supports it. Without it the
    // recognizer may use a network service: the real build must ship an offline model.
    if ('processLocally' in rec) rec.processLocally = true;
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      $('cmd').value = text;
      runCommand(text);
    };
    rec.start();
  });
}

$('preset').addEventListener('change', onPresetChange);
$('apply').addEventListener('click', applyProfile);
$('cmdBtn').addEventListener('click', () => runCommand($('cmd').value));
$('cmd').addEventListener('keydown', (e) => e.key === 'Enter' && runCommand($('cmd').value));
$('stopBtn').addEventListener('click', () => dispatch(nav.stop()));
$('resumeBtn').addEventListener('click', () => dispatch(nav.resume(pose, performance.now())));
$('lostBtn').addEventListener('click', () => {
  localization = 0.3;
  dispatch(nav.update(pose, { localization, now: performance.now() }));
});
$('relocBtn').addEventListener('click', () => {
  localization = 1;
  nav.relocalize(pose);
  log(settings.lang === 'en' ? 'Location confirmed.' : 'Локацијата е потврдена.');
  render();
});
$('map').addEventListener('click', (e) => {
  const rect = $('map').getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 600;
  const y = ((e.clientY - rect.top) / rect.height) * 500;
  dispatch(nav.addObstacle({ x0: x - 20, y0: y - 20, x1: x + 20, y1: y + 20, height: 40 }, pose, performance.now()));
  analysis = analyze(grid, settings);
  render();
});
$('saveBtn').addEventListener('click', async () => {
  const pass = prompt(UI[settings.lang].pass);
  if (!pass) return;
  await save(localStorage, { grid: grid.toJSON(), profile: profileInput }, pass);
  log(UI[settings.lang].saved);
});
$('loadBtn').addEventListener('click', async () => {
  const pass = prompt(UI[settings.lang].pass);
  if (!pass) return;
  try {
    const data = await load(localStorage, pass);
    if (!data) return log(UI[settings.lang].none);
    grid = Grid.fromJSON(data.grid);
    writeForm(data.profile);
    onPresetChange();
    writeForm(data.profile);
    applyProfile();
    log(UI[settings.lang].loaded);
  } catch {
    log(UI[settings.lang].wrong);
  }
});

onPresetChange();
applyProfile();
setupMic();
setInterval(simTick, TICK_MS);
