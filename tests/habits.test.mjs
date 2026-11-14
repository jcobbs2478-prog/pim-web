// Habits on the phone and the format rule that keeps older devices from deleting them.
// Usage: node tests/habits.test.mjs [replica-written-by-PIM-with-habits.json]
import { readFileSync } from 'node:fs';
import { newReplica, materialize, stampLocal, merge, fingerprint, SyncClock, clone, isDeleted, upgrade, FORMAT } from '../js/engine.js';
import * as H from '../js/habits.js';
import * as D from '../js/dates.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log('FAIL', name, detail); } };
const empty = () => ({ lists: [], tasks: [], habits: [], checkIns: [], focus: [] });

// ---- format rule ----------------------------------------------------------------------------------
let now = 1_800_000_000_000;
class Dev {
  constructor(id, data, format = FORMAT) { this.r = newReplica(id, id); this.r.Format = format; this.c = new SyncClock(id, () => now); this.data = data; }
  sync() { return stampLocal(this.r, this.data, this.c); }
  pull(o) { this.sync(); const ch = merge(this.r, o.r); this.c.observe(this.r.MaxT); this.data = materialize(this.r); return ch; }
}
const A = new Dev('A', empty());
A.data.habits.push({ Id: 'h1', Name: 'Read', Goal: 10, Unit: 'Pages', CheckMode: 'manual', StartDate: '2026-11-01T00:00:00-06:00' });
H.set(A.data, A.data.habits[0], new Date(2026, 10, 13), 4);
A.data.focus.push({ Id: 'f1', Start: '2026-11-13T09:00:00-06:00', Minutes: 25, Pomo: true });
A.sync();
const B = new Dev('B', empty()); B.pull(A);
check('habits, check-ins and focus records sync', B.data.habits.length === 1 && B.data.checkIns[0]?.Value === 4 && B.data.focus.length === 1);

const Old = new Dev('O', empty(), 1);       // a device still on format 1
Old.pull(A); Old.data.habits = []; Old.data.checkIns = []; Old.data.focus = [];
now += 1000; Old.sync();
check('format-1 device tombstoned them in its own file', isDeleted(Old.r.Records['habit:h1']));
B.pull(Old);
check('its tombstones are ignored', B.data.habits.length === 1 && B.data.checkIns.length === 1 && B.data.focus.length === 1);
check('upgrade drops what format 1 did not know', upgrade(Old.r) && !Old.r.Records['habit:h1'] && Old.r.Format === FORMAT);
Old.pull(A);
check('upgraded device gets the habit back', Old.data.habits.length === 1);
A.r.Records['future:x'] = { $del: { v: false, t: 1, d: 'Z' } };
now += 1000; A.sync();
check('unknown kinds are never tombstoned', !isDeleted(A.r.Records['future:x']));
delete A.r.Records['future:x'];
merge(B.r, { Records: { 'habit:h1': { $del: { v: true, t: now + 9e9, d: 'Q' } } }, MaxT: 0 });   // no Format field at all
check('a file without a Format field counts as format 1', !isDeleted(B.r.Records['habit:h1']));

// ---- habit rules (Monday 2026-10-26, as in the C# tests) ------------------------------------------
const mon = new Date(2026, 9, 26);
const day = n => D.addDays(mon, n);
const data = empty();
const mwf = { Id: 'mwf', Days: 0b0101010, StartDate: D.format(day(-14)) };
const every3 = { Id: 'e3', Frequency: 'interval', IntervalDays: 3, StartDate: D.format(day(-6)) };
const wk = { Id: 'wk', Frequency: 'weekly', TimesPerWeek: 2, StartDate: D.format(day(-21)) };
data.habits.push(mwf, every3, wk);
check('days: Monday yes, Tuesday no', H.isScheduled(mwf, mon) && !H.isScheduled(mwf, day(1)));
check('not before the start', !H.isScheduled(mwf, day(-15)));
check('interval every 3 days', H.isScheduled(every3, day(-6)) && H.isScheduled(every3, mon) && !H.isScheduled(every3, day(1)));
check('describe', H.describe(mwf) === 'Mon, Wed, Fri' && H.describe({ Days: 127 }) === 'Every day' && H.describe(wk) === '2 days a week');
for (const n of [-5, -3, 0]) H.set(data, mwf, day(n), 1);
check('streak skips days it does not apply', H.streak(data, mwf, mon) === 3, String(H.streak(data, mwf, mon)));
check('streak: Wednesday still open keeps it', H.streak(data, mwf, day(2)) === 3);
check('streak: a missed Wednesday breaks it', H.streak(data, mwf, day(3)) === 0);
for (const n of [-6, -4, -1]) H.set(data, wk, day(n), 1);
check('weekly: due until the target is met', H.isDue(data, wk, mon, 0));
H.set(data, wk, mon, 1);
check('weekly: not due once met', !H.isDue(data, wk, day(1), 0));

const pages = { Id: 'p', Goal: 10, Unit: 'Pages', CheckMode: 'manual' };
const glasses = { Id: 'g', Goal: 3, Unit: 'Glasses', CheckMode: 'auto', Step: 1 };
const yes = { Id: 'y', Goal: 1, Unit: 'Count', CheckMode: 'all' };
check('manual: no amount, no change', !H.tap(data, pages, mon, undefined) && H.value(data, pages, mon) === 0);
H.tap(data, pages, mon, 4);
check('manual: amounts add up and complete', H.tap(data, pages, mon, 7) && H.value(data, pages, mon) === 11 && H.progress(data, pages, mon) === '11/10 Pages');
H.tap(data, glasses, mon); H.tap(data, glasses, mon);
check('auto: each tap adds the step', H.value(data, glasses, mon) === 2 && H.tap(data, glasses, mon));
check('tapping a completed day resets it', !H.tap(data, glasses, mon) && !H.checkIn(data, glasses, mon));
check('yes/no: one tap completes', H.tap(data, yes, mon) && H.achieved(data, yes, mon) && !H.isAmount(yes));
check('check-in id matches PIM', H.checkInId(yes, mon) === 'y:20261026');

// ---- against a replica written by the C# PIM that contains habits ---------------------------------
const real = process.argv[2];
if (real) {
  const csharp = JSON.parse(readFileSync(real, 'utf8').replace(/^﻿/, ''));
  const phone = newReplica('webhab1', 'Test');
  merge(phone, csharp);
  const d = materialize(phone);
  const clock = new SyncClock('webhab1'); clock.observe(phone.MaxT);
  check('real: habits read from PIM', d.habits.length > 0 && d.checkIns.length > 0, `${d.habits.length} habits, ${d.checkIns.length} check-ins`);
  check('real: no phantom edits after loading habits', !stampLocal(phone, d, clock));
  const h = d.habits.find(x => !x.Archived);
  const today = D.today();
  const before = H.value(d, h, today);
  H.set(d, h, today, before + 1, 'from the phone test');
  check('real: a check-in is stamped as one new or changed record', stampLocal(phone, d, clock));
  const key = 'checkin:' + H.checkInId(h, today);
  check('real: check-in record uses PIM field names', ['Id', 'HabitId', 'Date', 'Value', 'Note', 'Modified'].every(f => phone.Records[key][f] !== undefined));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail);
