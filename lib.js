// Tally — database, auto-categorization and dashboard math (shared by server.js and scripts/).
// Uses only what ships with Node: node:sqlite (database) and node:crypto (PIN hashing). No npm packages.
'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_DB = path.join(ROOT, 'data', 'tally.db');
const DB_PATH = process.env.TALLY_DB ? path.resolve(process.env.TALLY_DB) : DEFAULT_DB;
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
  salt TEXT NOT NULL, pin_hash TEXT NOT NULL, default_account INTEGER, personal_budget REAL,
  fail_count INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, owner TEXT, currency TEXT NOT NULL,
  type TEXT DEFAULT 'bank', active INTEGER DEFAULT 1, sort REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY, grp TEXT, kind TEXT NOT NULL, budget REAL DEFAULT 0,
  variable INTEGER DEFAULT 1, quick INTEGER DEFAULT 0, daily INTEGER DEFAULT 0, fallback INTEGER DEFAULT 0,
  fields TEXT, sort REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY, client_id TEXT UNIQUE, date TEXT NOT NULL, kind TEXT NOT NULL,
  amount REAL NOT NULL, currency TEXT NOT NULL, home REAL NOT NULL, category TEXT,
  account_id INTEGER, recorder_id INTEGER, for_whom TEXT DEFAULT '', note TEXT, one_time INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok', guess_conf REAL, source TEXT DEFAULT 'app',
  to_account_id INTEGER, via_account_id INTEGER, amount_in REAL, currency_in TEXT, details TEXT,
  created_at TEXT, updated_at TEXT, deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS rules (
  keyword TEXT NOT NULL, category TEXT NOT NULL, weight REAL NOT NULL, origin TEXT NOT NULL,
  PRIMARY KEY (keyword, category, origin));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, currency TEXT,
  day INTEGER NOT NULL, freq TEXT DEFAULT 'month', month INTEGER, account_id INTEGER,
  vary INTEGER DEFAULT 0, active INTEGER DEFAULT 1, last_period TEXT);
