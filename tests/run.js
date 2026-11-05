// End-to-end test: starts a real server on a throwaway database and walks through first-run setup,
// recording, auto-categorization, learning, dashboards, roles, bills and PIN lockout.
// Run: npm test       (never touches data/tally.db)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-test-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT, TALLY_DB: path.join(dir, 't.db'), TALLY_TODAY: '2026-03-20', TALLY_DEMO_USER: '' }, stdio: ['ignore', 'pipe', 'inherit'] });

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra); } };
function client() {
  let ck = '';
  return async (p, { method = 'GET', body, lang = 'en' } = {}) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Lang': lang, ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
}
async function waitUp() { for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/setup'); return; } catch { await new Promise(r => setTimeout(r, 100)); } } throw new Error('server did not start'); }

(async () => {
  try {
    await waitUp();
    const admin = client(), kid = client(), anon = client();
    console.log('first run');
    ok((await anon('/api/setup')).data.needed === true, 'fresh database asks for setup');
    ok((await anon('/api/me')).status === 409, 'API refuses until setup is done');
    const s = await admin('/api/setup', { method: 'POST', body: { lang: 'en', name: 'Alex', pin: '2468', home_currency: 'CAD', extra_currencies: [{ code: 'USD', rate: 0.72 }],
      members: [{ name: 'Sam', role: 'member' }, { name: 'Mia', role: 'personal' }] } });
    ok(s.status === 200 && s.data.pins && /^\d{4}$/.test(s.data.pins.Sam) && /^\d{4}$/.test(s.data.pins.Mia), 'setup creates household and returns member PINs');
    ok((await anon('/api/setup', { method: 'POST', body: { name: 'Eve', pin: '1111' } })).status === 400, 'setup cannot be run twice');
    const me = (await admin('/api/me')).data;
    ok(me.user.name === 'Alex' && me.user.role === 'admin', 'admin is logged in right after setup');
    ok(me.home === 'CAD' && me.currencies.join() === 'CAD,USD', 'currencies saved');
    ok(me.categories.length === 25 && me.categories.some(c => c.name === 'Groceries'), 'English category template loaded');
    ok(JSON.stringify(me.people) === '["Alex","Sam","Mia"]', 'people list = household members');

    console.log('recording + auto-categorization');
    const add = (c, e) => c('/api/entries', { method: 'POST', body: e }).then(r => r.data.results[0]);
    let r = await add(admin, { client_id: 'a1', amount: 84.2, note: 'Costco run', date: '2026-03-02' });
    ok(r.entry && r.entry.category === 'Groceries' && r.entry.status === 'ok', 'keyword "costco" → Groceries');
    r = await add(admin, { client_id: 'a1', amount: 84.2, note: 'Costco run' });
    ok(r.duplicate === true, 'same client_id is not saved twice (offline retry)');
    r = await add(admin, { client_id: 'a2', amount: 20, note: 'zzqx thing', date: '2026-03-03' });
    ok(r.entry.category === 'Misc' && r.entry.status === 'pending', 'unknown note → fallback category, marked pending');
    const fix = await admin('/api/entries/' + r.entry.id, { method: 'PUT', body: { category: 'Pets' } });
    ok(fix.data.category === 'Pets' && fix.data.status === 'ok', 'fixing the category clears pending');
    ok((await admin('/api/classify', { method: 'POST', body: { text: 'zzqx thing again' } })).data.category === 'Pets', 'the correction is learned');
    r = await add(admin, { client_id: 'a3', amount: 100, currency: 'USD', note: 'dinner downtown', date: '2026-03-05' });
    ok(r.entry.category === 'Dining Out' && r.entry.home === 138.89, 'USD 100 at 0.72 → CAD 138.89');
    r = await add(admin, { client_id: 'a4', amount: 3900, kind: 'income', note: 'salary', date: '2026-03-01' });
    ok(r.entry.category === 'Salary', 'income is classified among income categories');
    r = await add(admin, { client_id: 'a5', kind: 'transfer', amount: 500, account_id: me.accounts[1].id, to_account_id: me.accounts[0].id, note: 'pay card' });
    ok(r.entry && r.entry.kind === 'transfer' && r.entry.category === null, 'transfer saved without a category');
    r = await add(admin, { client_id: 'a6', kind: 'transfer', amount: 5, account_id: me.accounts[0].id, to_account_id: me.accounts[0].id });
    ok(r.error === 'From and to are the same account', 'transfer to the same account is refused (English message)');
    r = await add(admin, { client_id: 'a7', amount: -3, note: 'x' });
    ok(!!r.error, 'negative amount refused');
    r = await add(admin, { client_id: 'a8', amount: 1200, note: 'new laptop', one_time: true, date: '2026-03-10' });
    ok(r.entry.one_time === 1, 'one-off flag kept');
    await add(admin, { client_id: 'a9', amount: 2000, note: 'rent', date: '2026-03-01' });

    console.log('dashboards');
    const mo = (await admin('/api/dash/month?month=2026-03')).data;
    const g = mo.items.find(i => i.name === 'Groceries');
    ok(g && g.spent === 84.2 && mo.elapsed === 20, 'month dashboard sums groceries; day 20 of 31');
    ok(mo.oneTimeTotal === 1200 && !mo.items.some(i => i.name === 'Electronics' && i.spent > 0), 'one-off kept out of category bars');
    ok(mo.income === 3900, 'income total');
    const yr = (await admin('/api/dash/year?y=2026')).data;
    ok(yr.spent === 84.2 + 20 + 138.89 + 1200 + 2000 && yr.annualBudget > 0, 'year totals include one-offs', yr.spent);
    ok((await admin('/api/dash/quarter?y=2026&q=1')).data.items.length > 0, 'quarter dashboard works');

    console.log('roles');
    const login = async (c, name, pin) => (await c('/api/login', { method: 'POST', body: { name, pin } })).status;
    ok(await login(kid, 'Mia', s.data.pins.Mia) === 200, 'kid logs in with the PIN from setup');
    ok((await kid('/api/dash/month')).status === 403, 'personal account cannot see family dashboards');
    r = await add(kid, { client_id: 'k1', amount: 4.5, note: 'ice cream', date: '2026-03-12' });
    ok(r.entry.for_whom === 'Mia', 'personal entries are always "for" themselves');
    ok((await kid('/api/entries?month=2026-03')).data.length === 1, 'kid only sees their own entries');
    ok((await kid('/api/entries/' + 1, { method: 'PUT', body: { amount: 1 } })).status === 403, "kid can't edit someone else's entry");
    ok((await kid('/api/admin/users')).status === 403, 'kid cannot use admin API');
    const zh = await kid('/api/admin/users', { lang: 'zh' });
    ok(zh.data.error === '只有管理员能改', 'error messages follow the X-Lang header');

    console.log('PIN lockout');
    const bad = client();
    for (let i = 0; i < 4; i++) await bad('/api/login', { method: 'POST', body: { name: 'Sam', pin: '0000' } });
    const fifth = await bad('/api/login', { method: 'POST', body: { name: 'Sam', pin: '0000' } });
    ok(fifth.status === 401 && /locked/.test(fifth.data.error), '5 wrong PINs → locked');
    ok(await login(bad, 'Sam', s.data.pins.Sam) === 429, 'even the right PIN is refused while locked');

    console.log('bills');
    ok((await admin('/api/admin/bill', { method: 'POST', body: { name: 'Internet', category: 'Internet & Phone', amount: 70, day: 12 } })).status === 200, 'admin adds a bill');
    let bs = (await admin('/api/bills/status')).data;
    ok(bs.due.length === 1 && bs.due[0].name === 'Internet', 'bill due on day 12 shows on day 20');
    const rec = await admin(`/api/bills/${bs.due[0].id}/record`, { method: 'POST', body: {} });
    ok(rec.data.entry && rec.data.entry.amount === 70 && rec.data.entry.category === 'Internet & Phone', 'one tap records it');
    bs = (await admin('/api/bills/status')).data;
    ok(bs.due.length === 0 && bs.done.includes('Internet'), 'then it is marked done for the month');

    console.log('admin');
    const nu = await admin('/api/admin/user', { method: 'POST', body: { name: 'Grandpa', role: 'recorder' } });
    ok(nu.status === 200 && /^\d{4}$/.test(nu.data.pin), 'admin adds a person, gets a starting PIN');
    ok((await admin('/api/admin/category', { method: 'POST', body: { name: 'Woodworking', daily: false } })).status === 200, 'admin adds a category');
    ok((await admin('/api/admin/settings', { method: 'POST', body: { rates: { USD: 0.75, EUR: 0.68 } } })).status === 200 && (await admin('/api/me')).data.currencies.join() === 'CAD,USD,EUR', 'admin edits currencies');
    const din = (await admin('/api/entries?month=2026-03')).data.find(e => e.note === 'dinner downtown');
    const n1 = (await admin('/api/entries/' + din.id, { method: 'PUT', body: { note: 'dinner downtown w/ Sam', amount: 100, currency: 'USD' } })).data;
    ok(n1.home === 138.89, 'editing only the note keeps the old exchange rate (still CAD 138.89)', JSON.stringify(n1.home));
    const n2 = (await admin('/api/entries/' + din.id, { method: 'PUT', body: { amount: 150 } })).data;
    ok(n2.home === 200, 'changing the amount converts at today’s rate (USD 150 at 0.75 → CAD 200)', JSON.stringify(n2.home));

    console.log('upgrades');
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(path.join(dir, 't.db'), { readOnly: true });
    ok(raw.prepare('PRAGMA user_version').get().user_version === 1, 'database records its schema version');
    raw.close();
  } catch (e) { fail++; console.error(e); }
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
