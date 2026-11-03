// Proactive engine: finds things worth the user's attention and ranks them.
// score = urgency*0.4 + importance*0.35 + confidence*0.25, scaled by user preference weight.
// Read-only: it suggests; it never acts on its own.
export function score({ urgency, importance, confidence }, weight = 1) {
  return Math.round((urgency * 0.4 + importance * 0.35 + confidence * 0.25) * weight * 100) / 100;
}

export async function scan({ productivity, wealth, home, ctx, prefs = {}, today = new Date().toISOString().slice(0, 10) }) {
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
    for (const u of a.calculations.anomalies.unusual.slice(0, 3)) {
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
  const threshold = prefs.threshold ?? 0.55;
  return out.filter((x) => x.score >= threshold).sort((a, b) => b.score - a.score).slice(0, prefs.max ?? 10);
}
