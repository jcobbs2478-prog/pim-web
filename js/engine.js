// The sync merge rules, ported line for line from PIM's SyncEngine.cs (D:\AI\Projects\PIM\src\PIM\Services\Sync).
// A replica holds every task and list as fields, each with a stamp {v, t, d}: value, time (ms since 1970 UTC),
// device id. Merging keeps the newer stamp per field, so every device converges on the same data whatever order
// files arrive in. Records that disappear become tombstones via the "$del" field.
//
// The phone keeps tasks, lists, habits, check-ins and focus records as plain JSON objects with PIM's own field names (Id, Title, StartDate...),
// exactly as PIM serialises them, so untouched fields compare equal and are never re-stamped.

export const DEL = '$del';

// Which record kinds a replica's writer understands: 1 = lists and tasks, 2 = also habits, check-ins and focus
// records. A device must never delete what it cannot read, so records of a kind the writer did not know are
// ignored when its file is merged. Same rule as SyncEngine.Format in the C# PIM.
export const FORMAT = 2;
const KINDS = [[], ['list:', 'task:'], ['list:', 'task:', 'habit:', 'checkin:', 'focus:']];

/** True when a replica of `format` knows the kind of record `key`. A file without a Format field is format 1. */
export function knows(format, key) {
  const kinds = KINDS[Math.min(Math.max(format ?? 1, 0), KINDS.length - 1)];
  return kinds.some(k => key.startsWith(k));
}

/** Bring this device's own replica up to FORMAT: records the old version did not know are dropped (they come back from their authors' files). */
export function upgrade(r) {
  const f = r.Format ?? 1;
  if (f >= FORMAT) return false;
  for (const key of Object.keys(r.Records)) if (!knows(f, key)) delete r.Records[key];
  r.Format = FORMAT;
  return true;
}

export function newReplica(device, deviceName) {
  return { Format: FORMAT, Device: device, DeviceName: deviceName, WrittenUtc: new Date().toISOString(), MaxT: 0, Records: {} };
}

/** Records of the working data, keyed "list:<Id>", "task:<Id>", "habit:<Id>", "checkin:<Id>", "focus:<Id>". */
export function flatten(data) {
  const map = new Map();
  for (const l of data.lists) map.set('list:' + l.Id, l);
  for (const t of data.tasks) map.set('task:' + t.Id, t);
  for (const h of data.habits ?? []) map.set('habit:' + h.Id, h);
  for (const c of data.checkIns ?? []) map.set('checkin:' + c.Id, c);
  for (const f of data.focus ?? []) map.set('focus:' + f.Id, f);
  return map;
}

export function isDeleted(rec) {
  return !!rec && rec[DEL] !== undefined && rec[DEL].v === true;
}

/** Visible records as plain objects (deep copies), in key order like the C# version. */
export function materialize(r) {
  const lists = [], tasks = [], habits = [], checkIns = [], focus = [];
  for (const key of Object.keys(r.Records).sort(ordinal)) {
    const rec = r.Records[key];
    if (isDeleted(rec)) continue;
    const obj = {};
    for (const [name, fv] of Object.entries(rec)) if (name !== DEL) obj[name] = clone(fv.v);
    if (key.startsWith('list:')) lists.push(obj);
    else if (key.startsWith('task:')) tasks.push(obj);
    else if (key.startsWith('habit:')) habits.push(obj);
    else if (key.startsWith('checkin:')) checkIns.push(obj);
    else if (key.startsWith('focus:')) focus.push(obj);
  }
  return { lists, tasks, habits, checkIns, focus };
}

/**
 * Stamps every field of `data` that differs from the replica, adds new records and tombstones records that
 * are gone. Returns true if the replica changed. One stamp per call, like SyncEngine.StampLocal.
 */
export function stampLocal(r, data, clock) {
  const current = flatten(data);
  let stamp = null;
  const next = () => (stamp ??= clock.next());
  let changed = false;
  for (const [key, obj] of current) {
    const rec = (r.Records[key] ??= {});
    const alive = rec[DEL] !== undefined && rec[DEL].v === false;
    if (!alive) { set(rec, DEL, false, next()); changed = true; }
    for (const [name, value] of Object.entries(obj)) {
      if (rec[name] !== undefined && jsonEq(rec[name].v, value)) continue;
      set(rec, name, clone(value), next());
      changed = true;
    }
  }
  for (const [key, rec] of Object.entries(r.Records)) {
    if (current.has(key) || isDeleted(rec) || !knows(FORMAT, key)) continue;   // never delete a kind this version cannot show
    set(rec, DEL, true, next());
    changed = true;
  }
  if (stamp) r.MaxT = Math.max(r.MaxT, stamp.t);
  return changed;
}

function set(rec, name, v, s) { rec[name] = { v, t: s.t, d: s.d }; }

/** Folds `other` into `into`: newer stamp wins per field. Returns true if anything changed. */
export function merge(into, other) {
  let changed = false;
  for (const [key, orec] of Object.entries(other.Records || {})) {
    if (!knows(other.Format, key)) continue;   // its writer did not know this kind, so cannot have changed it
    const rec = into.Records[key];
    if (!rec) { into.Records[key] = clone(orec); changed = true; continue; }
    for (const [name, ofv] of Object.entries(orec)) {
      const fv = rec[name];
      if (fv !== undefined && compareStamp(fv, ofv) >= 0) continue;
      rec[name] = clone(ofv);
      changed = true;
    }
  }
  into.MaxT = Math.max(into.MaxT, other.MaxT || 0);
  return changed;
}

/** Later time wins; the device id breaks an exact tie (ordinal comparison, as in C#). */
export function compareStamp(a, b) {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  return ordinal(a.d, b.d);
}

export function ordinal(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** Structural equality: numbers by value, strings by text, objects by keys, arrays by position. */
export function jsonEq(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEq(x, b[i]));
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object' || Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && jsonEq(a[k], b[k]));
  }
  return a === b;
}

/** Order-independent text of a replica, for tests. */
export function fingerprint(r) {
  return Object.keys(r.Records).sort(ordinal).map(k =>
    k + '{' + Object.keys(r.Records[k]).sort(ordinal).map(n => {
      const fv = r.Records[k][n];
      return `${n}=${JSON.stringify(canon(fv.v))}@${fv.t}${fv.d};`;
    }).join('') + '}').join('');
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort(ordinal).map(k => [k, canon(v[k])]));
  return v;
}

export function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/** Hybrid clock: wall-clock ms, never behind anything seen, never repeating. Same rule as SyncClock.cs. */
export class SyncClock {
  constructor(device, now = () => Date.now()) { this.device = device; this.now = now; this.last = 0; }
  next() { this.last = Math.max(this.now(), this.last + 1); return { t: this.last, d: this.device }; }
  observe(t) { this.last = Math.max(this.last, t || 0); }
}
