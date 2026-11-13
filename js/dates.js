// Dates in PIM's own format, and repeat rules ported from PIM's Recurrence.cs.
// PIM stores local times with their UTC offset, e.g. "2026-11-14T00:00:00-06:00" (all-day tasks use midnight).

export const parse = s => (s ? new Date(s) : null);
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
export const today = () => startOfDay(new Date());
const pad = n => String(n).padStart(2, '0');

/** Local time with offset, the way PIM writes it. */
export function format(d) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const nowString = () => format(new Date());
export const dateInputValue = d => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
export const timeInputValue = d => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", "Yesterday", "Fri", or "Oct 27"; with the time for timed tasks. */
export function label(task) {
  const s = parse(task.StartDate);
  if (!s) return '';
  const d = startOfDay(s), t = today();
  const diff = Math.round((d - t) / 86400000);
  let text = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
    : diff > 1 && diff < 7 ? DAYS[d.getDay()] : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (!task.IsAllDay) text += ', ' + s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return text;
}

/** End of a task's span (inclusive day for all-day, the end time for timed). */
function end(task) { return parse(task.DueDate) ?? parse(task.StartDate); }

export function isOverdue(task) {
  if (!task.StartDate || task.Completed) return false;
  return task.IsAllDay ? startOfDay(end(task)) < today() : end(task) < new Date();
}

/** True if the task's span touches the day range [from, to). */
export function overlaps(task, from, to) {
  const s = parse(task.StartDate);
  if (!s) return false;
  if (task.IsAllDay) {
    const a = startOfDay(s), b = addDays(startOfDay(end(task)), 1);
    return a < to && b > from;
  }
  const e = end(task);
  return s < to && (e > from || +s === +e && s >= from);
}

// ---- repeats (RRULE body: FREQ, INTERVAL, BYDAY) -------------------------------------------------------
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const parts = rule => Object.fromEntries(rule.replace(/^RRULE:/i, '').split(';').map(p => p.split('=')).filter(p => p.length === 2)
  .map(([k, v]) => [k.trim().toUpperCase(), v.trim().toUpperCase()]));

export function nextOccurrence(from, rule) {
  const p = parts(rule);
  const interval = Math.max(1, parseInt(p.INTERVAL, 10) || 1);
  switch (p.FREQ || 'DAILY') {
    case 'WEEKLY': {
      const days = new Set((p.BYDAY || '').split(',').map(c => CODES.indexOf(c.trim())).filter(i => i >= 0));
      if (days.size) {
        let d = addDays(from, 1);
        for (let i = 0; i < 7 * interval + 7; i++, d = addDays(d, 1)) {
          if (!days.has(d.getDay())) continue;
          const weeks = Math.floor((startOfDay(d) - startOfDay(from)) / (7 * 86400000));
          if (interval === 1 || weeks % interval === 0) return d;
        }
      }
      return addDays(from, 7 * interval);
    }
    case 'MONTHLY': return addMonths(from, interval);
    case 'YEARLY': return addMonths(from, 12 * interval);
    default: return addDays(from, interval);
  }
}

// Like .NET AddMonths: clamp to the last day of a shorter month (Jan 31 + 1 month = Feb 28).
function addMonths(d, n) {
  const y = d.getFullYear(), m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last), d.getHours(), d.getMinutes(), d.getSeconds());
}

export function describeRepeat(rule) {
  if (!rule) return '';
  const p = parts(rule), n = Math.max(1, parseInt(p.INTERVAL, 10) || 1);
  const every = (one, many) => (n === 1 ? `Every ${one}` : `Every ${n} ${many}`);
  switch (p.FREQ || 'DAILY') {
    case 'WEEKLY':
      if (p.BYDAY === 'MO,TU,WE,TH,FR') return 'Every weekday';
      if (p.BYDAY) return `${every('week', 'weeks')} on ${p.BYDAY.split(',').map(c => DAYS[CODES.indexOf(c)]).filter(Boolean).join(', ')}`;
      return every('week', 'weeks');
    case 'MONTHLY': return every('month', 'months');
    case 'YEARLY': return every('year', 'years');
    default: return every('day', 'days');
  }
}
