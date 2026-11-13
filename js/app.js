// PIM for iPhone and iPad: the screens. All text from your data is inserted with textContent, never as HTML.
import { Store } from './store.js';
import * as A from './auth.js';
import * as D from './dates.js';

const demo = new URLSearchParams(location.search).has('demo');
const store = new Store({ demo });
if (demo) { loadDemo(store); window.__pimStore = store; }   // demo only: lets the UI test read the data

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;      // CSSOM, which the page's Content-Security-Policy allows
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
  return e;
}

const PRIORITY = { 5: ['High', 'p-high'], 3: ['Medium', 'p-med'], 1: ['Low', 'p-low'], 0: ['None', 'p-none'] };
const VIEWS = { today: 'Today', next7: 'Next 7 Days', inbox: 'Inbox', all: 'All', completed: 'Completed', trash: 'Trash' };
let view = localStorage.getItem('pim.view') || 'today';
let selected = null;           // task id open in the details pane / sheet
let quickDate = null;          // 'today' | 'tomorrow' | 'none' chip for Quick add

// ---- filtering ---------------------------------------------------------------------------------------
function viewTitle() {
  if (view.startsWith('list:')) return store.list(view.slice(5))?.Name ?? 'List';
  return VIEWS[view] ?? 'Today';
}
function sortTasks(a, b) {
  const da = D.parse(a.StartDate), db = D.parse(b.StartDate);
  if (da && db && +D.startOfDay(da) !== +D.startOfDay(db)) return da - db;
  if (!!da !== !!db) return da ? -1 : 1;
  return (b.Priority - a.Priority) || ((a.SortOrder || 0) - (b.SortOrder || 0));
}
/** Sections to show: [{title, tasks}] */
function sections() {
  const t0 = D.today(), t1 = D.addDays(t0, 1);
  if (view === 'today') {
    const open = store.open.filter(t => D.isOverdue(t) || D.overlaps(t, t0, t1));
    return [{ title: 'Overdue', tasks: open.filter(D.isOverdue).sort(sortTasks) },
            { title: 'Today', tasks: open.filter(t => !D.isOverdue(t)).sort(sortTasks) }];
  }
  if (view === 'next7') {
    const out = [{ title: 'Overdue', tasks: store.open.filter(D.isOverdue).sort(sortTasks) }];
    for (let i = 0; i < 7; i++) {
      const a = D.addDays(t0, i), b = D.addDays(t0, i + 1);
      const tasks = store.open.filter(t => !D.isOverdue(t) && D.overlaps(t, a, b)).sort(sortTasks);
      out.push({ title: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : a.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }), tasks });
    }
    return out;
  }
  if (view === 'completed') return [{ title: '', tasks: store.live.filter(t => t.Completed).sort((a, b) => (b.CompletedTime || '').localeCompare(a.CompletedTime || '')) }];
  if (view === 'trash') return [{ title: '', tasks: store.data.tasks.filter(t => t.Deleted) }];
  const listId = view === 'inbox' ? store.inbox.Id : view.startsWith('list:') ? view.slice(5) : null;
  const tasks = store.open.filter(t => listId === null || t.ListId === listId).sort(sortTasks);
  return [{ title: '', tasks }];
}
function counts() {
  const t0 = D.today(), t1 = D.addDays(t0, 1), t7 = D.addDays(t0, 7);
  return {
    today: store.open.filter(t => D.isOverdue(t) || D.overlaps(t, t0, t1)).length,
    next7: store.open.filter(t => D.isOverdue(t) || D.overlaps(t, t0, t7)).length,
    inbox: store.open.filter(t => t.ListId === store.inbox.Id).length,
    all: store.open.length,
  };
}

// ---- rendering ---------------------------------------------------------------------------------------
function render() {
  document.title = `PIM - ${viewTitle()}`;
  renderNav();
  renderMain();
  renderDetail();
}

function navItem(key, label, count, color) {
  return el('button', { class: 'nav-item' + (view === key ? ' on' : ''), onclick: () => go(key) },
    color ? el('span', { class: 'dot', style: `background:${color}` }) : null,
    el('span', { class: 'nav-label', text: label }), count ? el('span', { class: 'count', text: String(count) }) : null);
}