`);

// ---------- upgrades ----------
// Every database remembers its schema version (PRAGMA user_version). When a later version of Tally needs to
// change the tables, add ONE step to the end of MIGRATIONS (e.g. ALTER TABLE ... ADD COLUMN ...). Steps run
// once, in order, on older databases, each inside a transaction, after a safety copy of the file is saved.
// Never edit or remove a step that has been released.
const MIGRATIONS = [
  () => {},   // 1 — the tables above (first public release)
];
(function migrate() {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v > MIGRATIONS.length) throw new Error(`This database is from a newer version of Tally (schema ${v}). Update Tally (git pull) before opening it.`);
  if (v === MIGRATIONS.length) return;
  if (v > 0) {   // an existing household: keep a copy from before the upgrade
    const dir = DB_PATH === DEFAULT_DB ? path.join(ROOT, 'backups') : path.dirname(DB_PATH); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${path.basename(DB_PATH, '.db')}-before-upgrade-v${v}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  }
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { MIGRATIONS[i](); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
})();

const KINDS = ['expense', 'income', 'transfer'];
const ROLES = ['admin', 'member', 'recorder', 'personal'];
const ACCT_TYPES = ['bank', 'card', 'cash', 'agent'];   // agent = a person who helps you move/exchange money

// ---------- small helpers ----------
const pad = n => String(n).padStart(2, '0');
function today() {
  if (process.env.TALLY_TODAY && DB_PATH !== DEFAULT_DB) return process.env.TALLY_TODAY;   // only test/demo databases can fake the date
  const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowIso() { return new Date().toISOString(); }
function daysIn(y, m) { return new Date(y, m, 0).getDate(); }
const r2 = x => Math.round(x * 100) / 100;

function getSetting(k, dflt) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : dflt; }
function setSetting(k, v) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v)); }

function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function newPin() { return String(crypto.randomInt(0, 10000)).padStart(4, '0'); }

// ---------- currencies ----------
// home = the currency everything is totalled in. rates[X] = how many X one unit of home currency buys.
function homeCurrency() { return getSetting('home_currency', 'USD'); }
function rates() { return getSetting('rates', {}); }
function currencies() { return [homeCurrency(), ...Object.keys(rates())]; }
function validCur(c) { return currencies().includes(c) ? c : homeCurrency(); }
function toHome(amount, currency) {
  if (currency === homeCurrency()) return r2(amount);
  const r = rates()[currency];
  return r > 0 ? r2(amount / r) : r2(amount);
}

// ---------- first-run setup ----------
const TEMPLATES = ['en', 'zh'];
function loadTemplate(name) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', `categories.${TEMPLATES.includes(name) ? name : 'en'}.json`), 'utf8')); }
function needsSetup() { return !db.prepare('SELECT COUNT(*) n FROM users').get().n; }

function cleanName(s, max = 30) { return String(s || '').trim().slice(0, max); }

// Creates the household. Returns { adminId, pins: {name: pin} } (pins only for the extra members — the admin picked their own).
function setup(o) {
  if (!needsSetup()) throw new Error('already_setup');
  const lang = o.lang === 'zh' ? 'zh' : 'en';
  const name = cleanName(o.name);
  if (!name) throw new Error('name_required');
  if (!/^\d{4,6}$/.test(String(o.pin || ''))) throw new Error('pin_format');
  const home = /^[A-Z]{3}$/.test(o.home_currency || '') ? o.home_currency : 'USD';
  const extra = {};
  for (const c of o.extra_currencies || []) if (/^[A-Z]{3}$/.test(c.code || '') && c.code !== home && Number(c.rate) > 0) extra[c.code] = Number(c.rate);
  const members = (o.members || []).map(m => ({ name: cleanName(m.name), role: ROLES.includes(m.role) && m.role !== 'admin' ? m.role : 'member' }))
    .filter(m => m.name && m.name !== name);
  const tpl = loadTemplate(o.template || lang);
  const pins = {};
  db.exec('BEGIN');
  try {
    setSetting('lang', lang); setSetting('home_currency', home); setSetting('rates', extra);
    const ic = db.prepare('INSERT INTO categories(name,grp,kind,budget,variable,quick,daily,fallback,fields,sort) VALUES(?,?,?,?,?,?,?,?,?,?)');
    tpl.categories.forEach((c, i) => ic.run(c.name, c.grp || '', c.kind, o.zero_budgets ? 0 : (c.budget || 0), c.variable === false ? 0 : 1,
      c.quick ? 1 : 0, c.daily ? 1 : 0, c.fallback ? 1 : 0, c.fields ? JSON.stringify(c.fields) : null, i));
    const ia = db.prepare('INSERT INTO accounts(name,owner,currency,type,sort) VALUES(?,?,?,?,?)');
    ia.run(tpl.default_accounts.card, '', home, 'card', 1);
    ia.run(tpl.default_accounts.bank, '', home, 'bank', 2);
    ia.run(tpl.default_accounts.cash, '', home, 'cash', 3);
    const card = db.prepare("SELECT id FROM accounts WHERE type='card'").get().id;
    const iu = db.prepare('INSERT INTO users(name,role,salt,pin_hash,default_account) VALUES(?,?,?,?,?)');
    let salt = crypto.randomBytes(16).toString('hex');
    const adminId = iu.run(name, 'admin', salt, hashPin(o.pin, salt), card).lastInsertRowid;
    for (const m of members) {
      if (db.prepare('SELECT 1 FROM users WHERE name=?').get(m.name)) continue;
      salt = crypto.randomBytes(16).toString('hex'); const pin = o.member_pin || newPin(); pins[m.name] = pin;
      iu.run(m.name, m.role, salt, hashPin(pin, salt), card);
    }
    seedPresetRules(tpl);
    db.exec('COMMIT');
    return { adminId: Number(adminId), pins };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seedPresetRules(tpl) {
  db.prepare("DELETE FROM rules WHERE origin='preset'").run();
  const ins = db.prepare("INSERT OR REPLACE INTO rules(keyword,category,weight,origin) VALUES(?,?,?,'preset')");
  for (const c of tpl.categories) {
    for (const k of c.keywords || []) ins.run(String(k).toLowerCase(), c.name, 10);
    for (const k of c.strong || []) ins.run(String(k).toLowerCase(), c.name, 30);   // words that say *what* it was, beating words that only say *where*
  }
}

// ---------- auto-categorization ----------
function cleanNote(s) { return String(s || '').toLowerCase(); }
function tokens(text) {
  const t = cleanNote(text); const out = new Set();
  for (const w of t.match(/[a-z][a-z&']{2,}/g) || []) out.add(w);
  for (const run of t.match(/[一-鿿]+/g) || []) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));   // Chinese: overlapping 2-character pieces
  return [...out];
}

// Learn from history: a word that showed up 2+ times and 75%+ of the time in one category becomes a rule.
function rebuildLearnedRules() {
  db.prepare("DELETE FROM rules WHERE origin='history'").run();
  const rows = db.prepare("SELECT note, category FROM entries WHERE deleted=0 AND kind='expense' AND status='ok' AND note IS NOT NULL AND note<>''").all();
  const cnt = {};
  for (const r of rows) for (const tk of tokens(r.note)) (cnt[tk] ||= {})[r.category] = (cnt[tk][r.category] || 0) + 1;
  const ins = db.prepare("INSERT OR REPLACE INTO rules(keyword,category,weight,origin) VALUES(?,?,?,'history')");
  let n = 0;
  for (const [tk, cats] of Object.entries(cnt)) {
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    const [best, bn] = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    if (bn >= 2 && bn / total >= 0.75) { ins.run(tk, best, Math.min(bn, 6)); n++; }
  }
  return n;
}

function classify(text, kind = 'expense') {
  const t = cleanNote(text);
  if (!t.trim()) return { category: null, confidence: 0, hits: [] };
  const valid = new Set(db.prepare('SELECT name FROM categories WHERE kind=?').all(kind).map(x => x.name));
  const scores = {}; const hits = [];
  for (const r of db.prepare("SELECT keyword, category, weight FROM rules WHERE origin IN ('preset','correction')").all())
    if (valid.has(r.category) && t.includes(r.keyword)) { scores[r.category] = (scores[r.category] || 0) + r.weight * (1 + r.keyword.length / 10); hits.push(r.keyword); }
  const tks = tokens(t);
  if (tks.length) {
    for (const r of db.prepare(`SELECT keyword, category, weight FROM rules WHERE origin='history' AND keyword IN (${tks.map(() => '?').join(',')})`).all(...tks))
      if (valid.has(r.category)) { scores[r.category] = (scores[r.category] || 0) + r.weight; hits.push(r.keyword); }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { category: null, confidence: 0, hits };
  const total = ranked.reduce((a, b) => a + b[1], 0);
  const [cat, top] = ranked[0];
  return { category: cat, confidence: r2((top / total) * Math.min(1, top / 8)), hits: [...new Set(hits)].slice(0, 5), alt: ranked.slice(1, 3).map(x => x[0]) };
}

// You changed the category → remember the words, so the same note lands right next time.
function learnCorrection(note, category) {
  const ins = db.prepare("INSERT INTO rules(keyword,category,weight,origin) VALUES(?,?,6,'correction') ON CONFLICT(keyword,category,origin) DO UPDATE SET weight=MIN(weight+2,20)");
  for (const w of (cleanNote(note).match(/[a-z][a-z&' ]{2,}[a-z]/g) || []).slice(0, 3)) ins.run(w.trim(), category);
  for (const run of (cleanNote(note).match(/[一-鿿]{2,6}/g) || []).slice(0, 3)) ins.run(run, category);
}

function fallbackCategory(kind) {
  const r = db.prepare('SELECT name FROM categories WHERE kind=? ORDER BY fallback DESC, sort DESC LIMIT 1').get(kind);
  return r ? r.name : null;
}

// ---------- details (optional extra fields per category: where, with whom, coach…) ----------
function cleanDetails(d) {
  if (!d || typeof d !== 'object') return null;
  const o = {}; for (const [k, v] of Object.entries(d)) { const t = String(v || '').trim().slice(0, 80); if (t) o[String(k).slice(0, 20)] = t; }
  return Object.keys(o).length ? JSON.stringify(o) : null;
}
// Quick-pick buttons under each detail field: values used before in this category, most frequent first
function detailSuggest(category, userId) {
  const rows = db.prepare(`SELECT details FROM entries WHERE deleted=0 AND category=? AND details IS NOT NULL ${userId ? 'AND recorder_id=?' : ''} ORDER BY date DESC LIMIT 300`)
    .all(...(userId ? [category, userId] : [category]));
  const cnt = {};
  for (const r of rows) { let o; try { o = JSON.parse(r.details); } catch { continue; }
    for (const [k, v] of Object.entries(o)) for (const part of String(v).split(/[、,]/)) { const t = part.trim(); if (t) ((cnt[k] ||= {})[t] = (cnt[k][t] || 0) + 1); } }
  return Object.fromEntries(Object.entries(cnt).map(([k, m]) => [k, Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0])]));
}

// ---------- entries ----------
function addEntry(user, e) {
  if (e.client_id) {
    const dup = db.prepare('SELECT * FROM entries WHERE client_id=?').get(e.client_id);
    if (dup) return { entry: dup, duplicate: true };
  }
  const amount = Number(e.amount);
  if (!(amount > 0)) throw new Error('amount_positive');
  const kind = KINDS.includes(e.kind) ? e.kind : 'expense';
  const currency = validCur(e.currency);
  let category = e.category || null, status = 'ok', conf = null;
  if (kind === 'transfer') category = null;
  else {
    const cats = db.prepare('SELECT name FROM categories WHERE kind=?').all(kind).map(x => x.name);
    if (category && !cats.includes(category)) category = null;
    if (!category) {
      const g = classify(e.note, kind);
      conf = g.confidence;
      category = g.category || fallbackCategory(kind);
      if (!g.category || g.confidence < 0.5) status = 'pending';
    }
  }
  let toAcc = null, viaAcc = null, amtIn = null, curIn = null;
  if (kind === 'transfer') {
    toAcc = Number(e.to_account_id) || null; viaAcc = Number(e.via_account_id) || null;
    if (!Number(e.account_id)) throw new Error('transfer_from');
    if (!toAcc) throw new Error('transfer_to');
    if (toAcc === Number(e.account_id)) throw new Error('transfer_same');
    curIn = currencies().includes(e.currency_in) ? e.currency_in : currency;
    amtIn = Number(e.amount_in) > 0 ? Number(e.amount_in) : (curIn === currency ? amount : null);
  }
  const forWhom = user.role === 'personal' ? user.name : cleanName(e.for_whom || '');
  const t = nowIso();
  const info = db.prepare(`INSERT INTO entries(client_id,date,kind,amount,currency,home,category,account_id,recorder_id,for_whom,note,one_time,status,guess_conf,source,created_at,updated_at,to_account_id,via_account_id,amount_in,currency_in,details)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.client_id || crypto.randomUUID(), /^\d{4}-\d\d-\d\d$/.test(e.date || '') ? e.date : today(),
    kind, amount, currency, toHome(amount, currency), category, Number(e.account_id) || user.default_account || null, user.id, forWhom,
    String(e.note || '').slice(0, 500), kind === 'transfer' ? 0 : (e.one_time ? 1 : 0), status, conf, e.source === 'bill' ? 'bill' : 'app', t, t, toAcc, viaAcc, amtIn, curIn, cleanDetails(e.details));
  return { entry: db.prepare('SELECT * FROM entries WHERE id=?').get(info.lastInsertRowid), duplicate: false };
}

