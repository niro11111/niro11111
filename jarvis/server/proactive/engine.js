// Proactive engine: finds things worth the user's attention and ranks them.
// score = urgency*0.4 + importance*0.35 + confidence*0.25, scaled by user preference weight.
// Read-only: it suggests; it never acts on its own.
export function score({ urgency, importance, confidence }, weight = 1) {
  return Math.round((urgency * 0.4 + importance * 0.35 + confidence * 0.25) * weight * 100) / 100;
}

export async function scan({ productivity, wealth, home, store, ctx, prefs = {}, today = new Date().toISOString().slice(0, 10) }) {
  const out = [];
  const w = (k) => prefs.weights?.[k] ?? 1;
  const t0 = Date.parse(today);
  for (const t of productivity.listTasks()) {
    if (!t.due) continue;
    const days = (Date.parse(t.due) - t0) / 864e5;
    if (days <= 2) out.push({ kind: 'deadline', title: days < 0 ? `Overdue: ${t.title}` : `Due soon: ${t.title}`, ref: t.id,
      score: score({ urgency: days < 0 ? 1 : 0.8, importance: t.priority === 'high' ? 1 : 0.6, confidence: 1 }, w('deadline')) });
  }
  if (wealth && ctx?.householdId) {
    for (const b of wealth.upcomingBills({ ...ctx, actor: 'proactive' }, 7)) {
      out.push({ kind: 'bill', title: `${b.overdue ? 'Overdue bill' : 'Bill due'}: ${b.name} (${b.dueDate})`, ref: b.id,
        score: score({ urgency: b.overdue ? 1 : 0.7, importance: 0.8, confidence: 1 }, w('bill')) });
    }
    const a = wealth.analysis({ ...ctx, actor: 'proactive' });
    const seenU = new Set();
    for (const u of a.calculations.anomalies.unusual.filter((x) => !seenU.has(x.description) && seenU.add(x.description)).slice(0, 3)) {
      out.push({ kind: 'finance_anomaly', title: `Unusual expense: ${u.description}`, ref: u.transactionId,
        score: score({ urgency: 0.5, importance: 0.7, confidence: 0.6 }, w('finance_anomaly')) });
    }
    for (const b of a.calculations.budgets.filter((x) => x.over)) {
      out.push({ kind: 'budget', title: `Over budget: ${b.category}`, score: score({ urgency: 0.5, importance: 0.7, confidence: 1 }, w('budget')) });
    }
  }
  if (home) {
    for (const d of (await home.devices()).filter((x) => !x.online)) {
      out.push({ kind: 'device_offline', title: `Device offline: ${d.name}`, ref: d.id, score: score({ urgency: 0.4, importance: 0.5, confidence: 0.9 }, w('device_offline')) });
    }
  }
  const days = {};
  for (const e of productivity.listEvents({ from: today })) {
    const k = e.start.slice(0, 10); (days[k] ??= []).push(e);
  }
  for (const list of Object.values(days)) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]; const b = list[i];
      const aEnd = a.end ? Date.parse(a.end) : Date.parse(a.start) + 36e5;
      if (Date.parse(b.start) < aEnd) out.push({ kind: 'calendar_conflict', title: `Calendar conflict: ${a.title} / ${b.title}`, score: score({ urgency: 0.7, importance: 0.7, confidence: 1 }, w('calendar_conflict')) });
    }
  }
  if (store) {
    // Unfinished projects: open tasks in a project untouched for 14+ days.
    const byProject = {};
    for (const t of productivity.listTasks().filter((x) => x.project)) (byProject[t.project] ??= []).push(t);
    for (const [p, list] of Object.entries(byProject)) {
      const last = Math.max(...list.map((t) => Date.parse(t.updatedAt ?? t.createdAt)));
      if (t0 - last > 14 * 864e5) out.push({ kind: 'stale_project', title: `Project "${p}" has ${list.length} open task(s) untouched for 2+ weeks`, why: 'no task activity in 14 days', score: score({ urgency: 0.4, importance: 0.7, confidence: 0.9 }, w('stale_project')) });
    }
    // Automation suggestions: the same command repeated 3+ times in 14 days.
    const counts = {};
    for (const t of store.all('tasks_exec', (x) => x.state === 'COMPLETED' && t0 - Date.parse(x.createdAt) < 14 * 864e5 && x.actor === 'user')) {
      const k = t.objective.trim().toLowerCase(); counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const [k, n] of Object.entries(counts).filter(([, n]) => n >= 3)) {
      out.push({ kind: 'automation_suggestion', title: `You asked "${k}" ${n} times recently - make it an automation?`, why: `${n} identical requests in 14 days`, score: score({ urgency: 0.3, importance: 0.6, confidence: 0.8 }, w('automation_suggestion')) });
    }
    // Recurring household issue: same device offline in several past notifications.
    const offlineNotes = store.all('notifications', (n) => n.event === 'proactive:device_offline');
    if (offlineNotes.some((n) => (n.count ?? 1) >= 3)) out.push({ kind: 'recurring_issue', title: 'A device keeps going offline - check its power or Wi-Fi', why: 'offline alert repeated 3+ times', score: score({ urgency: 0.5, importance: 0.6, confidence: 0.8 }, w('recurring_issue')) });
  }
  for (const x of out) x.why ??= { deadline: 'due date within 2 days', bill: 'unpaid bill due within 7 days', finance_anomaly: 'more than 2.5x the category median', budget: 'spent more than the budget', device_offline: 'device reports unavailable', calendar_conflict: 'overlapping events' }[x.kind];
  const threshold = prefs.threshold ?? 0.55;
  return out.filter((x) => x.score >= threshold).sort((a, b) => b.score - a.score).slice(0, prefs.max ?? 10);
}