function renderNav() {
  const c = counts();
  const side = $('#sidebar');
  side.replaceChildren(
    el('div', { class: 'brand' }, el('img', { src: 'icons/icon-192.png', alt: '' }), el('span', { text: 'PIM' })),
    navItem('today', 'Today', c.today), navItem('next7', 'Next 7 Days', c.next7), navItem('inbox', 'Inbox', c.inbox), navItem('all', 'All', c.all),
    el('div', { class: 'nav-head', text: 'Lists' }),
    ...store.lists.filter(l => !l.IsInbox).map(l => navItem('list:' + l.Id, l.Name, store.open.filter(t => t.ListId === l.Id).length, l.Color)),
    el('div', { class: 'nav-head' }), navItem('completed', 'Completed'), navItem('trash', 'Trash'));
  const tabs = $('#tabs');
  const tab = (key, label, icon) => el('button', { class: 'tab' + ((view === key || (key === 'lists' && !['today', 'next7', 'inbox'].includes(view))) ? ' on' : ''), onclick: () => key === 'lists' ? openListsSheet() : go(key) },
    el('span', { class: 'tab-icon', text: icon }), el('span', { text: label }));
  tabs.replaceChildren(tab('today', 'Today', '☀'), tab('next7', 'Next 7', '📅'), tab('inbox', 'Inbox', '📥'), tab('lists', 'Lists', '☰'));
}

function renderMain() {
  $('#view-title').textContent = viewTitle();
  const showAdd = !['completed', 'trash'].includes(view);
  $('#quick').hidden = !showAdd;
  if (quickDate === null) quickDate = view === 'today' || view === 'next7' ? 'today' : 'none';
  for (const b of document.querySelectorAll('#quick .chip')) b.classList.toggle('on', b.dataset.date === quickDate);
  const body = $('#list');
  const secs = sections().filter(s => s.tasks.length || (!s.title && true));
  const nodes = [];
  for (const s of secs) {
    if (s.title && s.tasks.length) nodes.push(el('div', { class: 'sec', text: `${s.title}  ${s.tasks.length}` }));
    for (const t of s.tasks) nodes.push(row(t));
  }
  if (!nodes.length) nodes.push(el('div', { class: 'empty', text: store.data.tasks.length ? 'Nothing here.' : (store.status.state === 'signin' ? 'Sign in to load your tasks.' : 'Loading your tasks...') }));
  body.replaceChildren(...nodes);
}

function row(t) {
  const list = store.list(t.ListId);
  const done = t.Completed;
  const meta = [D.label(t), t.Repeat ? '↻' : '', t.Items?.length ? `${t.Items.filter(i => i.Done).length}/${t.Items.length}` : '', view.startsWith('list:') ? '' : list?.Name ?? '']
    .filter(Boolean).join('  ·  ');
  return el('div', { class: 'row' + (selected === t.Id ? ' sel' : '') + (done ? ' done' : ''), onclick: () => select(t.Id) },
    el('button', { class: `check ${PRIORITY[t.Priority]?.[1] ?? 'p-none'}` + (done ? ' on' : ''), 'aria-label': done ? 'Mark not done' : 'Mark done',
      onclick: e => { e.stopPropagation(); if (t.Deleted) return; store.setCompleted(t, !t.Completed); } }, done ? '✓' : ''),
    el('div', { class: 'row-text' }, el('div', { class: 'row-title', text: t.Title || '(untitled)' }),
      meta ? el('div', { class: 'row-meta' + (D.isOverdue(t) ? ' late' : ''), text: meta }) : null),
    list?.Color ? el('span', { class: 'list-dot', style: `background:${list.Color}` }) : null);
}