function canEdit(user, entry) { return entry && (user.role === 'admin' || entry.recorder_id === user.id); }

function updateEntry(user, id, patch) {
  const old = db.prepare('SELECT * FROM entries WHERE id=? AND deleted=0').get(id);
  if (!canEdit(user, old)) throw new Error('no_permission');
  const n = { ...old };
  for (const k of ['date', 'category', 'account_id', 'for_whom', 'note', 'to_account_id', 'via_account_id']) if (patch[k] !== undefined) n[k] = patch[k];
  if (patch.currency !== undefined) n.currency = validCur(patch.currency);
  if (patch.currency_in !== undefined) n.currency_in = validCur(patch.currency_in);
  if (patch.amount_in !== undefined) n.amount_in = patch.amount_in === null || patch.amount_in === '' ? null : Number(patch.amount_in);
  if (patch.amount !== undefined) { n.amount = Number(patch.amount); if (!(n.amount > 0)) throw new Error('amount_positive'); }
  if (patch.one_time !== undefined) n.one_time = patch.one_time ? 1 : 0;
  // Re-convert only when the money itself changed. Fixing a note or category on an old entry must keep
  // the exchange rate it was recorded with; otherwise past reports drift whenever rates are updated.
  if (n.amount !== old.amount || n.currency !== old.currency) n.home = toHome(n.amount, n.currency);
  if (patch.category && patch.category !== old.category && n.note) learnCorrection(n.note, patch.category);
  if (patch.category || patch.confirm) n.status = 'ok';
  if (patch.details !== undefined) n.details = cleanDetails(patch.details);
  db.prepare(`UPDATE entries SET date=?,amount=?,currency=?,home=?,category=?,account_id=?,for_whom=?,note=?,one_time=?,status=?,updated_at=?,to_account_id=?,via_account_id=?,amount_in=?,currency_in=?,details=? WHERE id=?`)
    .run(n.date, n.amount, n.currency, n.home, n.category, n.account_id, n.for_whom || '', n.note, n.one_time, n.status, nowIso(), n.to_account_id, n.via_account_id, n.amount_in, n.currency_in, n.details, id);
  return db.prepare('SELECT * FROM entries WHERE id=?').get(id);
}

