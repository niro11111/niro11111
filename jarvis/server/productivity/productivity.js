// Tasks, calendar events, reminders, projects and the daily / weekly briefings.
import { now } from '../lib/store.js';
import { fmt } from '../wealth/calc.js';

export class Productivity {
  constructor(store) { this.store = store; }

  createTask({ title, priority = 'normal', due = null, project = null, dependsOn = [], repeat = null }) {
    if (!title) throw new Error('title required');
    return this.store.insert('tasks', { title, priority, due, project, dependsOn, repeat, done: false });
  }
  listTasks({ open = true } = {}) {
    const order = { high: 0, normal: 1, low: 2 };
    return this.store.all('tasks', (t) => !open || !t.done)
      .sort((a, b) => (order[a.priority] - order[b.priority]) || String(a.due ?? '9').localeCompare(String(b.due ?? '9')));
  }
  completeTask(id) {
    const t = this.store.get('tasks', id);
    if (!t) return null;
    const blocked = (t.dependsOn ?? []).filter((d) => !this.store.get('tasks', d)?.done);
    if (blocked.length) throw new Error(`blocked by unfinished tasks: ${blocked.join(', ')}`);
    const r = this.store.update('tasks', id, { done: true, completedAt: now() });
    if (t.repeat && t.due) {
      const step = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5 }[t.repeat];
      if (step) this.createTask({ ...t, id: undefined, due: new Date(Date.parse(t.due) + step).toISOString() });
    }
    return r;
  }

  createEvent({ title, start, end = null, location = null, recurring = null }) {
    if (!title || !start) throw new Error('title and start required');
    const clash = this.eventsOn(start.slice(0, 10)).filter((e) => overlaps(e, { start, end }));
    const ev = this.store.insert('events', { title, start, end, location, recurring });
    return { ...ev, conflicts: clash.map((c) => c.title) };
  }
  eventsOn(day) { return this.store.all('events', (e) => e.start.slice(0, 10) === day).sort((a, b) => a.start.localeCompare(b.start)); }
  listEvents({ from, to } = {}) {
    return this.store.all('events', (e) => (!from || e.start >= from) && (!to || e.start <= to)).sort((a, b) => a.start.localeCompare(b.start));
  }

  createReminder({ text, at }) {
    if (!text || !at) throw new Error('text and time required');
    return this.store.insert('reminders', { text, at, fired: false });
  }
  dueReminders(at = new Date().toISOString()) { return this.store.all('reminders', (r) => !r.fired && r.at <= at); }
  markFired(id) { return this.store.update('reminders', id, { fired: true }); }

  dailyBriefing({ today = new Date().toISOString().slice(0, 10), wealth, approvals = [], home = [] } = {}) {
    const events = this.eventsOn(today);
    const tasks = this.listTasks().slice(0, 7);
    const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < today);
    const reminders = this.store.all('reminders', (r) => !r.fired && r.at.slice(0, 10) === today);
    const bills = wealth?.upcomingBills ?? [];
    const offline = home.filter((d) => !d.online);
    const next = [];
    if (overdue.length) next.push(`Close overdue task: ${overdue[0].title}`);
    if (bills.some((b) => b.overdue)) next.push('Pay overdue bills');
    if (approvals.length) next.push(`Review ${approvals.length} pending approval(s)`);
    if (!next.length && tasks[0]) next.push(`Start with: ${tasks[0].title}`);
    const text = [
      `Briefing for ${today}`,
      events.length ? `Schedule: ${events.map((e) => `${e.start.slice(11, 16)} ${e.title}`).join('; ')}` : 'Schedule: no events today.',
      tasks.length ? `Top tasks: ${tasks.slice(0, 3).map((t) => t.title).join('; ')}` : 'No open tasks.',
      bills.length ? `Bills soon: ${bills.map((b) => `${b.name} ${fmt(b.amount)} (${b.dueDate})`).join('; ')}` : 'No bills due in the next 14 days.',
      approvals.length ? `Pending approvals: ${approvals.length}` : null,
      offline.length ? `Offline devices: ${offline.map((d) => d.name).join(', ')}` : null,
      next.length ? `Recommended next: ${next.join('; ')}` : null,
    ].filter(Boolean).join('\n');
    return { today, events, tasks, overdue, reminders, bills, approvals: approvals.length, offlineDevices: offline, recommended: next, text };
  }

  weeklyReport({ since = new Date(Date.now() - 7 * 864e5).toISOString(), wealthSummary = null } = {}) {
    const done = this.store.all('tasks', (t) => t.done && (t.completedAt ?? '') >= since);
    const open = this.listTasks();
    const week = new Date(Date.now() + 7 * 864e5).toISOString();
    const deadlines = open.filter((t) => t.due && t.due <= week);
    const text = [
      `Weekly report since ${since.slice(0, 10)}`,
      `Completed: ${done.length}${done.length ? ` (${done.slice(0, 5).map((t) => t.title).join('; ')})` : ''}`,
      `Open: ${open.length}`,
      `Deadlines this week: ${deadlines.length ? deadlines.map((t) => t.title).join('; ') : 'none'}`,
      wealthSummary ? `Finances: expenses ${fmt(wealthSummary.expenses)}, net ${fmt(wealthSummary.net)}` : null,
      open[0] ? `Suggested priority: ${open[0].title}` : null,
    ].filter(Boolean).join('\n');
    return { completed: done, open, deadlines, text };
  }
}

function overlaps(a, b) {
  const as = Date.parse(a.start); const ae = a.end ? Date.parse(a.end) : as + 36e5;
  const bs = Date.parse(b.start); const be = b.end ? Date.parse(b.end) : bs + 36e5;
  return as < be && bs < ae;
}
