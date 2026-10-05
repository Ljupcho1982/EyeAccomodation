// Browser UI: profile, clock dial, simulator map, voice/haptic output.
import { buildDemoRoom, DESTINATIONS, START_POSE } from './demo-room.js';
import { Grid, CELL_CM, WALL } from './grid.js';
import { makeProfile, deriveSettings } from './profile.js';
import { analyze } from './planner.js';
import { Navigator } from './session.js';
import { parseCommand } from './voice.js';
import { save, load } from './store.js';
import { relativeBearing, clockHour, roundMeters } from './guidance.js';
import { Aligner, PointMap, handleFrame } from './mapping.js';

const $ = (id) => document.getElementById(id);
const SCALE = 2.4; // canvas px per cm (canvas is 1440 x 1200 for a 600 x 500 cm room)
const TICK_MS = 200;
const WALK_CM_PER_TICK = 20; // about 1 m/s
const TURN_DEG_PER_TICK = 40;

const I18N = {
  mk: {
    tagline: 'Упатства во метри и по часовник, за луѓе што не гледаат и за корисници на колички.',
    theme: 'Светла или темна тема', dialLabel: 'Часовник што покажува каде да свртиш', mapLabel: 'Мапа на просторијата',
    console: 'Сега', toNext: 'до следната точка', goTo: 'Оди до', command: 'Команда', cmdPh: 'оди до кујна', mic: 'Говор',
    simulate: 'Симулатор', stop: 'Стоп', resume: 'Продолжи', lose: 'Изгуби локализација', reloc: 'Потврди локација', reset: 'Рестарт',
    map: 'Просторија 6 × 5 m, мрежа од 5 cm',
    lgWall: 'Ѕид, мебел', lgLow: 'Низок, поминлив', lgTight: 'Претесно за профилот', lgRoute: 'Рута',
    hint: 'Кликни на мапата за да се појави нов предмет од 40 cm.',
    profile: 'Профил', preset: 'Основа',
    p_blind: 'Слеп', p_low: 'Слабовиден', p_wheel: 'Количка', p_comb: 'Количка и слабовиден',
    acuity: 'Острина на вид по корекција', acuityHelp: 'Не диоптрија. На пример 0,1 е 20/200, мерено со очила или леќи.',
    fieldLoss: 'Видно поле', light: 'Светлосна перцепција', width: 'Ширина на количка (cm)', thr: 'Најголем праг (cm)',
    approved: 'Профилот го потврдил',
    'o_field_none': 'Нормално', 'o_field_tunnel': 'Тунелски вид', 'o_field_left': 'Губиток лево', 'o_field_right': 'Губиток десно', 'o_field_central': 'Централен губиток',
    'o_light_normal': 'Нормална', 'o_light_light-only': 'Само светлина и сенка', 'o_light_none': 'Нема',
    'o_approved_self': 'Јас сам', 'o_approved_professional': 'Стручно лице (О&М или лекар)',
    dPass: 'најмал премин', dStep: 'највисок праг', dOut: 'излез',
    out_voice: 'глас + вибрација', out_screen: 'глас + вибрација + екран',
    log: 'Дневник', vault: 'Енкриптирано на уредот', pass: 'Лозинка', vaultHelp: 'Мапата и профилот се чуваат само во овој прелистувач, шифрирани со AES-GCM.',
    save: 'Зачувај', load: 'Вчитај',
    note: 'Ова е симулатор. Локализацијата е симулирана и профилот не е клинички валидиран. Не е замена за бастон или куче водич.',
    idle: 'Подготвен',
    idleHelp: 'Избери место или кажи „оди до кујна“.',
    navigating: 'Навигација до', stopped: 'Застанато', arrived: 'Стигнато',
    reasons: { localization_lost: 'изгубена локализација', no_route: 'нема безбеден пат', goal_blocked: 'целта не е достапна', start_out: 'надвор од мапата', user_stop: 'стоп' },
    total: (d, m) => `Вкупно до ${d}: ${m} m`,
    haptic: { left: 'две лесни: лево', right: 'една силна: десно', lost: 'долга: стоп', none: '' },
    warn: {
      unverified: 'Профилот не е потврден од стручно лице. Користи го само за тестирање.',
      preset_conflict: 'Избраната основа е построга од бројките, па важи построгото.',
      invalid: 'Невалиден внес: ',
      clamped: 'Вредноста е прилагодена: ',
    },
    fields: { acuity: 'острина', widthCm: 'ширина', maxThresholdCm: 'праг' },
    saved: 'Зачувано, шифрирано.', loaded: 'Вчитано.', none: 'Нема зачувано.', wrong: 'Погрешна лозинка.', needPass: 'Внеси лозинка.', noStore: 'Прелистувачот не дозволува зачувување.',
    micNo: 'Микрофонот не е достапен тука. Користи го полето.',
    anchorHint: 'Насочи ја камерата кон маркерот на ѕидот или кажи „потврди локација“ на почетната точка.',
    depth: 'Длабочина (Depth API)', depthOn: 'Длабочината е вклучена.', depthOff: 'Длабочината е исклучена: само ретки точки.',
    markerFound: 'Маркерот е пронајден.', needTracking: 'Почекај, телефонот уште ја наоѓа околината.',
    markerOnly: 'Оваа мапа користи маркер. Насочи ја камерата кон него.',
    locOk: 'Локацијата е потврдена.', resetDone: 'Демото е вратено на почеток.',
    noScreen: 'Профил без екран: само глас и вибрации. Мапата е скриена.',
    dests: { door: 'Врата', table: 'Маса', kitchen: 'Кујна', bed: 'Кревет' },
    lang: 'mk-MK',
  },
  en: {
    tagline: 'Directions in metres and clock positions, for blind and low-vision people and wheelchair users.',
    theme: 'Light or dark theme', dialLabel: 'Clock showing where to turn', mapLabel: 'Room map',
    console: 'Now', toNext: 'to next point', goTo: 'Go to', command: 'Command', cmdPh: 'go to kitchen', mic: 'Speak',
    simulate: 'Simulator', stop: 'Stop', resume: 'Resume', lose: 'Lose localization', reloc: 'Confirm location', reset: 'Restart',
    map: 'Room 6 × 5 m, 5 cm grid',
    lgWall: 'Wall, furniture', lgLow: 'Low, passable', lgTight: 'Too tight for profile', lgRoute: 'Route',
    hint: 'Click the map to drop a new 40 cm object.',
    profile: 'Profile', preset: 'Preset',
    p_blind: 'Blind', p_low: 'Low vision', p_wheel: 'Wheelchair', p_comb: 'Wheelchair and low vision',
    acuity: 'Corrected visual acuity', acuityHelp: 'Not diopters. For example 0.1 is 20/200, measured with glasses or lenses.',
    fieldLoss: 'Visual field', light: 'Light perception', width: 'Wheelchair width (cm)', thr: 'Highest threshold (cm)',
    approved: 'Profile confirmed by',
    'o_field_none': 'Normal', 'o_field_tunnel': 'Tunnel vision', 'o_field_left': 'Left loss', 'o_field_right': 'Right loss', 'o_field_central': 'Central loss',
    'o_light_normal': 'Normal', 'o_light_light-only': 'Light and shadow only', 'o_light_none': 'None',
    'o_approved_self': 'Myself', 'o_approved_professional': 'Professional (O&M or doctor)',
    dPass: 'narrowest passage', dStep: 'highest threshold', dOut: 'output',
    out_voice: 'voice + haptics', out_screen: 'voice + haptics + screen',
    log: 'Log', vault: 'Encrypted on this device', pass: 'Passphrase', vaultHelp: 'The map and profile stay in this browser only, encrypted with AES-GCM.',
    save: 'Save', load: 'Load',
    note: 'This is a simulator. Localization is simulated and the profile is not clinically validated. It does not replace a cane or a guide dog.',
    idle: 'Ready',
    idleHelp: 'Pick a place or say "go to kitchen".',
    navigating: 'Navigating to', stopped: 'Stopped', arrived: 'Arrived',
    reasons: { localization_lost: 'localization lost', no_route: 'no safe route', goal_blocked: 'goal not reachable', start_out: 'outside the map', user_stop: 'stop' },
    total: (d, m) => `Total to ${d}: ${m} m`,
    haptic: { left: 'two light: left', right: 'one strong: right', lost: 'long: stop', none: '' },
    warn: {
      unverified: 'Profile not verified by a professional. Use for testing only.',
      preset_conflict: 'The chosen preset is stricter than the numbers, so the stricter one applies.',
      invalid: 'Invalid input: ',
      clamped: 'Value adjusted: ',
    },
    fields: { acuity: 'acuity', widthCm: 'width', maxThresholdCm: 'threshold' },
    saved: 'Saved, encrypted.', loaded: 'Loaded.', none: 'Nothing saved.', wrong: 'Wrong passphrase.', needPass: 'Enter a passphrase.', noStore: 'This browser blocks saving.',
    micNo: 'Microphone not available here. Use the text box.',
    anchorHint: 'Point the camera at the marker on the wall, or say "confirm location" at the start point.',
    depth: 'Depth (Depth API)', depthOn: 'Depth is on.', depthOff: 'Depth is off: sparse points only.',
    markerFound: 'Marker found.', needTracking: 'Wait, the phone is still finding its surroundings.',
    markerOnly: 'This map uses a marker. Point the camera at it.',
    locOk: 'Location confirmed.', resetDone: 'Demo restored.',
    noScreen: 'Screenless profile: voice and haptics only. Map hidden.',
    dests: { door: 'Door', table: 'Table', kitchen: 'Kitchen', bed: 'Bed' },
    lang: 'en-US',
  },
};

