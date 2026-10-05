import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoRoom, DESTINATIONS, START_POSE } from '../src/demo-room.js';
import { makeProfile, deriveSettings, visionClass } from '../src/profile.js';
import { analyze, plan } from '../src/planner.js';
import { clockHour, instruction, hapticFor, HAPTIC } from '../src/guidance.js';
import { parseCommand } from '../src/voice.js';
import { Navigator } from '../src/session.js';
import { encrypt, decrypt, save, load } from '../src/store.js';

const settingsFor = (input) => deriveSettings(makeProfile(input).profile);
const dest = (id) => DESTINATIONS.find((d) => d.id === id).pos;
const crossesWallAt = (wps, yLo, yHi) => {
  // find the waypoint pair that crosses x = 300 and return the y where it does
  let prev = START_POSE;
  for (const w of wps) {
    if ((prev.x - 300) * (w.x - 300) < 0) {
      const t = (300 - prev.x) / (w.x - prev.x);
      const y = prev.y + t * (w.y - prev.y);
      return y >= yLo && y <= yHi;
    }
    prev = w;
  }
  return false;
};

test('clock positions', () => {
  assert.equal(clockHour(0), 12);
  assert.equal(clockHour(90), 3);
  assert.equal(clockHour(-90), 9);
  assert.equal(clockHour(180), 6);
});

test('instruction speaks metres and clock position (mk)', () => {
  const ins = instruction({ x: 0, y: 0, heading: 0 }, { x: 200, y: 0 }, 'mk');
  assert.equal(ins.text, 'Сврти кон 3 часот, па оди 2 метри.');
  assert.equal(instruction({ x: 0, y: 0, heading: 0 }, { x: 0, y: -150 }, 'mk').text, 'Оди напред 1,5 метри.');
});

test('haptics: 2 light = left, 1 strong = right', () => {
  assert.deepEqual(hapticFor(-30).pattern, HAPTIC.left);
  assert.equal(HAPTIC.left.filter((_, i) => i % 2 === 0).length, 2);
  assert.ok(Math.max(...HAPTIC.left) < 100);
  assert.deepEqual(hapticFor(30).pattern, HAPTIC.right);
  assert.equal(HAPTIC.right.length, 1);
  assert.deepEqual(hapticFor(3).pattern, []);
});

test('vision class and preset safety', () => {
  assert.equal(visionClass({ acuity: 0.02, fieldLoss: 'none', lightPerception: 'normal' }), 'none');
  assert.equal(visionClass({ acuity: 0.2, fieldLoss: 'none', lightPerception: 'normal' }), 'low');
  assert.equal(visionClass({ acuity: 0.8, fieldLoss: 'tunnel', lightPerception: 'normal' }), 'low');
  // Declared blind but acuity typed as 0.9: the safer (more restrictive) class wins.
  const { profile, warnings } = makeProfile({ preset: 'blind', acuity: 0.9, lightPerception: 'normal' });
  assert.equal(profile.effectiveClass, 'none');
  assert.ok(warnings.some((w) => w.code === 'preset_conflict'));
  assert.ok(warnings.some((w) => w.code === 'unverified'));
  assert.equal(deriveSettings(profile).screen, false);
});

test('wheelchair avoids the 60 cm passage and the threshold; walker may use 60 cm', () => {
  const grid = buildDemoRoom();
  const wheel = settingsFor({ preset: 'wheelchair', widthCm: 65, maxThresholdCm: 2 });
  const walker = settingsFor({ preset: 'lowvision' });
  const blind = settingsFor({ preset: 'blind' });

  const w = plan(grid, wheel, START_POSE, dest('kitchen'));
  assert.ok(w.ok);
  assert.ok(crossesWallAt(w.waypoints, 205, 295), 'wheelchair must use the 100 cm opening');

  const l = plan(grid, walker, START_POSE, dest('kitchen'));
  assert.ok(l.ok);
  assert.ok(crossesWallAt(l.waypoints, 100, 160), 'low-vision walker takes the shorter 60 cm gap');
  assert.ok(l.lengthCm < w.lengthCm);

  const b = plan(grid, blind, START_POSE, dest('kitchen'));
  assert.ok(b.ok);
  assert.ok(crossesWallAt(b.waypoints, 205, 295), 'blind profile keeps a wider berth than 60 cm');
});

test('threshold limit is per profile', () => {
  const grid = buildDemoRoom();
  const strict = settingsFor({ preset: 'wheelchair', maxThresholdCm: 2 });
  const tolerant = settingsFor({ preset: 'wheelchair', maxThresholdCm: 5 });
  const door = (s) => analyze(grid, s).passable[grid.idx(60, 75)]; // inside door B (x=300,y=375)
  assert.equal(door(strict), 0);
  assert.equal(door(tolerant), 1);
});

test('goal that the profile cannot reach is reported, not forced', () => {
  const grid = buildDemoRoom();
  grid.setRect(200, 100, 400, 500, 0); // keep map valid
  const wheel = settingsFor({ preset: 'wheelchair', widthCm: 120 });
  const r = plan(grid, wheel, START_POSE, dest('kitchen'));
  assert.equal(r.ok, false);
});

