// Guidance in metres and clock positions, plus haptic patterns.
// Heading convention: degrees clockwise from "up" (-y) on the map.
// Clock: 12 = straight ahead, 3 = right, 6 = behind, 9 = left.

export const HAPTIC_TOL_DEG = 12;
export const TURN_MIN_DEG = 15;

export function normalizeAngle(a) {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
}

export function bearingDeg(from, to) {
  return (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
}

// Positive = target is to the right of where the user is facing.
export function relativeBearing(pose, target) {
  return normalizeAngle(bearingDeg(pose, target) - pose.heading);
}

export function clockHour(relDeg) {
  const h = Math.round(normalizeAngle(relDeg) / 30);
  return ((h % 12) + 12) % 12 || 12;
}

// Round to the nearest half metre, never below 0.5.
export function roundMeters(cm) {
  return Math.max(0.5, Math.round(cm / 50) / 2);
}

const T = {
  mk: {
    num: (m) => String(m).replace('.', ','),
    unit: (m) => (m === 1 ? 'метар' : 'метри'),
    turn: (h, m, u) => `Сврти кон ${h} часот, па оди ${m} ${u}.`,
    ahead: (m, u) => `Оди напред ${m} ${u}.`,
    start: (d, m, u) => `Рута до ${d}: ${m} ${u}.`,
    arrived: (d) => `Стигна: ${d}.`,
    obstacle: 'Нов предмет на патот. Застани. Ја менувам рутата.',
    noRoute: 'Нема безбеден пат. Застани.',
    goalBlocked: (d) => `${d} не е безбедно достапно за вашиот профил. Застани.`,
    locLost: 'Не сум сигурен каде си. Застани и не мрдај.',
    stopped: 'Застанато.',
    resumed: 'Продолжуваме.',
    notNavigating: 'Не се движиме. Кажи „оди до“ и место.',
    where: (name, h, m, u) => `Најблиску е ${name}, ${m} ${u} кон ${h} часот.`,
    unknown: 'Не разбрав.',
    needRelocalize: 'Прво потврди ја локацијата.',
  },
  en: {
    num: (m) => String(m),
    unit: (m) => (m === 1 ? 'meter' : 'meters'),
    turn: (h, m, u) => `Turn to ${h} o'clock, then walk ${m} ${u}.`,
    ahead: (m, u) => `Walk straight ${m} ${u}.`,
    start: (d, m, u) => `Route to ${d}: ${m} ${u}.`,
    arrived: (d) => `You have arrived: ${d}.`,
    obstacle: 'New object on your path. Stop. Rerouting.',
    noRoute: 'No safe route. Stop.',
    goalBlocked: (d) => `${d} is not safely reachable for your profile. Stop.`,
    locLost: "I'm not sure where you are. Stop and stand still.",
    stopped: 'Stopped.',
    resumed: 'Continuing.',
    notNavigating: 'Not navigating. Say "go to" and a place.',
    where: (name, h, m, u) => `Nearest is ${name}, ${m} ${u} at ${h} o'clock.`,
    unknown: "I didn't understand.",
    needRelocalize: 'Confirm your location first.',
  },
};

export function strings(lang) {
  return T[lang] ?? T.mk;
}

export function instruction(pose, target, lang = 'mk') {
  const t = strings(lang);
  const rel = relativeBearing(pose, target);
  const m = roundMeters(Math.hypot(target.x - pose.x, target.y - pose.y));
  const num = t.num(m);
  const unit = t.unit(m);
  if (Math.abs(rel) < TURN_MIN_DEG) return { text: t.ahead(num, unit), hour: 12, meters: m, rel };
  const hour = clockHour(rel);
  return { text: t.turn(hour, num, unit), hour, meters: m, rel };
}

// Two light pulses = path is to the left. One strong pulse = path is to the right.
// Pattern is in navigator.vibrate() format: [on, off, on, ...] milliseconds.
export const HAPTIC = {
  left: [40, 80, 40],
  right: [350],
  lost: [700, 150, 700],
};

export function hapticFor(relDeg, tol = HAPTIC_TOL_DEG) {
  if (relDeg < -tol) return { side: 'left', pattern: HAPTIC.left };
  if (relDeg > tol) return { side: 'right', pattern: HAPTIC.right };
  return { side: 'none', pattern: [] };
}