// Inside the Android app a native bridge named `Android` exists: ARCore feeds the pose
// and the map, and speech/vibration go through the phone. In a browser it is the simulator.
const AR = typeof window.Android !== 'undefined';
const AR_GRID_CM = 1200; // 12 x 12 m of map around the home point
const AR_HOME = { x: AR_GRID_CM / 2, y: AR_GRID_CM / 2, heading: 0 };

let L = I18N.mk;
let grid = AR ? new Grid(AR_GRID_CM, AR_GRID_CM) : buildDemoRoom();
let destinations = AR ? [] : DESTINATIONS;
let home = { ...AR_HOME };
let pose = AR ? { ...AR_HOME } : { ...START_POSE };
let aligner = new Aligner(home);
let lastFrame = null;
let hintAt = -Infinity;
let pointMap = new PointMap(grid, aligner);
let arTracking = 'STOPPED';
let depthOn = true;
let depthSeen = false;
let settings;
let nav;
let analysis;
let localization = 1;
let profileInput = {};
let lastSay = '';
let hapticTimer;

const PRESET_DEFAULTS = {
  blind: { acuity: 0, light: 'none', field: 'none' },
  lowvision: { acuity: 0.15, light: 'normal', field: 'none' },
  wheelchair: { acuity: 1, light: 'normal', field: 'none' },
  combined: { acuity: 0.15, light: 'normal', field: 'none' },
};

