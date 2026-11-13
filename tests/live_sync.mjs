// Runs the page's real sync code (store.js + graph.js) under Node against the real OneDrive app folder.
// Read path: lists devices, downloads each device's newest file, merges. Write path: publishes ONE copy as a
// throwaway device "WebTest-<id>" with no edits (so nothing changes for the PCs), checks it, then deletes it.
// Needs an access token for the PIM Sync app in PIM_TEST_TOKEN; it is never printed.
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
localStorage.setItem('pim.auth', JSON.stringify({ access: process.env.PIM_TEST_TOKEN, exp: Date.now() + 40 * 60_000, refresh: null }));

const { Store } = await import('../js/store.js');
const G = await import('../js/graph.js');
const E = await import('../js/engine.js');

const s = new Store();
s.device = { id: 'test' + Math.floor(Math.random() * 1e4).toString().padStart(4, '0'), name: 'WebTest' };
s.replica = E.newReplica(s.device.id, s.device.name);
s.clock = new E.SyncClock(s.device.id);

await s.sync();
console.log('status:', s.status.state, '|', s.status.text);
console.log('devices read:', Object.keys(s.others).join(', '));
console.log('tasks after join:', s.data.tasks.length, '| lists:', s.data.lists.length, '| pending upload:', s.pending);

s.pending = true;                       // force one publish of the unchanged, merged data
await s.publish();
const folder = `devices/${s.base}`;
const files = await G.children(folder);
console.log('published to', folder, ':', files.map(f => f.name).join(', '));
const back = JSON.parse(await G.download(files[0].downloadUrl));
console.log('round trip identical:', E.fingerprint(back) === E.fingerprint(s.replica));
await G.remove(folder);
console.log('test device removed:', (await G.children('devices')).every(i => i.name !== s.base));
