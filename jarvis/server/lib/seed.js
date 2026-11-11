// Demo household so a fresh install has something to analyse. Every record is tagged
// demo:true and the UI shows a "demo data" badge until real Family Wealth OS data is imported.
import { toMinor } from '../wealth/calc.js';

export function seedDemo(store, householdId = 'hh_demo') {
  if (store.getMeta('seeded')) return;
  const d = new Date();
  const ym = (offset) => { const x = new Date(d.getFullYear(), d.getMonth() - offset, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
  const day = (offset, dd) => `${ym(offset)}-${String(Math.min(dd, 28)).padStart(2, '0')}`;
  const base = { householdId, demo: true };
  store.insert('accounts', { ...base, name: 'Family checking', institution: 'Bank (demo)', type: 'checking', balance: toMinor(18450) });
  store.insert('accounts', { ...base, name: 'Credit card', institution: 'Card (demo)', type: 'credit', balance: toMinor(-3120) });
  const tx = (o, dd, description, category, amount) => store.insert('transactions', { ...base, date: day(o, dd), description, category, amount: toMinor(amount) });
  for (const o of [3, 2, 1, 0]) {
    const isCur = o === 0; const today = d.getDate();
    const ok = (dd) => !isCur || dd <= today;
    if (ok(1)) tx(o, 1, 'Salary', 'income', 21500);
    if (ok(2)) tx(o, 2, 'Rent', 'housing', -6200);
    if (ok(3)) tx(o, 3, 'Streaming service', 'subscriptions', -55);
    if (ok(3)) tx(o, 3, 'Music service', 'subscriptions', -25);
    if (ok(4)) tx(o, 4, 'Gym membership', 'subscriptions', -249);
    if (ok(6)) tx(o, 6, 'Supermarket', 'groceries', -980 - o * 40);
    if (ok(13)) tx(o, 13, 'Supermarket', 'groceries', -870);
    if (ok(20)) tx(o, 20, 'Supermarket', 'groceries', -910 + o * 25);
    if (ok(9)) tx(o, 9, 'Fuel', 'transport', -420);
    if (ok(15)) tx(o, 15, 'Restaurants', 'dining', -380 - (o === 0 ? 520 : 0));
    if (ok(18)) tx(o, 18, 'Electricity', 'utilities', -510);
  }
  if (d.getDate() >= 1) tx(0, Math.min(d.getDate(), 11), 'Electronics store', 'shopping', -2890);
  for (const [category, limit] of [['groceries', 3000], ['dining', 600], ['transport', 700], ['subscriptions', 300], ['shopping', 800]]) store.insert('budgets', { ...base, category, limit: toMinor(limit) });
  store.insert('goals', { ...base, name: 'Emergency fund', target: toMinor(60000), saved: toMinor(34500), monthlyContribution: toMinor(2000), deadline: new Date(d.getFullYear() + 1, 5, 30).toISOString() });
  store.insert('goals', { ...base, name: 'Family vacation', target: toMinor(15000), saved: toMinor(4200), monthlyContribution: toMinor(800), deadline: new Date(d.getFullYear(), d.getMonth() + 8, 1).toISOString() });
  store.insert('assets', { ...base, name: 'Pension fund', type: 'pension', value: toMinor(412000) });
  store.insert('assets', { ...base, name: 'Provident fund (keren hishtalmut)', type: 'provident', value: toMinor(96000) });
  store.insert('assets', { ...base, name: 'Investment portfolio', type: 'investment', value: toMinor(58000) });
  store.insert('assets', { ...base, name: 'Checking balance', type: 'cash', value: toMinor(18450) });
  store.insert('liabilities', { ...base, name: 'Car loan', type: 'loan', balance: toMinor(38000) });
  const due = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  store.insert('bills', { ...base, name: 'Electricity', amount: toMinor(512), dueDate: due(5), paid: false });
  store.insert('bills', { ...base, name: 'Arnona (municipal tax)', amount: toMinor(780), dueDate: due(10), paid: false });
  store.insert('bills', { ...base, name: 'Water', amount: toMinor(160), dueDate: due(-1), paid: false });
  store.insert('users', { id: 'usr_owner', name: 'Owner', householdId, role: 'owner' });
  store.setMeta('seeded', true);
}