const destLabel = (d) => L.dests[d.id] ?? d.names[$('lang').value]?.[0] ?? d.names.mk[0];
const preset = () => document.querySelector('input[name="preset"]:checked').value;
const hasChair = () => ['wheelchair', 'combined'].includes(preset());

function applyLang() {
  L = I18N[$('lang').value] ?? I18N.mk;
  document.documentElement.lang = $('lang').value;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = L[el.dataset.i18n]));
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = L[el.dataset.i18nPh]));
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', L[el.dataset.i18nAria]));
  for (const sel of ['field', 'light', 'approved']) {
    for (const o of $(sel).options) o.textContent = L[`o_${sel}_${o.value}`];
  }
  $('legend').innerHTML = '';
  for (const [color, key] of [['var(--m-wall)', 'lgWall'], ['var(--m-low)', 'lgLow'], ['var(--m-tight)', 'lgTight'], ['var(--m-path)', 'lgRoute']]) {
    const s = document.createElement('span');
    const b = document.createElement('b');
    b.style.background = color;
    s.append(b, L[key]);
    $('legend').append(s);
  }
}

function readForm() {
  return {
    preset: preset(),
    acuity: $('acuity').value,
    fieldLoss: $('field').value,
    lightPerception: $('light').value,
    wheelchair: hasChair(),
    widthCm: $('width').value,
    maxThresholdCm: $('thr').value,
    approvedBy: $('approved').value,
    lang: $('lang').value,
  };
}