function navigator(profile) {
  const grid = buildDemoRoom();
  return { grid, nav: new Navigator({ grid, destinations: DESTINATIONS, settings: settingsFor(profile) }) };
}
const said = (ev) => ev.filter((e) => e.type === 'say').map((e) => e.text);

test('new obstacle on the path triggers warning and replan', () => {
  const { nav } = navigator({ preset: 'lowvision' });
  const pose = { ...START_POSE };
  nav.goTo('kitchen', pose, 0);
  assert.equal(nav.state, 'navigating');
  const before = nav.waypoints.map((w) => ({ ...w }));
  // Drop a box into the 60 cm gap A: the original route is blocked.
  const ev = nav.addObstacle({ x0: 285, y0: 100, x1: 315, y1: 160, height: 40 }, pose, 1000);
  assert.ok(said(ev).includes('Нов предмет на патот. Застани. Ја менувам рутата.'));
  assert.equal(nav.state, 'navigating');
  assert.notDeepEqual(nav.waypoints, before);
});

test('obstacle off the path does not interrupt', () => {
  const { nav } = navigator({ preset: 'lowvision' });
  nav.goTo('kitchen', { ...START_POSE }, 0);
  const ev = nav.addObstacle({ x0: 20, y0: 20, x1: 40, y1: 40, height: 40 }, { ...START_POSE }, 10);
  assert.deepEqual(ev, []);
});

test('no safe route -> stops and says so', () => {
  const { nav } = navigator({ preset: 'wheelchair' });
  const pose = { ...START_POSE };
  nav.goTo('kitchen', pose, 0);
  nav.addObstacle({ x0: 285, y0: 200, x1: 315, y1: 300, height: 40 }, pose, 5); // close C
  assert.equal(nav.state, 'stopped');
  assert.equal(nav.reason, 'no_route');
});

test('localization lost -> navigation halts, stays halted until relocalized', () => {
  const { nav } = navigator({ preset: 'lowvision' });
  const pose = { ...START_POSE };
  nav.goTo('kitchen', pose, 0);
  const ev = nav.update(pose, { localization: 0.3, now: 500 });
  assert.equal(nav.state, 'stopped');
  assert.equal(nav.reason, 'localization_lost');
  assert.ok(said(ev)[0].includes('Не сум сигурен'));
  assert.ok(ev.some((e) => e.type === 'haptic'));
  // No guidance while stopped, even with good confidence again.
  assert.deepEqual(nav.update(pose, { localization: 1, now: 900 }), []);
  assert.deepEqual(said(nav.resume(pose, 1000)), ['Прво потврди ја локацијата.']);
  nav.relocalize(pose);
  nav.resume(pose, 1100);
  assert.equal(nav.state, 'navigating');
});

test('walking the route end to end arrives', () => {
  const { nav } = navigator({ preset: 'lowvision' });
  const pose = { ...START_POSE };
  nav.goTo('kitchen', pose, 0);
  let now = 0;
  for (let i = 0; i < 2000 && nav.state === 'navigating'; i++) {
    now += 200;
    const wp = nav.waypoints[0];
    const rel = Math.atan2(wp.x - pose.x, -(wp.y - pose.y)) * 180 / Math.PI;
    pose.heading = rel;
    pose.x += Math.sin((rel * Math.PI) / 180) * 20;
    pose.y -= Math.cos((rel * Math.PI) / 180) * 20;
    nav.update(pose, { localization: 1, now });
  }
  assert.equal(nav.state, 'arrived');
});

test('voice commands, macedonian and english', () => {
  const p = (t) => parseCommand(t, DESTINATIONS);
  assert.deepEqual(p('Оди до кујната'.replace('кујната', 'кујна')), { type: 'go', dest: 'kitchen' });
  assert.deepEqual(p('одиме до кревет'), { type: 'go', dest: 'bed' });
  assert.deepEqual(p('take me to the kitchen'), { type: 'go', dest: 'kitchen' });
  assert.deepEqual(p('Стоп!'), { type: 'stop' });
  assert.deepEqual(p('застани'), { type: 'stop' });
  assert.deepEqual(p('каде сум'), { type: 'where' });
  assert.deepEqual(p('повтори'), { type: 'repeat' });
  assert.deepEqual(p('go to mars'), { type: 'go', dest: null });
  assert.deepEqual(p('abc'), { type: 'unknown' });
});

test('encrypted storage round-trips and rejects a wrong passphrase', async () => {
  const data = { map: [1, 2, 3], profile: { a: 1 } };
  const blob = await encrypt(data, 'tajna', 1000);
  assert.ok(!JSON.stringify(blob).includes('"map"'));
  assert.deepEqual(await decrypt(blob, 'tajna'), data);
  await assert.rejects(decrypt(blob, 'pogresna'), /wrong_passphrase/);
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(await load(storage, 'x'), null);
  await save(storage, data, 'tajna', 1000);
  assert.deepEqual(await load(storage, 'tajna'), data);
});
