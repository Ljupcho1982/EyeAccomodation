// Command grammar for Macedonian and English. Pure text -> intent, so it works
// with any recognizer (on-device or typed). No network involved here.

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[.,!?„“"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = ['стоп', 'застани', 'пауза', 'stop', 'halt', 'pause'];
const REPEAT = ['повтори', 'уште еднаш', 'repeat', 'say again'];
const WHERE = ['каде сум', 'каде се наоѓам', 'where am i'];
const RESUME = ['продолжи', 'продолжуваме', 'continue', 'resume'];
const REMEMBER = ['запомни тука', 'запамти тука', 'запомни ова место', 'remember here', 'save here'];
const CONFIRM = ['потврди локација', 'потврди ја локацијата', 'confirm location'];
const GO = ['оди до', 'оди кон', 'одиме до', 'води ме до', 'одам до', 'go to', 'take me to', 'navigate to'];

const has = (t, list) => list.some((w) => t === w || t.startsWith(w + ' ') || t.includes(' ' + w + ' ') || t.endsWith(' ' + w));

// destinations: [{ id, names: { mk: [...], en: [...] } }]
export function parseCommand(text, destinations = []) {
  const t = norm(text || '');
  if (!t) return { type: 'unknown' };
  for (const r of REMEMBER) {
    if (t.startsWith(r + ' ')) return { type: 'remember', name: t.slice(r.length).trim() };
  }
  if (CONFIRM.some((c) => t.includes(c))) return { type: 'confirm' };
  if (has(t, STOP)) return { type: 'stop' };
  if (has(t, WHERE)) return { type: 'where' };
  if (has(t, REPEAT)) return { type: 'repeat' };
  if (has(t, RESUME)) return { type: 'resume' };
  if (GO.some((g) => t.includes(g))) {
    for (const d of destinations) {
      const aliases = [...(d.names.mk ?? []), ...(d.names.en ?? [])].map(norm);
      if (aliases.some((a) => t.includes(a))) return { type: 'go', dest: d.id };
    }
    return { type: 'go', dest: null };
  }
  return { type: 'unknown' };
}
