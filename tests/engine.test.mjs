// Checks the JavaScript merge rules against PIM's C# behaviour.
// Usage: node tests/engine.test.mjs [path-to-a-replica-written-by-PIM]
// With a real replica it also proves that reading PIM's file produces no phantom edits.
import { readFileSync } from 'node:fs';
import { newReplica, materialize, stampLocal, merge, fingerprint, SyncClock, clone, isDeleted, problem } from '../js/engine.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log('FAIL', name, detail); } };

// ---- against a real replica written by the C# PIM -----------------------------------------------
const real = process.argv[2];
if (real) {
  const csharp = JSON.parse(readFileSync(real, 'utf8').replace(/^﻿/, ''));
  const phone = newReplica('webtest1', 'Test');
  check('real: PIM file passes the soundness check', problem(csharp) === null, String(problem(csharp)));
  check('real: merge copies every record', merge(phone, csharp) && Object.keys(phone.Records).length === Object.keys(csharp.Records).length);
  const data = materialize(phone);
  const clock = new SyncClock('webtest1'); clock.observe(phone.MaxT);
  check('real: no phantom edits after loading PIM data', !stampLocal(phone, data, clock));
  check('real: fingerprints identical after merge', fingerprint(phone) === fingerprint(csharp));
  const t = data.tasks.find(x => !x.Completed);
  t.Title = t.Title + ' (edited on phone)';
  const before = clone(phone);
  check('real: an edit is stamped', stampLocal(phone, data, clock));
  const changedFields = Object.keys(phone.Records['task:' + t.Id]).filter(f => phone.Records['task:' + t.Id][f].t !== before.Records['task:' + t.Id][f].t);
  check('real: only the edited field is stamped', changedFields.length === 1 && changedFields[0] === 'Title', changedFields.join(','));
  check('real: stamp is newer than anything PIM wrote', phone.Records['task:' + t.Id].Title.t > csharp.MaxT);
}

// ---- convergence, mirroring the C# tests ----------------------------------------------------------
let now = 1_800_000_000_000;
class Dev {
  constructor(id, data, skew = 0) { this.r = newReplica(id, id); this.c = new SyncClock(id, () => now + skew); this.data = data; }
  sync() { return stampLocal(this.r, this.data, this.c); }
  pull(o) { this.sync(); const ch = merge(this.r, o.r); this.c.observe(this.r.MaxT); this.data = materialize(this.r); return ch; }
  task(id) { return this.data.tasks.find(t => t.Id === id); }
  copy() { const d = new Dev(this.c.device, clone(this.data)); d.r = clone(this.r); d.c = this.c; return d; }
}
const seed = { lists: [{ Id: 'inbox', Name: 'Inbox', IsInbox: true }], tasks: [
  { Id: 't1', ListId: 'inbox', Title: 'Write report', Priority: 1, DueDate: null, Deleted: false },
  { Id: 't2', ListId: 'inbox', Title: 'Buy milk', Notes: '', Deleted: false }] };
const A = new Dev('A', clone(seed)); A.sync(); now += 1000;
const B = new Dev('B', { lists: [], tasks: [] }); B.pull(A);
const C = new Dev('C', { lists: [], tasks: [] }); C.pull(A);
check('join copies everything', B.data.tasks.length === 2);
now += 1000; A.task('t1').Title = 'Write Q4 report'; A.sync();
now += 1000; B.task('t1').DueDate = '2026-12-01T00:00:00-06:00'; B.sync();
const a1 = A.copy(), b1 = B.copy();
A.pull(B); B.pull(A);
check('different fields both survive', A.task('t1').Title === 'Write Q4 report' && A.task('t1').DueDate === '2026-12-01T00:00:00-06:00');
check('A and B converge', fingerprint(A.r) === fingerprint(B.r));
b1.pull(a1); a1.pull(b1);
check('order does not matter', fingerprint(a1.r) === fingerprint(A.r));
now += 1000; A.task('t2').Title = 'Buy oat milk'; A.sync();
now += 1000; B.task('t2').Title = 'Buy almond milk'; B.sync();
A.pull(B); B.pull(A);
check('same field: later edit wins', A.task('t2').Title === 'Buy almond milk' && B.task('t2').Title === 'Buy almond milk');
check('idempotent', !A.pull(B));
now += 1000; A.data.tasks = A.data.tasks.filter(t => t.Id !== 't2'); A.sync();
now += 1000; B.task('t2').Notes = '2 litres'; B.sync();
A.pull(B); B.pull(A);
check('delete beats unseen edit', !A.task('t2') && !B.task('t2') && isDeleted(A.r.Records['task:t2']));
now += 1000; C.task('t1').Priority = 5; C.sync();
const prints = new Set();
for (const order of ['ABC', 'CBA', 'BCA']) {
  const d = { A: A.copy(), B: B.copy(), C: C.copy() };
  for (let round = 0; round < 2; round++) for (const x of order) for (const y of order) if (x !== y) d[x].pull(d[y]);
  for (const k of 'ABC') prints.add(fingerprint(d[k].r));
}
check('3 devices converge in any order', prints.size === 1);
const D = new Dev('D', { lists: [], tasks: [] }, -600_000); D.pull(A);
now += 1000; A.task('t1').Title = 'From A'; A.sync(); D.pull(A);
now += 1000; D.task('t1').Title = 'From slow D'; D.sync(); A.pull(D);
check('slow clock still wins after seeing', A.task('t1').Title === 'From slow D');

// ---- malformed files from OneDrive are refused, not merged ------------------------------------------
const okRec = { Title: { v: 'x', t: 5, d: 'A' } };
check('problem: sound replica', problem({ Format: 2, Records: { 'task:1': okRec } }) === null);
check('problem: no Format is format 1', problem({ Records: {} }) === null);
check('problem: null', problem(null) === 'empty file');
check('problem: an array', problem([]) === 'empty file');
check('problem: no Records', problem({ Format: 2 }) === 'no records');
check('problem: Records null', problem({ Records: null }) === 'no records');
check('problem: null record', problem({ Records: { 'task:1': null } }) !== null);
check('problem: null field', problem({ Records: { 'task:1': { Title: null } } }) !== null);
check('problem: field without a stamp', problem({ Records: { 'task:1': { Title: { v: 'x' } } } }) !== null);
check('problem: newer format', problem({ Format: 3, Records: {} }) === 'unsupported format');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail);