function renderDetail() {
  const pane = $('#detail');
  const t = selected && store.task(selected);
  document.body.classList.toggle('has-detail', !!t);
  if (!t) { pane.replaceChildren(); return; }
  const start = D.parse(t.StartDate);
  const titleBox = el('textarea', { class: 'd-title', rows: 1, text: t.Title });
  titleBox.value = t.Title;
  titleBox.addEventListener('change', () => store.update(t, { Title: titleBox.value.trim() || t.Title }));
  const notes = el('textarea', { class: 'd-notes', rows: 6, placeholder: 'Notes' });
  notes.value = t.Notes || '';
  notes.addEventListener('change', () => store.update(t, { Notes: notes.value }));
  const dateIn = el('input', { type: 'date', value: D.dateInputValue(start) });
  const timeIn = el('input', { type: 'time', value: t.IsAllDay ? '' : D.timeInputValue(start) });
  const applyDate = () => {
    if (!dateIn.value) { store.update(t, { StartDate: null, DueDate: null, IsAllDay: true }); return; }
    const [y, m, d] = dateIn.value.split('-').map(Number);
    const [hh, mm] = timeIn.value ? timeIn.value.split(':').map(Number) : [0, 0];
    const s = new Date(y, m - 1, d, hh, mm);
    store.update(t, { StartDate: D.format(s), DueDate: null, IsAllDay: !timeIn.value });
  };
  dateIn.addEventListener('change', applyDate);
  timeIn.addEventListener('change', applyDate);
  const quick = (label, days) => el('button', { class: 'chip', text: label, onclick: () => { const s = D.addDays(D.today(), days); store.update(t, { StartDate: D.format(s), DueDate: null, IsAllDay: true }); } });
  const listSel = el('select', { onchange: e => store.update(t, { ListId: e.target.value, SectionId: null }) },
    ...store.lists.map(l => el('option', { value: l.Id, selected: l.Id === t.ListId, text: l.Name })));
  const items = (t.Items || []).map((it, i) => el('label', { class: 'item' + (it.Done ? ' done' : '') },
    el('input', { type: 'checkbox', checked: it.Done, onchange: e => { const copy = t.Items.map((x, j) => j === i ? { ...x, Done: e.target.checked } : x); store.update(t, { Items: copy }); } }),
    el('span', { text: it.Title })));
  const addItem = el('input', { class: 'add-item', placeholder: '+ Add checklist item', enterkeyhint: 'done' });
  addItem.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !addItem.value.trim()) return;
    const id = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
    store.update(t, { Items: [...(t.Items || []), { Id: id, Title: addItem.value.trim(), Done: false }] });
  });
  pane.replaceChildren(el('div', { class: 'd-wrap' },
    el('div', { class: 'd-top' },
      el('button', { class: 'link', text: '‹ Back', onclick: () => select(null) }),
      el('button', { class: 'link', text: t.Completed ? 'Mark not done' : 'Mark done', onclick: () => store.setCompleted(t, !t.Completed) })),
    titleBox,
    el('div', { class: 'field' }, el('span', { class: 'f-label', text: 'Date' }), dateIn, timeIn,
      el('button', { class: 'chip', text: 'Clear', onclick: () => store.update(t, { StartDate: null, DueDate: null, IsAllDay: true }) })),
    el('div', { class: 'field chips' }, quick('Today', 0), quick('Tomorrow', 1), quick('Next week', 7)),
    t.Repeat ? el('div', { class: 'field' }, el('span', { class: 'f-label', text: 'Repeats' }), el('span', { text: D.describeRepeat(t.Repeat) })) : null,
    el('div', { class: 'field' }, el('span', { class: 'f-label', text: 'Priority' }),
      ...[5, 3, 1, 0].map(p => el('button', { class: `chip prio ${PRIORITY[p][1]}` + (t.Priority === p ? ' on' : ''), text: PRIORITY[p][0], onclick: () => store.update(t, { Priority: p }) }))),
    el('div', { class: 'field' }, el('span', { class: 'f-label', text: 'List' }), listSel),
    el('div', { class: 'f-label block', text: `Checklist${t.Items?.length ? `  ${t.Items.filter(i => i.Done).length}/${t.Items.length}` : ''}` }),
    ...items, addItem,
    el('div', { class: 'f-label block', text: 'Notes' }), notes,
    /!\[image\]\(pim-image:/.test(t.Notes || '') ? el('div', { class: 'hint', text: 'Pictures in this note show on the PC. Their lines here start with ![image] - leave those lines as they are.' }) : null,
    t.Deleted ? el('button', { class: 'wide', text: 'Restore from Trash', onclick: () => store.restore(t) })
      : el('button', { class: 'wide danger', text: 'Move to Trash', onclick: () => { store.trash(t); select(null); } })));
}

function openListsSheet() {
  const sheet = $('#sheet');
  const c = counts();
  const item = (key, label, count, color) => el('button', { class: 'sheet-item', onclick: () => { sheet.hidden = true; go(key); } },
    color ? el('span', { class: 'dot', style: `background:${color}` }) : null, el('span', { class: 'nav-label', text: label }), count ? el('span', { class: 'count', text: String(count) }) : null);
  sheet.replaceChildren(el('div', { class: 'sheet-card' },
    el('div', { class: 'sheet-head' }, el('span', { text: 'Lists' }), el('button', { class: 'link', text: 'Done', onclick: () => (sheet.hidden = true) })),
    item('all', 'All', c.all),
    ...store.lists.filter(l => !l.IsInbox).map(l => item('list:' + l.Id, l.Name, store.open.filter(t => t.ListId === l.Id).length, l.Color)),
    item('completed', 'Completed'), item('trash', 'Trash'),
    el('div', { class: 'sheet-foot' },
      el('button', { class: 'link', text: 'Sync now', onclick: () => { sheet.hidden = true; store.sync(); } }),
      A.hasSignedInBefore() ? el('button', { class: 'link', text: 'Sign out', onclick: () => { A.signOut(); location.reload(); } }) : null,
      el('div', { class: 'hint', text: `This device: ${store.device.name} (${store.device.id})` }))));
  sheet.hidden = false;
  sheet.onclick = e => { if (e.target === sheet) sheet.hidden = true; };
}

