// Cross-check with the C# PIM: the phone joins from a replica PIM wrote, edits one task and adds one, then writes
// its device file the way the page does (devices\<name>-<id>\v<time>.json). The C# side then reads that folder.
// Usage: node tests/compat_write.mjs <replica written by PIM> <sync folder to create>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../js/store.js';
import * as E from '../js/engine.js';

const [src, out] = process.argv.slice(2);
const s = new Store({ demo: true });          // demo = no local storage and no network
s.device = { id: 'c0ffee01', name: 'iPhone' };
s.replica = E.newReplica(s.device.id, s.device.name);
s.clock = new E.SyncClock(s.device.id);
E.merge(s.replica, JSON.parse(readFileSync(src, 'utf8').replace(/^﻿/, '')));
s.clock.observe(s.replica.MaxT);
s.data = E.materialize(s.replica);
if (E.stampLocal(s.replica, s.data, s.clock)) throw new Error('phantom edits on join');

const edited = s.data.tasks.find(t => !t.Completed && !t.Deleted);
s.update(edited, { Title: edited.Title + ' [from phone]' });
const added = s.addTask('Added on the phone', { start: new Date() });
clearTimeout(s.timer);
if (!E.stampLocal(s.replica, s.data, s.clock)) throw new Error('edits not stamped');

const dir = join(out, 'devices', s.base);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'v20261113000000000.json'), JSON.stringify({ ...s.replica, Device: s.device.id, DeviceName: s.device.name }));
console.log(JSON.stringify({ editedId: edited.Id, editedTitle: edited.Title, addedId: added.Id, phoneDevice: s.device.id }));