function deleteEntry(user, id) {
  const old = db.prepare('SELECT * FROM entries WHERE id=? AND deleted=0').get(id);
  if (!canEdit(user, old)) throw new Error('no_permission');
  db.prepare('UPDATE entries SET deleted=1, updated_at=? WHERE id=?').run(nowIso(), id);   // soft delete: the row stays and can be restored
  return true;
}

function listEntries(user, from, to) {
  let sql = `SELECT e.*, a.name AS account_name, ta.name AS to_name, va.name AS via_name, u.name AS recorder_name FROM entries e
    LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN accounts ta ON ta.id=e.to_account_id LEFT JOIN accounts va ON va.id=e.via_account_id LEFT JOIN users u ON u.id=e.recorder_id
    WHERE e.deleted=0 AND e.date>=? AND e.date<=?`;
  const args = [from, to];
  if (user.role === 'recorder' || user.role === 'personal') { sql += ' AND e.recorder_id=?'; args.push(user.id); }
  sql += " ORDER BY (e.status='pending') DESC, e.date DESC, e.id DESC";
  return db.prepare(sql).all(...args);
}

// Default account per category: the account this person used last time for it
function lastAccounts(user) {
  const out = {};
  for (const r of db.prepare(`SELECT category, account_id FROM entries WHERE deleted=0 AND kind='expense' AND recorder_id=? AND account_id IS NOT NULL
    AND category IS NOT NULL ORDER BY date, id`).all(user.id)) out[r.category] = r.account_id;
  return out;
}