function go(key) { view = key; selected = null; quickDate = null; localStorage.setItem('pim.view', key); render(); }
function select(id) { selected = id; render(); if (id) $('#detail').scrollTop = 0; }

function renderStatus() {
  const s = store.status, bar = $('#status');
  bar.dataset.state = s.state;
  bar.replaceChildren(...[el('span', { class: 'sdot' }), el('span', { text: s.text || (demo ? 'Demo data - not synced' : '') }),
    s.state === 'signin' ? el('button', { class: 'chip on', text: 'Sign in', onclick: () => A.startSignIn(false) }) : null].filter(Boolean));
}

// ---- quick add ---------------------------------------------------------------------------------------
function setupQuickAdd() {
  const input = $('#quick-input');
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const start = quickDate === 'today' ? D.today() : quickDate === 'tomorrow' ? D.addDays(D.today(), 1) : null;
    const listId = view.startsWith('list:') ? view.slice(5) : view === 'inbox' ? store.inbox.Id : null;
    store.addTask(input.value.trim(), { listId, start });
    input.value = '';
  });
  for (const b of document.querySelectorAll('#quick .chip')) b.addEventListener('click', () => { quickDate = b.dataset.date; renderMain(); input.focus(); });
}

// ---- start -------------------------------------------------------------------------------------------
store.addEventListener('data', render);
store.addEventListener('status', () => { renderStatus(); if (!store.data.tasks.length) renderMain(); });
setupQuickAdd();
render();
renderStatus();

if (!demo) {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  (async () => {
    let result = null;
    try { result = await A.handleRedirect(); } catch (e) { store.setStatus('problem', 'Sign-in failed: ' + e.message); }
    if (result === 'needs-sign-in' || (!A.hasSignedInBefore() && result !== 'signed-in')) { store.setStatus('signin', 'Sign in to sync with your PCs'); return; }
    let token = null;
    try { token = await A.getToken(); } catch { /* handled below */ }
    if (!token) {
      // The 24-hour browser sign-in has run out: go to Microsoft and straight back, once per visit.
      if (!sessionStorage.getItem('pim.silent')) { sessionStorage.setItem('pim.silent', '1'); A.startSignIn(true); return; }
      store.setStatus('signin', 'Sign in to sync');
      return;
    }
    sessionStorage.removeItem('pim.silent');
    store.sync();
    setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.sync(); });
    addEventListener('online', () => store.sync());
  })();
}

// Demo data for screenshots and a first look (?demo). Nothing here is real, and demo mode never syncs.
function loadDemo(s) {
  const d = D.today(), at = (n, h = 0, m = 0) => D.format(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, m));
  const L = (Id, Name, Color, IsInbox = false, SortOrder = 0) => ({ Id, Name, Color, ViewMode: 'list', SortOrder, IsInbox, Sections: [] });
  s.data.lists = [L('inbox', 'Inbox', '#5B5BD6', true), L('work', 'Work', '#2F7FED', false, 1), L('home', 'Personal', '#1FA37A', false, 2), L('proj', 'Home Projects', '#EA7A2B', false, 3)];
  let n = 0;
  const T = (Title, ListId, StartDate, extra = {}) => ({ Id: 'demo' + n++, ListId, SectionId: null, Title, Notes: '', Priority: 0, Completed: false, CompletedTime: null,
    StartDate, DueDate: null, IsAllDay: true, Repeat: null, ReminderMinutes: null, Tags: [], Items: [], SortOrder: n * 2 ** 32, Created: at(0), Modified: at(0), Deleted: false, ...extra });
  s.data.tasks = [
    T('Submit expense report', 'work', at(-2), { Priority: 5 }),
    T('Call the bank', 'inbox', at(-1), { Priority: 3 }),
    T('Weekly team sync', 'work', at(0, 9), { IsAllDay: false, DueDate: at(0, 10), Repeat: 'FREQ=WEEKLY;BYDAY=MO' }),
    T('Pick up groceries', 'home', at(0), { Items: [{ Id: 'i1', Title: 'Milk', Done: true }, { Id: 'i2', Title: 'Eggs', Done: false }, { Id: 'i3', Title: 'Bread', Done: false }] }),
    T('Morning run', 'home', at(0, 7), { IsAllDay: false, Repeat: 'FREQ=DAILY', Priority: 1 }),
    T('Fix the leaky faucet', 'proj', at(1), { Priority: 3 }),
    T('Dentist', 'home', at(3, 15), { IsAllDay: false }),
    T('Plan the garden', 'proj', null),
    T('Read 20 pages', 'home', at(0), { Completed: true, CompletedTime: at(0, 8) }),
  ];
  s.setStatus('demo', 'Demo data - not synced');
}