function writeForm(p) {
  document.querySelector(`input[name="preset"][value="${p.preset}"]`).checked = true;
  $('acuity').value = p.acuity;
  $('field').value = p.fieldLoss;
  $('light').value = p.lightPerception;
  $('width').value = p.widthCm;
  $('thr').value = p.maxThresholdCm;
  $('approved').value = p.approvedBy;
  $('lang').value = p.lang;
}

function fillPresetDefaults() {
  const d = PRESET_DEFAULTS[preset()];
  $('acuity').value = d.acuity;
  $('light').value = d.light;
  $('field').value = d.field;
}

const fmt = (n) => String(n).replace('.', L === I18N.mk ? ',' : '.');

function log(text) {
  const li = document.createElement('li');
  const t = document.createElement('small');
  t.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.append(t, text);
  $('log').prepend(li);
  while ($('log').children.length > 50) $('log').lastChild.remove();
}

function speak(text) {
  lastSay = text;
  $('instruction').textContent = text;
  log(text);
  try {
    if (AR) return window.Android.say(text, L.lang);
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = L.lang;
    speechSynthesis.speak(u);
  } catch {
    /* speech is best-effort; the instruction box is the fallback */
  }
}

function buzz(side, pattern) {
  const pads = side === 'left' ? ['hapL'] : side === 'right' ? ['hapR'] : ['hapL', 'hapR'];
  for (const id of ['hapL', 'hapR']) $(id).classList.remove('on', 'lost');
  for (const id of pads) {
    $(id).classList.add('on');
    if (side === 'lost') $(id).classList.add('lost');
  }
  $('hapText').textContent = L.haptic[side] ?? '';
  clearTimeout(hapticTimer);
  hapticTimer = setTimeout(() => {
    for (const id of ['hapL', 'hapR']) $(id).classList.remove('on', 'lost');
    $('hapText').textContent = '';
  }, 900);
  try {
    if (AR) return window.Android.vibrate(JSON.stringify(pattern));
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

function dispatch(events) {
  for (const e of events) {
    if (e.type === 'say') speak(e.text);
    else if (e.type === 'haptic') buzz(e.side, e.pattern);
    else if (e.type === 'dests') {
      buildDestButtons();
      persist();
    }
  }
  updateStatus();
  render();
}

function updateStatus() {
  const el = $('status');
  let text = L.idle;
  if (nav.state === 'navigating') text = `${L.navigating} ${nav.destName(nav.dest)}`;
  else if (nav.state === 'stopped') text = `${L.stopped}: ${L.reasons[nav.reason] ?? nav.reason}`;
  else if (nav.state === 'arrived') text = `${L.arrived}: ${nav.destName(nav.dest)}`;
  $('statusText').textContent = text;
  el.className = `status ${nav.state}`;
  if (!lastSay && nav.state === 'idle') $('instruction').textContent = L.idleHelp;
}

// In the Android app nothing may start until the map frame is anchored to the real room.
function anchored() {
  if (!AR || aligner.ready) return true;
  speak(L.anchorHint);
  return false;
}

function go(id) {
  if (anchored()) dispatch(nav.goTo(id, pose));
}

function buildDestButtons() {
  const box = $('dests');
  box.replaceChildren();
  for (const d of destinations) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost';
    b.textContent = destLabel(d);
    b.addEventListener('click', () => go(d.id));
    box.append(b);
  }
}

function applyProfile() {
  profileInput = readForm();
  const { profile, warnings } = makeProfile(profileInput);
  settings = deriveSettings(profile);
  $('warnings').replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = (L.warn[w.code] ?? w.code) + (w.field ? (L.fields[w.field] ?? w.field) : '');
      return li;
    }),
  );
  const root = document.documentElement;
  if (settings.highContrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  root.style.setProperty('--fs', settings.fontScale);
  $('wheelFields').hidden = !hasChair();
  $('map').parentElement.hidden = !settings.screen;
  $('legend').hidden = !settings.screen;
  $('screenoff').hidden = settings.screen;
  $('screenoff').textContent = L.noScreen;
  $('hint').textContent = settings.screen ? L.hint : '';
  $('dPass').textContent = `${Math.round(2 * (settings.halfWidthCm + settings.marginCm))} cm`;
  $('dStep').textContent = `${settings.maxStepCm} cm`;
  $('dOut').textContent = settings.screen ? L.out_screen : L.out_voice;
  $('dOut').style.fontSize = '.8em';

  const prev = nav;
  nav = new Navigator({ grid, destinations, settings });
  if (prev?.dest && prev.state === 'navigating') {
    dispatch(nav.goTo(prev.dest.id, pose));
  }
  analysis = analyze(grid, settings);
  buildDestButtons();
  updateStatus();
  render();
}

