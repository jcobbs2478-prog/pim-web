// The phone or iPad as a sync device, working exactly like PIM's SyncService on the PCs:
//   1. read every other device's newest file from OneDrive\Apps\PIM Sync\devices (network, may take a moment)
//   2. then, in one go with no waiting: stamp local edits, merge the others, rebuild the task list
//   3. upload this device's own edits as a NEW file devices\<name>-<id>\v<time>.json and keep the newest two
// Step 2 never awaits, so an edit made while step 1 is downloading can never be lost or mistaken.
import * as E from './engine.js';
import * as G from './graph.js';
import * as D from './dates.js';
import * as H from './habits.js';

const KEY = 'pim.state';          // { device, replica, data, others, pending } kept together so they never disagree
const emptyData = () => ({ lists: [], tasks: [], habits: [], checkIns: [], focus: [] });
const SORT_STEP = 2 ** 32;
const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  return 'Web';
}

/**
 * The state kept on this device. If it cannot be read (damaged or half-written), it is set aside under another
 * key rather than thrown away, and the page starts clean: it would otherwise stay blank on every launch.
 */
function loadSaved() {
  let text = null;
  try {
    text = localStorage.getItem(KEY);
    const saved = JSON.parse(text || 'null');
    if (saved !== null && (typeof saved !== 'object' || Array.isArray(saved))) throw new Error('not an object');
    return saved;
  } catch {
    try { localStorage.setItem(KEY + '.unreadable', text ?? ''); localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
    return null;
  }
}

export class Store extends EventTarget {
  constructor({ demo = false } = {}) {
    super();
    this.demo = demo;
    const saved = demo ? null : loadSaved();
    this.device = saved?.device ?? { id: newId().slice(0, 8), name: deviceName() };
    this.replica = saved?.replica ?? E.newReplica(this.device.id, this.device.name);
    this.data = { ...emptyData(), ...(saved?.data ?? {}) };
    this.others = saved?.others ?? {};      // device folder or file -> { etag, replica }
    this.pending = saved?.pending ?? false;
    // A replica saved by the previous version: drop records it did not know (habits it may have marked deleted by
    // mistake); the next sync brings the real ones back from the PCs' files, and this device republishes.
    if (E.upgrade(this.replica)) this.pending = true;
    this.clock = new E.SyncClock(this.device.id);
    this.clock.observe(this.replica.MaxT);
    this.version = 0;
    this.status = { state: 'idle', text: '' };
    this.running = false;
    this.again = false;
    this.timer = null;
    this.skipped = {};                      // device folder or file -> why its newest file was not merged
  }

  get base() { return `${this.device.name.replace(/[^A-Za-z0-9_-]/g, '_')}-${this.device.id}`; }

  persist() {
    if (this.demo) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ device: this.device, replica: this.replica, data: this.data, others: this.others, pending: this.pending }));
    } catch (e) {
      // Storage full or blocked (private browsing). The edit is still in memory and syncs; only the offline copy is behind.
      this.setStatus('problem', `Could not keep a copy on this device: ${e.name}`);
    }
  }

  emit(kind) { this.dispatchEvent(new Event(kind)); }
  setStatus(state, text) { this.status = { state, text }; this.emit('status'); }

  /** Call after any edit: saves now, syncs shortly after (several quick edits become one upload). */
  changed() {
    this.persist();
    this.emit('data');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 800);
  }

  // ---- sync ----------------------------------------------------------------------------------------

  async sync() {
    if (this.demo) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.setStatus('syncing', 'Syncing...');
    try {
      const fetched = await this.fetchOthers();                       // 1. network
      for (const [k, v] of Object.entries(fetched)) this.others[k] = v; // 2. no awaits from here...
      const local = E.stampLocal(this.replica, this.data, this.clock);
      if (local) { this.pending = true; this.version++; }
      let incoming = false;
      for (const o of Object.values(this.others)) incoming = E.merge(this.replica, o.replica) || incoming;
      this.clock.observe(this.replica.MaxT);
      if (incoming) this.data = E.materialize(this.replica);
      this.persist();                                                   // ...to here
      if (incoming) this.emit('data');
      if (this.pending) await this.publish();                          // 3. upload own edits
      const n = Object.keys(this.others).length, bad = Object.keys(this.skipped).length;
      this.setStatus('synced', `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${n} other device${n === 1 ? '' : 's'}${bad ? ` (${bad} unreadable file${bad === 1 ? '' : 's'} skipped)` : ''}`);
    } catch (e) {
      if (e instanceof G.SignInNeeded) this.setStatus('signin', 'Sign in to sync');
      else this.setStatus(navigator.onLine ? 'problem' : 'offline', navigator.onLine ? `Sync problem: ${e.message}` : 'Offline - changes are kept and sync later');
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.sync(); }
    }
  }

  /** Newest file of every other device whose content changed since last time (by eTag). */
  async fetchOthers() {
    const out = {};
    for (const item of await G.children('devices')) {
      let key = null, file = null;
      if (item.folder && item.name !== this.base) {
        const versions = (await G.children(`devices/${item.name}`)).filter(v => v.file && /^v\d+\.json$/.test(v.name)).sort((a, b) => E.ordinal(b.name, a.name));
        key = item.name; file = versions[0];
      } else if (item.file && item.name.endsWith('.json') && item.name !== `${this.base}.json`) {
        key = item.name; file = item;
      }
      if (!file || this.others[key]?.etag === file.eTag) continue;
      try {
        const replica = JSON.parse(await G.download(file.downloadUrl));
        const why = E.problem(replica);
        if (why) { this.skipped[key] = why; continue; }                 // a bad file is skipped and reported, never merged
        delete this.skipped[key];
        out[key] = { etag: file.eTag, replica };
      } catch { /* half-arrived or just deleted: next pass picks up the next version */ }
    }
    return out;
  }

  async publish() {
    const ver = this.version;
    const snapshot = JSON.stringify({ ...this.replica, Device: this.device.id, DeviceName: this.device.name, WrittenUtc: new Date().toISOString() });
    const n = new Date(), p = (x, l = 2) => String(x).padStart(l, '0');
    const name = `v${n.getUTCFullYear()}${p(n.getUTCMonth() + 1)}${p(n.getUTCDate())}${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}${p(n.getUTCMilliseconds(), 3)}.json`;
    const folder = `devices/${this.base}`;
    await G.put(`${folder}/${name}`, snapshot);
    const old = (await G.children(folder)).map(i => i.name).filter(x => /^v\d+\.json$/.test(x)).sort((a, b) => E.ordinal(b, a)).slice(2);
    for (const x of old) await G.remove(`${folder}/${x}`);
    if (this.version === ver) { this.pending = false; this.persist(); }
  }

  // ---- queries -------------------------------------------------------------------------------------

  get lists() { return [...this.data.lists].sort((a, b) => (b.IsInbox - a.IsInbox) || (a.SortOrder - b.SortOrder)); }
  get inbox() { return this.data.lists.find(l => l.IsInbox) ?? { Id: 'inbox', Name: 'Inbox' }; }
  list(id) { return this.data.lists.find(l => l.Id === id); }
  task(id) { return this.data.tasks.find(t => t.Id === id); }
  get live() { return this.data.tasks.filter(t => !t.Deleted); }
  get open() { return this.live.filter(t => !t.Completed); }

  // ---- commands ------------------------------------------------------------------------------------

  addTask(title, { listId, start } = {}) {
    const ListId = listId && this.list(listId) ? listId : this.inbox.Id;
    const order = Math.max(0, ...this.data.tasks.filter(t => t.ListId === ListId).map(t => t.SortOrder || 0)) + SORT_STEP;
    const now = D.nowString();
    const t = {
      Id: newId(), ListId, SectionId: null, Title: title, Notes: '', Priority: 0, Completed: false, CompletedTime: null,
      StartDate: start ? D.format(D.startOfDay(start)) : null, DueDate: null, IsAllDay: true, Repeat: null, ReminderMinutes: null,
      Tags: [], Items: [], SortOrder: order, Created: now, Modified: now, Deleted: false,
    };
    this.data.tasks.push(t);
    this.changed();
    return t;
  }

  update(t, fields) {
    Object.assign(t, fields, { Modified: D.nowString() });
    this.changed();
  }

  /** Complete or reopen. A repeating task leaves a completed copy and moves to its next date, like PIM. */
  setCompleted(t, done) {
    const start = D.parse(t.StartDate);
    if (done && !t.Completed && t.Repeat && start) {
      const copy = E.clone(t);
      Object.assign(copy, { Id: newId(), Repeat: null, Completed: true, CompletedTime: D.nowString(), Items: copy.Items.map(i => ({ ...i, Id: newId() })) });
      this.data.tasks.push(copy);
      const next = D.nextOccurrence(start, t.Repeat), delta = next - start, due = D.parse(t.DueDate);
      Object.assign(t, { StartDate: D.format(next), DueDate: due ? D.format(new Date(+due + delta)) : null, Items: t.Items.map(i => ({ ...i, Done: false })) });
    } else {
      Object.assign(t, { Completed: done, CompletedTime: done ? D.nowString() : null });
    }
    t.Modified = D.nowString();
    this.changed();
  }

  // ---- habits (created and edited on the PC; checked in here) -----------------------------------------

  get habits() { return this.data.habits.filter(h => !h.Archived).sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0)); }
  habit(id) { return this.data.habits.find(h => h.Id === id); }

  /** A tap on a habit's day. `manual` is the amount for "ask how much" habits. Returns true if the day was completed. */
  tapHabit(h, day, manual) { const done = H.tap(this.data, h, day, manual); this.changed(); return done; }
  setHabitDay(h, day, value, note) { H.set(this.data, h, day, value, note); this.changed(); }

  /** Moves a task to Trash (PIM's soft delete), so it can be restored on any device. */
  trash(t) { this.update(t, { Deleted: true }); }
  restore(t) { this.update(t, { Deleted: false, ListId: this.list(t.ListId) ? t.ListId : this.inbox.Id }); }
}
