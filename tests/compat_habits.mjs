// Cross-check with the C# PIM for habits: join from a replica PIM wrote, check a habit in for today with a note,
// and write the phone's device file into a test sync folder. PIM, started on that folder, must show the check-in.
// Usage: node tests/compat_habits.mjs <replica written by PIM> <test sync folder>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../js/store.js';
import * as E from '../js/engine.js';
import * as H from '../js/habits.js';
import * as D from '../js/dates.js';

const [src, out] = process.argv.slice(2);
const s = new Store({ demo: true });          // demo = no local storage and no network
s.device = { id: 'c0ffee02', name: 'iPhone' };
s.replica = E.newReplica(s.device.id, s.device.name);
s.clock = new E.SyncClock(s.device.id);
E.merge(s.replica, JSON.parse(readFileSync(src, 'utf8').replace(/^﻿/, '')));
s.clock.observe(s.replica.MaxT);
s.data = E.materialize(s.replica);
if (E.stampLocal(s.replica, s.data, s.clock)) throw new Error('phantom edits on join');

const h = s.data.habits.find(x => x.Name === 'Exercise') ?? s.data.habits[0];
const today = D.today();
if (H.achieved(s.data, h, today)) H.tap(s.data, h, today);       // start from not done
H.tap(s.data, h, today);
H.set(s.data, h, today, H.value(s.data, h, today), 'Checked in on the phone');
clearTimeout(s.timer);
if (!E.stampLocal(s.replica, s.data, s.clock)) throw new Error('check-in not stamped');

const dir = join(out, 'devices', s.base);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'v20261113000000000.json'), JSON.stringify({ ...s.replica, Device: s.device.id, DeviceName: s.device.name }));
console.log(JSON.stringify({ habit: h.Name, checkInId: H.checkInId(h, today), value: H.value(s.data, h, today), format: s.replica.Format }));