function refreshText() {
  applyLang();
  applyProfile();
}

// --- simulated user: follows the guidance at walking pace --------------------
function simTick() {
  if (AR) return;
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

// --- dial --------------------------------------------------------------------
const NS = 'http://www.w3.org/2000/svg';
function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildDial() {
  const svg = $('dial');
  svg.append(el('circle', { cx: 110, cy: 110, r: 104, class: 'ring' }));
  for (let h = 1; h <= 12; h++) {
    const a = (h * 30 * Math.PI) / 180;
    const x = 110 + Math.sin(a) * 86;
    const y = 110 - Math.cos(a) * 86;
    svg.append(el('circle', { id: `hb${h}`, cx: x, cy: y, r: 13, class: 'hitbg', opacity: 0 }));
    svg.append(el('text', { id: `ht${h}`, x, y }, String(h)));
    svg.append(el('line', { x1: 110 + Math.sin(a) * 100, y1: 110 - Math.cos(a) * 100, x2: 110 + Math.sin(a) * 96, y2: 110 - Math.cos(a) * 96, class: 'tick' }));
  }
  const needle = el('g', { id: 'needle', class: 'needle', style: 'transform-origin:110px 110px', visibility: 'hidden' });
  needle.append(el('path', { d: 'M110 38 L121 110 L110 122 L99 110 Z', fill: 'var(--primary)' }));
  svg.append(needle);
  svg.append(el('circle', { cx: 110, cy: 110, r: 8, class: 'you' }));
}

function updateReadout() {
  const wp = nav.state === 'navigating' ? nav.waypoints[0] : null;
  for (let h = 1; h <= 12; h++) {
    $(`hb${h}`).setAttribute('opacity', 0);
    $(`ht${h}`).classList.remove('hit');
  }
  if (!wp) {
    $('needle').setAttribute('visibility', 'hidden');
    $('meters').textContent = '—';
    $('clock').textContent = '—';
    $('total').textContent = '';
    return;
  }
  const rel = relativeBearing(pose, wp);
  const hour = Math.abs(rel) < 15 ? 12 : clockHour(rel);
  $('needle').setAttribute('visibility', 'visible');
  $('needle').style.transform = `rotate(${rel}deg)`;
  $(`hb${hour}`).setAttribute('opacity', 1);
  $(`ht${hour}`).classList.add('hit');
  const m = roundMeters(Math.hypot(wp.x - pose.x, wp.y - pose.y));
  $('meters').textContent = fmt(m);
  $('clock').textContent = L === I18N.mk ? `${hour} часот` : `${hour} o'clock`;
  let len = 0;
  let prev = pose;
  for (const w of nav.waypoints) {
    len += Math.hypot(w.x - prev.x, w.y - prev.y);
    prev = w;
  }
  $('total').textContent = L.total(nav.destName(nav.dest), fmt(roundMeters(len)));
}

// --- map ---------------------------------------------------------------------
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// Demo: the whole room fits the canvas. AR: an 10 m window that follows the user.
function view(cv) {
  if (!AR) return { sc: SCALE, ox: 0, oy: 0 };
  const sc = cv.width / 1000;
  return { sc, ox: cv.width / 2 - pose.x * sc, oy: cv.height / 2 - pose.y * sc };
}

function render() {
  updateReadout();
  const cv = $('map');
  if (!settings.screen) return;
  const ctx = cv.getContext('2d');
  const { sc, ox, oy } = view(cv);
  const X = (x) => x * sc + ox;
  const Y = (y) => y * sc + oy;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = cssVar('--m-floor');
  ctx.fillRect(0, 0, cv.width, cv.height);
  const s = CELL_CM * sc;
  const wall = cssVar('--m-wall');
  const obst = cssVar('--m-obst');
  const low = cssVar('--m-low');
  const tight = cssVar('--m-tight');
  for (let r = 0; r < grid.rows; r++) {
    const py = r * s + oy;
    if (py > cv.height || py + s < 0) continue;
    for (let c = 0; c < grid.cols; c++) {
      const px = c * s + ox;
      if (px > cv.width || px + s < 0) continue;
      const i = grid.idx(c, r);
      const h = grid.h[i];
      if (h > 0) ctx.fillStyle = h >= WALL ? wall : h > settings.maxStepCm ? obst : low;
      else if (!analysis.passable[i]) ctx.fillStyle = tight;
      else continue;
      ctx.fillRect(px, py, s + 0.5, s + 0.5);
    }
  }
  const ink = cssVar('--ink');
  const primary = cssVar('--m-path');
  ctx.font = `600 ${26 * Math.max(1, settings.fontScale * 0.85)}px ${cssVar('--f-body')}`;
  ctx.textBaseline = 'middle';
  for (const d of destinations) {
    const x = X(d.pos.x);
    const y = Y(d.pos.y);
    ctx.fillStyle = cssVar('--surface');
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 7);
    ctx.fill();
    ctx.stroke();
    const label = destLabel(d);
    const w = ctx.measureText(label).width;
    const lx = x + 20 + w > cv.width - 10 ? x - 20 - w : x + 20;
    ctx.lineWidth = 6;
    ctx.strokeStyle = cssVar('--m-floor');
    ctx.strokeText(label, lx, y);
    ctx.fillStyle = ink;
    ctx.fillText(label, lx, y);
  }
  if (nav.state === 'navigating' && nav.waypoints.length) {
    ctx.strokeStyle = primary;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([22, 14]);
    ctx.beginPath();
    ctx.moveTo(X(pose.x), Y(pose.y));
    for (const w of nav.waypoints) ctx.lineTo(X(w.x), Y(w.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = primary;
    for (const w of nav.waypoints) {
      ctx.beginPath();
      ctx.arc(X(w.x), Y(w.y), 9, 0, 7);
      ctx.fill();
    }
  }
  ctx.save();
  ctx.translate(X(pose.x), Y(pose.y));
  ctx.rotate((pose.heading * Math.PI) / 180);
  const lost = AR ? arTracking !== 'TRACKING' : localization < 0.6;
  ctx.fillStyle = lost ? cssVar('--danger') : ink;
  ctx.strokeStyle = cssVar('--m-floor');
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -32);
  ctx.lineTo(22, 24);
  ctx.lineTo(0, 12);
  ctx.lineTo(-22, 24);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// --- input -------------------------------------------------------------------
function runCommand(text) {
  if (!text.trim()) return;
  const cmd = parseCommand(text, destinations);
  if (AR && cmd.type === 'confirm') return confirmLocation();
  if (!anchored()) return;
  dispatch(nav.handle(cmd, pose, performance.now()));
}

// "Confirm location" without a marker: the user says they stand at the saved start point.
function confirmLocation() {
  if (!lastFrame || lastFrame.tracking !== 'TRACKING') return speak(L.needTracking);
  if (!aligner.startFromCamera(lastFrame)) return speak(L.markerOnly);
  nav.needsRelocalize = false;
  pose = aligner.pose(lastFrame);
  speak(L.locOk);
  persist();
  render();
}

function setupMic() {
  if (AR) {
    // Android WebView has no SpeechRecognition; the native recognizer answers via __arCommand.
    $('micBtn').addEventListener('click', () => window.Android.listen(L.lang));
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('micBtn').disabled = true;
    return;
  }
  $('micBtn').addEventListener('click', () => {
    try {
      const rec = new SR();
      rec.lang = L.lang;
      // Ask for on-device recognition where supported. The real build must ship an offline model.
      if ('processLocally' in rec) rec.processLocally = true;
      rec.onresult = (ev) => {
        const text = ev.results[0][0].transcript;
        $('cmd').value = text;
        runCommand(text);
      };
      rec.onerror = () => log(L.micNo);
      rec.start();
    } catch {
      log(L.micNo);
    }
  });
}

function vaultMsg(text) {
  $('vaultMsg').textContent = text;
}

function reset() {
  if (AR) return;
  grid = buildDemoRoom();
  pose = { ...START_POSE };
  localization = 1;
  lastSay = '';
  $('instruction').textContent = L.idleHelp;
  applyProfile();
  log(L.resetDone);
}

$('presets').addEventListener('change', () => {
  fillPresetDefaults();
  applyProfile();
});
for (const id of ['acuity', 'field', 'light', 'width', 'thr', 'approved']) $(id).addEventListener('change', applyProfile);
$('lang').addEventListener('change', refreshText);
$('themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  render();
});
$('cmdBtn').addEventListener('click', () => runCommand($('cmd').value));
$('cmd').addEventListener('keydown', (e) => e.key === 'Enter' && runCommand($('cmd').value));
$('stopBtn').addEventListener('click', () => dispatch(nav.stop()));
$('resumeBtn').addEventListener('click', () => dispatch(nav.resume(pose, performance.now())));
$('lostBtn').addEventListener('click', () => {
  localization = 0.3;
  const ev = nav.update(pose, { localization, now: performance.now() });
  if (!ev.length) nav.needsRelocalize = true; // not navigating: still require confirmation
  dispatch(ev);
});
$('relocBtn').addEventListener('click', () => {
  localization = 1;
  nav.relocalize(pose);
  log(L.locOk);
  render();
});
$('resetBtn').addEventListener('click', reset);
$('depthToggle').addEventListener('change', () => {
  depthOn = $('depthToggle').checked;
  log(depthOn ? L.depthOn : L.depthOff);
});
$('map').addEventListener('click', (e) => {
  const rect = $('map').getBoundingClientRect();
  const v = view($('map'));
  const x = (((e.clientX - rect.left) / rect.width) * $('map').width - v.ox) / v.sc;
  const y = (((e.clientY - rect.top) / rect.height) * $('map').height - v.oy) / v.sc;
  const ev = nav.addObstacle({ x0: x - 20, y0: y - 20, x1: x + 20, y1: y + 20, height: 40 }, pose, performance.now());
  analysis = analyze(grid, settings);
  dispatch(ev);
});
$('saveBtn').addEventListener('click', async () => {
  const pass = $('pass').value;
  if (!pass) return vaultMsg(L.needPass);
  try {
    await save(localStorage, { grid: grid.toJSON(), profile: profileInput }, pass);
    vaultMsg(L.saved);
  } catch {
    vaultMsg(L.noStore);
  }
});
$('loadBtn').addEventListener('click', async () => {
  const pass = $('pass').value;
  if (!pass) return vaultMsg(L.needPass);
  try {
    const data = await load(localStorage, pass);
    if (!data) return vaultMsg(L.none);
    grid = Grid.fromJSON(data.grid);
    writeForm(data.profile);
    applyLang();
    applyProfile();
    vaultMsg(L.loaded);
  } catch (err) {
    vaultMsg(err.message === 'wrong_passphrase_or_corrupted' ? L.wrong : L.noStore);
  }
});

buildDial();
applyLang();
fillPresetDefaults();
applyProfile();
setupMic();
setInterval(simTick, TICK_MS);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);

