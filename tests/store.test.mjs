// Checks how the page's Store copes with damaged or unavailable device storage. Usage: node tests/store.test.mjs
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log('FAIL', name, detail); } };

const mem = new Map();
let full = false;
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (full) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); mem.set(k, String(v)); },
  removeItem: k => mem.delete(k),
};
const { Store } = await import('../js/store.js');

// Damaged saved state: the page starts clean and keeps the bad text aside instead of staying blank.
mem.set('pim.state', '{"device": {"id": "abc"');
let s = new Store();
check('damaged state: starts clean', s.data.tasks.length === 0 && s.replica.Records && Object.keys(s.replica.Records).length === 0);
check('damaged state: bad text kept aside', mem.get('pim.state.unreadable') === '{"device": {"id": "abc"');
check('damaged state: original key cleared', !mem.has('pim.state'));

mem.set('pim.state', '[1,2]');
s = new Store();
check('state that is not an object: starts clean', s.data.tasks.length === 0 && mem.has('pim.state.unreadable'));

// Good state round-trips.
mem.clear();
s = new Store();
s.sync = async () => {};
const t = s.addTask('Buy milk');
const again = new Store();
check('saved state reloads', again.data.tasks.length === 1 && again.data.tasks[0].Id === t.Id && again.device.id === s.device.id);

// Storage full: the edit stays in memory and the page says so instead of throwing.
full = true;
let threw = false;
try { s.addTask('Second'); } catch { threw = true; }
check('full storage: no exception', !threw);
check('full storage: edit kept in memory', s.data.tasks.length === 2);
check('full storage: status says so', s.status.state === 'problem' && /copy on this device/.test(s.status.text), JSON.stringify(s.status));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail);