// ---------- dashboards ----------
function monthRange(ym) { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${pad(daysIn(y, m))}`, y, m]; }

function monthDashboard(ym) {
  const [from, to, y, m] = monthRange(ym);
  const dim = daysIn(y, m);
  const td = today();
  const elapsed = td < from ? 0 : td > to ? dim : Number(td.slice(8));
  const pace = elapsed / dim;
  const cats = db.prepare("SELECT * FROM categories WHERE kind='expense' ORDER BY sort").all();
  const rows = db.prepare("SELECT category, date, home, one_time FROM entries WHERE deleted=0 AND kind='expense' AND date>=? AND date<=?").all(from, to);
  const weeks = [[1, 7], [8, 14], [15, 21], [22, 28], [29, dim]].filter(w => w[0] <= dim);
  const byCat = {}; const oneTime = [];
  for (const r of rows) {
    if (r.one_time) { oneTime.push(r); continue; }
    const c = (byCat[r.category] ||= { spent: 0, weeks: weeks.map(() => 0) });
    c.spent += r.home;
    const d = Number(r.date.slice(8)); c.weeks[weeks.findIndex(w => d >= w[0] && d <= w[1])] += r.home;
  }
  const ytdRows = Object.fromEntries(db.prepare("SELECT category, SUM(home) s FROM entries WHERE deleted=0 AND kind='expense' AND one_time=0 AND date>=? AND date<=? GROUP BY category").all(`${y}-01-01`, to).map(r => [r.category, r.s]));
  const alerts = [];
  const items = cats.map(c => {
    const s = byCat[c.name] || { spent: 0, weeks: weeks.map(() => 0) };
    const spent = r2(s.spent), budget = c.budget, expected = r2(budget * pace);
    let level = 'ok';
    if (budget <= 0) level = spent > 0 ? 'nobudget' : 'ok';
    else if (spent > budget) level = 'over';
    // early in the month one purchase looks "fast", so only flag from day 4 and once 40%+ is used; fixed costs only alert when over
    else if (c.variable && pace < 1 && elapsed >= 4 && spent > expected * 1.15 && spent > budget * 0.4) level = 'ahead';
    else if (c.variable && spent >= budget * 0.8) level = 'warn';
    const ytd = r2(ytdRows[c.name] || 0), yBudget = r2(budget * 12), ySoFar = r2(budget * m);
    // over this month but fine for the year so far → grey ("lumpy month"); over for the year too → red
    const yOver = budget > 0 && ytd > ySoFar;
    if (!yOver && level === 'over') level = 'overok';
    if (!yOver && level === 'ahead') level = 'aheadok';
    if (['over', 'overok', 'ahead', 'aheadok', 'warn'].includes(level))
      alerts.push({ level, cat: c.name, spent, budget, expected, left: r2(budget - spent), pct: budget ? Math.round(spent / budget * 100) : 0, ytd, ySoFar, yOver, m });
    return { name: c.name, grp: c.grp, variable: !!c.variable, daily: !!c.daily, budget, spent, left: r2(budget - spent), expected, level, weeks: s.weeks.map(r2),
      ytd, yBudget, yLeft: r2(yBudget - ytd), ySoFar, yOver };
  }).filter(x => x.budget > 0 || x.spent > 0);
  const budgetTotal = r2(cats.reduce((a, c) => a + c.budget, 0));
  const spentTotal = r2(items.reduce((a, c) => a + c.spent, 0));
  const income = r2(db.prepare("SELECT COALESCE(SUM(home),0) s FROM entries WHERE deleted=0 AND kind='income' AND date>=? AND date<=?").get(from, to).s);
  const pending = db.prepare("SELECT COUNT(*) n FROM entries WHERE deleted=0 AND status='pending' AND date>=? AND date<=?").get(from, to).n;
  const order = { over: 0, ahead: 1, warn: 2, aheadok: 3, overok: 4 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  // overall pace only compares costs that move day to day: rent is paid once on the 1st and is not "spending too fast"
  const vBudget = r2(cats.filter(c => c.variable).reduce((a, c) => a + c.budget, 0));
  const vSpent = r2(items.filter(i => i.variable).reduce((a, i) => a + i.spent, 0));
  if (elapsed >= 4 && pace < 1 && vSpent > vBudget * pace * 1.1) alerts.unshift({ level: 'ahead', cat: null, total: true, spent: vSpent, expected: r2(vBudget * pace), budget: vBudget });
  return { month: ym, days: dim, elapsed, pace: r2(pace), weeks: weeks.map(w => [w[0], w[1]]), budgetTotal, spentTotal, vBudget, vSpent,
    oneTimeTotal: r2(oneTime.reduce((a, r) => a + r.home, 0)), income, pending, alerts, items };
}

function sumByCat(from, to) {
  const out = {};
  for (const r of db.prepare("SELECT category, SUM(home) s FROM entries WHERE deleted=0 AND kind='expense' AND one_time=0 AND date>=? AND date<=? GROUP BY category").all(from, to)) out[r.category] = r2(r.s);
  return out;
}
function totals(from, to) {
  const g = (sql) => r2(db.prepare(sql).get(from, to).s);
  return { regular: g("SELECT COALESCE(SUM(home),0) s FROM entries WHERE deleted=0 AND kind='expense' AND one_time=0 AND date>=? AND date<=?"),
    oneTime: g("SELECT COALESCE(SUM(home),0) s FROM entries WHERE deleted=0 AND kind='expense' AND one_time=1 AND date>=? AND date<=?"),
    income: g("SELECT COALESCE(SUM(home),0) s FROM entries WHERE deleted=0 AND kind='income' AND date>=? AND date<=?") };
}

function quarterDashboard(y, q) {
  const months = [1, 2, 3].map(i => `${y}-${pad((q - 1) * 3 + i)}`);
  const from = `${months[0]}-01`, to = monthRange(months[2])[1];
  const pq = q === 1 ? [y - 1, 4] : [y, q - 1];
  const pFrom = `${pq[0]}-${pad((pq[1] - 1) * 3 + 1)}-01`, pTo = monthRange(`${pq[0]}-${pad(pq[1] * 3)}`)[1];
  const cur = sumByCat(from, to), prev = sumByCat(pFrom, pTo);
  const td = today();
  const overMonths = {};
  for (const ym of months) { if (`${ym}-01` > td) continue; for (const it of monthDashboard(ym).items) if (it.level === 'over' || it.level === 'overok') (overMonths[it.name] ||= []).push(Number(ym.slice(5))); }
  const cats = db.prepare("SELECT * FROM categories WHERE kind='expense' ORDER BY sort").all();
  const items = cats.map(c => ({ name: c.name, budget: r2(c.budget * 3), spent: cur[c.name] || 0, prev: prev[c.name] || 0, overMonths: overMonths[c.name] || [] }))
    .filter(x => x.budget > 0 || x.spent > 0 || x.prev > 0);
  const monthTotals = months.map(ym => { const [f, t] = monthRange(ym); return { month: ym, ...totals(f, t) }; });
  return { y, q, months, items, monthTotals, budgetTotal: r2(cats.reduce((a, c) => a + c.budget * 3, 0)),
    spentTotal: r2(Object.values(cur).reduce((a, b) => a + b, 0)), prevTotal: r2(Object.values(prev).reduce((a, b) => a + b, 0)),
    oneTimeTotal: totals(from, to).oneTime };
}

function yearDashboard(y) {
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
  const monthly = months.map(ym => { const [f, t] = monthRange(ym); return { month: ym, ...totals(f, t) }; });
  const from = `${y}-01-01`, to = `${y}-12-31`;
  const td = today();
  const elapsedFrac = td < from ? 0 : td > to ? 1 : (Date.parse(td) - Date.parse(from) + 86400000) / (Date.parse(to) - Date.parse(from) + 86400000);
  const annualBudget = r2(db.prepare("SELECT COALESCE(SUM(budget),0) s FROM categories WHERE kind='expense'").get().s * 12);
  const t = totals(from, to);
  const group = (col) => db.prepare(`SELECT COALESCE(${col},'') k, SUM(home) s FROM entries e LEFT JOIN accounts a ON a.id=e.account_id
    LEFT JOIN users u ON u.id=e.recorder_id WHERE e.deleted=0 AND e.kind='expense' AND e.date>=? AND e.date<=? GROUP BY k ORDER BY s DESC`).all(from, to).map(r => ({ k: r.k, s: r2(r.s) }));
  const byCat = Object.entries(sumByCat(from, to)).sort((a, b) => b[1] - a[1]).map(([k, s]) => ({ k, s }));
  const oneTimeList = db.prepare("SELECT date, category, home, note FROM entries WHERE deleted=0 AND kind='expense' AND one_time=1 AND date>=? AND date<=? ORDER BY home DESC").all(from, to)
    .map(r => ({ ...r, note: String(r.note || '').length > 60 ? String(r.note).slice(0, 60) + '…' : r.note }));
  const spent = r2(t.regular + t.oneTime);
  return { year: y, monthly, regular: t.regular, oneTime: t.oneTime, income: t.income, spent, annualBudget, expectedByNow: r2(annualBudget * elapsedFrac),
    elapsedFrac: r2(elapsedFrac), projected: elapsedFrac > 0.05 ? r2(spent / elapsedFrac) : null,
    byCat, byAccount: group('a.name'), byRecorder: group('u.name'), byForWhom: group("NULLIF(e.for_whom,'')"), oneTimeList };
}

function personalDashboard(user, ym) {
  const [from, to] = monthRange(ym);
  const rows = db.prepare("SELECT category, SUM(home) s FROM entries WHERE deleted=0 AND kind='expense' AND recorder_id=? AND date>=? AND date<=? GROUP BY category ORDER BY s DESC").all(user.id, from, to);
  return { month: ym, spent: r2(rows.reduce((a, r) => a + r.s, 0)), budget: user.personal_budget || null, byCat: rows.map(r => ({ k: r.category, s: r2(r.s) })) };
}

// ---------- daily backup (a full copy of the database; old ones are never deleted automatically) ----------
function dailyBackup() {
  if (DB_PATH !== DEFAULT_DB) return null;   // demo / test databases are not backed up
  const dir = path.join(ROOT, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `tally-${today()}.db`);
  if (fs.existsSync(f)) return null;
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  return f;
}

// ---------- recurring bills: a reminder card on the due day; you tap to record (never automatic) ----------
function billsDue() {
  const t = today(), ym = t.slice(0, 7), d = Number(t.slice(8)), m = Number(t.slice(5, 7));
  const list = db.prepare('SELECT b.*, a.name account_name FROM bills b LEFT JOIN accounts a ON a.id=b.account_id WHERE b.active=1 ORDER BY day').all();
  const already = db.prepare("SELECT id FROM entries WHERE deleted=0 AND kind='expense' AND category=? AND date LIKE ? AND ABS(home-?)<1 LIMIT 1");
  return list.filter(b => {
    if (b.last_period === ym) return false;
    if (b.freq === 'year' && b.month !== m) return false;
    const dim = daysIn(Number(t.slice(0, 4)), m);
    if (d < Math.min(b.day, dim)) return false;   // a bill due on the 31st shows on the last day of shorter months
    if (db.prepare('SELECT 1 FROM entries WHERE client_id=? AND deleted=0').get(`bill-${b.id}-${ym}`) || (!b.vary && b.amount > 0 && already.get(b.category, ym + '%', toHome(b.amount, b.currency || homeCurrency())))) {
      db.prepare('UPDATE bills SET last_period=? WHERE id=?').run(ym, b.id); return false;
    }
    return true;
  });
}
function recordBill(user, id, amount) {
  const b = db.prepare('SELECT * FROM bills WHERE id=?').get(id); if (!b) throw new Error('not_found');
  const ym = today().slice(0, 7);
  const r = addEntry(user, { client_id: `bill-${id}-${ym}`, date: `${ym}-${pad(Math.min(b.day, daysIn(...ym.split('-').map(Number))))}`, kind: 'expense',
    amount: amount || b.amount, currency: b.currency || homeCurrency(), category: b.category, account_id: b.account_id || user.default_account, note: b.name, source: 'bill' });
  db.prepare('UPDATE bills SET last_period=? WHERE id=?').run(ym, id);
  return r;
}
function billsStatus() {
  const due = billsDue(), t = today(), ym = t.slice(0, 7), d = Number(t.slice(8)), m = Number(t.slice(5, 7));
  const list = db.prepare('SELECT * FROM bills WHERE active=1 ORDER BY day').all().filter(b => b.freq !== 'year' || b.month === m);
  return { due, done: list.filter(b => b.last_period === ym).map(b => b.name),
    upcoming: list.filter(b => b.last_period !== ym && d < b.day).map(b => ({ name: b.name, day: b.day, amount: b.amount, currency: b.currency || homeCurrency() })) };
}
function skipBill(id) { db.prepare('UPDATE bills SET last_period=? WHERE id=?').run(today().slice(0, 7), id); }

module.exports = { db, DB_PATH, KINDS, ROLES, ACCT_TYPES, today, getSetting, setSetting, hashPin, newPin, homeCurrency, rates, currencies, toHome,
  needsSetup, setup, loadTemplate, seedPresetRules, classify, rebuildLearnedRules, fallbackCategory, detailSuggest, addEntry, updateEntry, deleteEntry,
  listEntries, lastAccounts, monthDashboard, quarterDashboard, yearDashboard, personalDashboard, dailyBackup, billsDue, recordBill, billsStatus, skipBill };