// --- ARCore bridge (Android app only) -----------------------------------------
let saveTimer;
function persist() {
  if (!AR) return;
  if (saveTimer) return; // throttle: at most one save per 5 s while frames keep arriving
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      window.Android.secureSave(JSON.stringify({ v: 2, grid: grid.toSparse(), home, anchor: aligner.expected, destinations, profile: profileInput }));
    } catch {
      /* the native side reports storage problems */
    }
  }, 5000);
}

function restore() {
  try {
    const raw = window.Android.secureLoad();
    if (!raw) return;
    const d = JSON.parse(raw);
    grid = Grid.fromSparse(d.grid);
    destinations = d.destinations;
    home = d.home;
    aligner = new Aligner(home, d.anchor ?? null);
    pointMap = new PointMap(grid, aligner);
    if (d.profile) {
      writeForm(d.profile);
      applyLang();
    }
  } catch {
    /* corrupt or missing: start with an empty map */
  }
}

// Called by the native side about 10 times a second with one ARCore frame:
// { tracking, x, z, fx, fz, floorY, points: [x, y, z, ...] } in ARCore world metres.
window.__arFrame = (f) => {
  arTracking = f.tracking;
  lastFrame = f;
  const wasReady = aligner.ready;
  const wasLost = nav.state === 'stopped' && nav.reason === 'localization_lost';
  if (f.depth !== undefined && !depthSeen) {
    depthSeen = true;
    $('depthRow').hidden = false;
  }
  const r = handleFrame({ f, nav, aligner, pointMap, now: performance.now(), useDepth: depthOn });
  if (r.pose) pose = r.pose;
  if (r.mapChanged) analysis = analyze(grid, settings);
  if (r.anchored && (!wasReady || wasLost)) speak(L.markerFound);
  if (!aligner.ready && performance.now() - hintAt > 10000) {
    hintAt = performance.now();
    speak(L.anchorHint);
  }
  dispatch(r.events);
  persist();
};

