// Habit rules, ported from PIM's HabitLogic.cs (D:\AI\Projects\PIM\src\PIM\Services\HabitLogic.cs).
// Habits are created and edited on the PC; the phone checks them in. A check-in is one record per habit per day,
// id "habitId:yyyyMMdd", so the same day written on two devices is the same record.
import * as D from './dates.js';

const EPS = 1e-9;
export const SECTIONS = ['Morning', 'Afternoon', 'Night'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');

export const dayKey = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export const checkInId = (h, day) => `${h.Id}:${dayKey(day)}`;
const daysBetween = (a, b) => Math.round((D.startOfDay(b) - D.startOfDay(a)) / 86400000);

export function isScheduled(h, day) {
  const start = D.startOfDay(D.parse(h.StartDate) ?? day);
  if (D.startOfDay(day) < start) return false;
  if (h.Frequency === 'weekly') return true;
  if (h.Frequency === 'interval') return daysBetween(start, day) % Math.max(1, h.IntervalDays || 1) === 0;
  return ((h.Days ?? 127) & (1 << day.getDay())) !== 0;
}

export const checkIn = (data, h, day) => data.checkIns.find(c => c.Id === checkInId(h, day));
export const value = (data, h, day) => checkIn(data, h, day)?.Value ?? 0;
export const achievedValue = (h, v) => v >= Math.max(h.Goal ?? 1, EPS) - EPS;
export const achieved = (data, h, day) => achievedValue(h, value(data, h, day));
export const isAmount = h => (h.Goal ?? 1) > 1 + EPS || (h.Unit ?? 'Count').toLowerCase() !== 'count';
export const amount = v => (Math.abs(v - Math.round(v)) < EPS ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
export const progress = (data, h, day) => (isAmount(h) ? `${amount(value(data, h, day))}/${amount(h.Goal)} ${h.Unit}` : '');

function weekStart(day, first) {
  const d = D.startOfDay(day);
  return D.addDays(d, -((d.getDay() - first + 7) % 7));
}

/** Due today and still open (weekly habits: until the week's target is met). */
export function isDue(data, h, day, first = 0) {
  if (h.Archived || !isScheduled(h, day) || achieved(data, h, day)) return false;
  if (h.Frequency !== 'weekly') return true;
  const ws = weekStart(day, first);
  let n = 0;
  for (let i = 0; i < 7; i++) if (achieved(data, h, D.addDays(ws, i))) n++;
  return n < Math.max(1, h.TimesPerWeek || 1);
}

export function describe(h) {
  if (h.Frequency === 'weekly') return `${h.TimesPerWeek} day${h.TimesPerWeek === 1 ? '' : 's'} a week`;
  if (h.Frequency === 'interval') return `Every ${Math.max(1, h.IntervalDays)} days`;
  const m = (h.Days ?? 127) & 127;
  if (m === 127) return 'Every day';
  if (m === 0b0111110) return 'Weekdays';
  if (m === 0b1000001) return 'Weekends';
  return DAY.filter((_, i) => m & (1 << i)).join(', ');
}

/** Consecutive completed days up to today (today still open does not break it). Days only; weekly habits count weeks on the PC. */
export function streak(data, h, today) {
  let run = 0;
  for (let i = 0; i < 400; i++) {
    const day = D.addDays(D.startOfDay(today), -i);
    if (D.startOfDay(day) < D.startOfDay(D.parse(h.StartDate) ?? day)) break;
    if (achieved(data, h, day)) { run++; continue; }
    if (i === 0 || !isScheduled(h, day) || h.Frequency === 'weekly') continue;
    break;
  }
  return run;
}

/** Set a day's amount and/or note. A day with nothing left is removed. */
export function set(data, h, day, v, note) {
  day = D.startOfDay(day);
  let c = checkIn(data, h, day);
  if (!c) { c = { Id: checkInId(h, day), HabitId: h.Id, Date: D.format(day), Value: 0, Note: '', Modified: D.nowString() }; data.checkIns.push(c); }
  c.Value = Math.max(0, Math.round(v * 10000) / 10000);
  if (note !== undefined) c.Note = note;
  c.Modified = D.nowString();
  if (c.Value <= 0 && !c.Note) data.checkIns.splice(data.checkIns.indexOf(c), 1);
  return c;
}

/** A tap: reset a completed day; else complete ("all"), add the step ("auto") or add `manual` ("manual"). Returns true if it completed the day. */
export function tap(data, h, day, manual) {
  const before = value(data, h, day);
  if (achievedValue(h, before)) { set(data, h, day, 0); return false; }
  const mode = h.CheckMode ?? 'all';
  const after = mode === 'auto' ? before + (h.Step > 0 ? h.Step : 1) : mode === 'manual' ? (manual > 0 ? before + manual : before) : Math.max(h.Goal ?? 1, 1);
  if (after === before) return false;
  set(data, h, day, after);
  return achievedValue(h, after);
}

export function sectionOrder(habits) {
  const own = [...new Set(habits.map(h => h.Section || 'Others'))].filter(s => !SECTIONS.includes(s) && s !== 'Others').sort();
  return [...SECTIONS, ...own, 'Others'];
}