// Status notes from native code (missing voice, camera, ARCore). Spoken and logged.
const NOTES = {
  mk: {
    tts_fallback: 'Македонскиот глас не е инсталиран. Користам близок глас.',
    tts_missing: 'Нема инсталиран глас за говор. Инсталирај глас во поставките на телефонот.',
    stt_maybe_online: 'Офлајн препознавање на говор не е инсталирано. Звукот може да оди преку интернет.',
    stt_missing: 'Препознавањето на говор не е достапно на овој телефон.',
    camera_denied: 'Треба дозвола за камера за да знам каде си.',
    camera_busy: 'Камерата е зафатена од друга апликација.',
    arcore_unavailable: 'ARCore не е достапен на овој телефон.',
    marker_quality: 'ARCore не го прифати маркерот. Користи „потврди локација“.',
  },
  en: {
    tts_fallback: 'The Macedonian voice is not installed. Using a close voice.',
    tts_missing: 'No speech voice is installed. Install one in the phone settings.',
    stt_maybe_online: 'Offline speech recognition is not installed. Audio may go over the internet.',
    stt_missing: 'Speech recognition is not available on this phone.',
    camera_denied: 'Camera permission is needed to know where you are.',
    camera_busy: 'The camera is in use by another app.',
    arcore_unavailable: 'ARCore is not available on this phone.',
    marker_quality: 'ARCore rejected the marker. Use "confirm location".',
  },
};
window.__arNote = (key) => {
  const t = (NOTES[$('lang').value] ?? NOTES.mk)[key];
  if (t) speak(t);
  else log(key);
};

// Voice recognition result from the native recognizer.
window.__arCommand = (text) => runCommand(text);

if (AR) {
  document.body.dataset.mode = 'ar';
  restore();
  applyProfile();
  buildDestButtons();
  window.Android.ready?.();
}
