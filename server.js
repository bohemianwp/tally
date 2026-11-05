// Tally server. By default it only listens on this computer (127.0.0.1); phones reach it through Tailscale (see README).
// Start: node --no-warnings server.js     Options: PORT=8787  HOST=127.0.0.1  TALLY_DB=data/tally.db
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./lib');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUB = path.join(__dirname, 'public');
const SESSION_DAYS = 180;
// Screenshots of the demo household only: auto-login as this user when the database was created by scripts/demo.js
const DEMO_USER = process.env.TALLY_DEMO_USER && L.getSetting('demo', false) ? process.env.TALLY_DEMO_USER : null;

if (!L.needsSetup()) { L.rebuildLearnedRules(); }
L.dailyBackup();
setInterval(() => { try { L.dailyBackup(); } catch (e) { console.error('backup failed', e.message); } }, 3600 * 1000);

// Error messages in both languages; the client tells us which one it is showing (X-Lang header)
const ERR = {
  en: { bad_request: 'Bad request', too_large: 'Request too large', unknown_user: 'No such person', locked: 'Too many wrong tries. Try again in {m} min',
    locked_now: '5 wrong tries — locked for 15 minutes', wrong_pin: 'Wrong PIN ({n} tries left)', login_first: 'Please log in', family_only: 'Only the admin and family members can see this',
    admin_only: 'Only the admin can change this', pin_format: 'PIN must be 4–6 digits', name_required: 'Please enter a name', already_setup: 'Tally is already set up',
    amount_positive: 'Amount must be more than 0', transfer_from: 'Pick the account the money leaves', transfer_to: 'Pick the account the money goes to',
    transfer_same: 'From and to are the same account', no_permission: "You can't change this entry", not_found: 'Not found', name_amount: 'Name and amount are required',
    name_taken: 'That name is already used', no_such_api: 'Unknown request', server: 'Server error: {e}' },
  zh: { bad_request: '请求格式不对', too_large: '请求太大', unknown_user: '没有这个人', locked: '输错太多次，{m} 分钟后再试', locked_now: '连续输错 5 次，锁 15 分钟',
    wrong_pin: '密码不对（还能试 {n} 次）', login_first: '请先登录', family_only: '只有管理员和家庭成员能看', admin_only: '只有管理员能改', pin_format: '密码要 4–6 位数字',
    name_required: '先填名字', already_setup: 'Tally 已经设置过了', amount_positive: '金额要大于 0', transfer_from: '转账要选转出账户', transfer_to: '转账要选转入账户',
    transfer_same: '转出和转入是同一个账户', no_permission: '没有权限改这一条', not_found: '找不到', name_amount: '名字和金额要填', name_taken: '这个名字已经有了',
    no_such_api: '没有这个功能', server: '服务器出错：{e}' },
};
function msg(req, code, vars = {}) {
  const lang = req.headers['x-lang'] === 'zh' ? 'zh' : req.headers['x-lang'] === 'en' ? 'en' : L.getSetting('lang', 'en');
  return (ERR[lang][code] || code).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) { reject(new Error('too_large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad_request')); } });
  });
}
function cookie(req, name) { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)')); return m && m[1]; }
const USER_COLS = 'id,name,role,default_account,personal_budget';
function currentUser(req) {
  if (DEMO_USER) return L.db.prepare(`SELECT ${USER_COLS} FROM users WHERE name=?`).get(DEMO_USER);
  const tok = cookie(req, 'tally_session'); if (!tok) return null;
  const s = L.db.prepare('SELECT * FROM sessions WHERE token=?').get(tok);
  if (!s || Date.now() - s.last_seen > SESSION_DAYS * 864e5) return null;
  L.db.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(Date.now(), tok);
  return L.db.prepare(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(s.user_id);
}
function startSession(userId) {
  const tok = crypto.randomBytes(32).toString('hex');
  L.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tok, userId, Date.now(), Date.now());
  return { 'Set-Cookie': `tally_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}` };
}
const ym = (s) => /^\d{4}-\d\d$/.test(s || '') ? s : L.today().slice(0, 7);
const isFamily = u => u.role === 'admin' || u.role === 'member';
const fail = (req, res, code, e) => send(res, code, { error: msg(req, e && e.message ? e.message : e) });

async function api(req, res, url) {
  const p = url.pathname, q = url.searchParams, m = req.method;
  if (m !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) return fail(req, res, 415, 'bad_request');

  // ---- first run ----
  if (p === '/api/setup' && m === 'GET') return send(res, 200, { needed: L.needsSetup(), lang: L.getSetting('lang', null) });
  if (p === '/api/setup' && m === 'POST') {
    try { const r = L.setup(await readBody(req)); L.rebuildLearnedRules(); return send(res, 200, { ok: true, pins: r.pins }, startSession(r.adminId)); }
    catch (e) { return fail(req, res, 400, e); }
  }
  if (L.needsSetup()) return send(res, 409, { error: 'setup_needed' });

  if (p === '/api/login-names' && m === 'GET') return send(res, 200, { names: L.db.prepare('SELECT name FROM users ORDER BY id').all().map(r => r.name), lang: L.getSetting('lang', 'en') });
  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req);
    const u = L.db.prepare('SELECT * FROM users WHERE name=?').get(String(b.name || ''));
    if (!u) return fail(req, res, 401, 'unknown_user');
    if (u.locked_until > Date.now()) return send(res, 429, { error: msg(req, 'locked', { m: Math.ceil((u.locked_until - Date.now()) / 60000) }) });
    const ok = crypto.timingSafeEqual(Buffer.from(L.hashPin(String(b.pin || ''), u.salt), 'hex'), Buffer.from(u.pin_hash, 'hex'));
    if (!ok) {
      const fc = u.fail_count + 1;
      L.db.prepare('UPDATE users SET fail_count=?, locked_until=? WHERE id=?').run(fc >= 5 ? 0 : fc, fc >= 5 ? Date.now() + 15 * 60000 : 0, u.id);
      return send(res, 401, { error: fc >= 5 ? msg(req, 'locked_now') : msg(req, 'wrong_pin', { n: 5 - fc }) });
    }
    L.db.prepare('UPDATE users SET fail_count=0, locked_until=0 WHERE id=?').run(u.id);
    return send(res, 200, { ok: true }, startSession(u.id));
  }

  const user = currentUser(req);
  if (!user) return fail(req, res, 401, 'login_first');

  if (p === '/api/logout' && m === 'POST') { L.db.prepare('DELETE FROM sessions WHERE token=?').run(cookie(req, 'tally_session')); return send(res, 200, { ok: true }, { 'Set-Cookie': 'tally_session=; Path=/; Max-Age=0' }); }
  if (p === '/api/me') return send(res, 200, {
    user, today: L.today(), lang: L.getSetting('lang', 'en'), home: L.homeCurrency(), rates: L.rates(), currencies: L.currencies(),
    accounts: L.db.prepare('SELECT id,name,owner,currency,type FROM accounts WHERE active=1 ORDER BY sort,id').all(), acctTypes: L.ACCT_TYPES,
    categories: L.db.prepare('SELECT name,grp,kind,budget,variable,quick,daily,fallback,fields FROM categories ORDER BY sort').all().map(c => ({ ...c, fields: c.fields ? JSON.parse(c.fields) : null })),
    lastAcct: L.lastAccounts(user),
    people: L.db.prepare('SELECT name FROM users ORDER BY id').all().map(r => r.name),
  });
  if (p === '/api/suggest') {   // the "frequent" buttons when recording: your own recent notes first, topped up with the household's
    const sql = `SELECT note, category, account_id, COUNT(*) n, MAX(date) d FROM entries WHERE deleted=0 AND source='app' AND kind='expense'
      AND note<>'' AND status='ok' AND date>=date('now','-120 day') AND recorder_id %s ? GROUP BY note, category ORDER BY n DESC, d DESC LIMIT 8`;
    const mine = L.db.prepare(sql.replace('%s', '=')).all(user.id);
    const others = mine.length < 8 ? L.db.prepare(sql.replace('%s', '<>')).all(user.id).map(r => ({ ...r, account_id: null })) : [];
    const seen = new Set(); const out = [];
    for (const r of [...mine, ...others]) if (!seen.has(r.note) && out.length < 8) { seen.add(r.note); out.push(r); }
    return send(res, 200, out);
  }
  if (p === '/api/classify' && m === 'POST') { const b = await readBody(req); return send(res, 200, L.classify(b.text, b.kind === 'income' ? 'income' : 'expense')); }
  if (p === '/api/entries' && m === 'POST') {
    const b = await readBody(req);
    const list = Array.isArray(b.entries) ? b.entries : [b];
    const out = list.map(e => { try { return { client_id: e.client_id, ...L.addEntry(user, e) }; } catch (err) { return { client_id: e.client_id, error: msg(req, err.message) }; } });
    return send(res, 200, { results: out });
  }
  if (p === '/api/entries' && m === 'GET') {
    const month = ym(q.get('month')); const [y, mo] = month.split('-').map(Number);
    return send(res, 200, L.listEntries(user, `${month}-01`, `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`));
  }
  const em = p.match(/^\/api\/entries\/(\d+)$/);
  if (em && m === 'PUT') { try { return send(res, 200, L.updateEntry(user, Number(em[1]), await readBody(req))); } catch (e) { return fail(req, res, 403, e); } }
  if (em && m === 'DELETE') { try { return send(res, 200, { ok: L.deleteEntry(user, Number(em[1])) }); } catch (e) { return fail(req, res, 403, e); } }
  if (p === '/api/details') return send(res, 200, L.detailSuggest(q.get('category') || '', user.role === 'personal' ? user.id : null));

  if (p === '/api/dash/personal') return send(res, 200, L.personalDashboard(user, ym(q.get('month'))));
  if ((p.startsWith('/api/dash/') || p.startsWith('/api/bills')) && !isFamily(user)) return fail(req, res, 403, 'family_only');
  if (p === '/api/dash/month') return send(res, 200, L.monthDashboard(ym(q.get('month'))));
  if (p === '/api/dash/quarter') {
    const t = L.today(); const y = Number(q.get('y')) || Number(t.slice(0, 4)); const qq = Math.min(4, Math.max(1, Number(q.get('q')) || Math.ceil(Number(t.slice(5, 7)) / 3)));
    return send(res, 200, L.quarterDashboard(y, qq));
  }
  if (p === '/api/dash/year') return send(res, 200, L.yearDashboard(Number(q.get('y')) || Number(L.today().slice(0, 4))));
  if (p === '/api/bills/status') return send(res, 200, L.billsStatus());
  const bm = p.match(/^\/api\/bills\/(\d+)\/(record|skip)$/);
  if (bm && m === 'POST') {
    const b = await readBody(req);
    try { if (bm[2] === 'skip') { L.skipBill(Number(bm[1])); return send(res, 200, { ok: true }); }
      return send(res, 200, L.recordBill(user, Number(bm[1]), Number(b.amount) || null)); } catch (e) { return fail(req, res, 400, e); }
  }

  if (p === '/api/pin' && m === 'POST') {
    const b = await readBody(req);
    if (!/^\d{4,6}$/.test(String(b.pin || ''))) return fail(req, res, 400, 'pin_format');
    const salt = crypto.randomBytes(16).toString('hex');
    L.db.prepare('UPDATE users SET salt=?, pin_hash=? WHERE id=?').run(salt, L.hashPin(b.pin, salt), user.id);
    return send(res, 200, { ok: true });
  }

  // ---- admin ----
  if (p.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return fail(req, res, 403, 'admin_only');
    const b = m === 'POST' ? await readBody(req) : {};
    if (p === '/api/admin/bills' && m === 'GET') return send(res, 200, L.db.prepare('SELECT * FROM bills ORDER BY active DESC, day').all());
    if (p === '/api/admin/bill' && m === 'POST') {
      const v = [String(b.name || '').trim(), String(b.category || ''), Number(b.amount) || 0, Math.min(31, Math.max(1, Number(b.day) || 1)), b.freq === 'year' ? 'year' : 'month',
        b.freq === 'year' ? Math.min(12, Math.max(1, Number(b.month) || 1)) : null, L.currencies().includes(b.currency) ? b.currency : L.homeCurrency(), b.vary ? 1 : 0, b.active === false ? 0 : 1];
      if (!v[0] || (!(v[2] > 0) && !v[7])) return fail(req, res, 400, 'name_amount');
      if (b.id) L.db.prepare('UPDATE bills SET name=?,category=?,amount=?,day=?,freq=?,month=?,currency=?,vary=?,active=? WHERE id=?').run(...v, Number(b.id));
      else L.db.prepare('INSERT INTO bills(name,category,amount,day,freq,month,currency,vary,active) VALUES(?,?,?,?,?,?,?,?,?)').run(...v);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/users' && m === 'GET') return send(res, 200, L.db.prepare('SELECT id,name,role,default_account,personal_budget FROM users ORDER BY id').all());
    if (p === '/api/admin/budget' && m === 'POST') {
      L.db.prepare('UPDATE categories SET budget=? WHERE name=?').run(Math.max(0, Number(b.budget) || 0), String(b.name));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/category' && m === 'POST') {
      const name = String(b.name || '').trim().slice(0, 30); if (!name) return fail(req, res, 400, 'name_required');
      if (L.db.prepare('SELECT 1 FROM categories WHERE name=?').get(name)) return fail(req, res, 400, 'name_taken');
      const sort = L.db.prepare('SELECT COALESCE(MAX(sort),0)+1 s FROM categories').get().s;
      L.db.prepare('INSERT INTO categories(name,grp,kind,budget,variable,quick,daily,sort) VALUES(?,?,?,?,?,?,?,?)').run(name, '', b.kind === 'income' ? 'income' : 'expense',
        Math.max(0, Number(b.budget) || 0), b.variable === false ? 0 : 1, b.quick ? 1 : 0, b.daily ? 1 : 0, sort);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/account' && m === 'POST') {
      const name = String(b.name || '').trim().slice(0, 40); if (!name) return fail(req, res, 400, 'name_required');
      try {
        if (b.id) L.db.prepare('UPDATE accounts SET name=?, active=? WHERE id=?').run(name, b.active === false ? 0 : 1, Number(b.id));
        else L.db.prepare('INSERT INTO accounts(name,owner,currency,type,sort) VALUES(?,?,?,?,?)').run(name, String(b.owner || ''),
          L.currencies().includes(b.currency) ? b.currency : L.homeCurrency(), L.ACCT_TYPES.includes(b.type) ? b.type : 'bank', b.type === 'agent' ? 50 : 30);
      } catch { return fail(req, res, 400, 'name_taken'); }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/user' && m === 'POST') {
      if (!b.id) {   // add a person
        const name = String(b.name || '').trim().slice(0, 30); if (!name) return fail(req, res, 400, 'name_required');
        if (L.db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) return fail(req, res, 400, 'name_taken');
        const pin = L.newPin(), salt = crypto.randomBytes(16).toString('hex');
        L.db.prepare('INSERT INTO users(name,role,salt,pin_hash,default_account) VALUES(?,?,?,?,?)').run(name, ['member', 'recorder', 'personal'].includes(b.role) ? b.role : 'member',
          salt, L.hashPin(pin, salt), user.default_account);
        return send(res, 200, { ok: true, pin });
      }
      if (b.personal_budget !== undefined) L.db.prepare('UPDATE users SET personal_budget=? WHERE id=?').run(b.personal_budget === null ? null : Number(b.personal_budget), Number(b.id));
      if (b.default_account !== undefined) L.db.prepare('UPDATE users SET default_account=? WHERE id=?').run(Number(b.default_account), Number(b.id));
      if (b.reset_pin) {
        const pin = L.newPin(), salt = crypto.randomBytes(16).toString('hex');
        L.db.prepare('UPDATE users SET salt=?, pin_hash=?, fail_count=0, locked_until=0 WHERE id=?').run(salt, L.hashPin(pin, salt), Number(b.id));
        L.db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(b.id));
        return send(res, 200, { ok: true, pin });
      }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/settings' && m === 'POST') {
      if (b.lang === 'en' || b.lang === 'zh') L.setSetting('lang', b.lang);
      if (b.rates && typeof b.rates === 'object') {
        const r = {}; for (const [k, v] of Object.entries(b.rates)) if (/^[A-Z]{3}$/.test(k) && k !== L.homeCurrency() && Number(v) > 0) r[k] = Number(v);
        L.setSetting('rates', r);
      }
      return send(res, 200, { ok: true });
    }
  }
  return fail(req, res, 404, 'no_such_api');
}

function serveStatic(req, res, url) {
  let f = path.normalize(path.join(PUB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: msg(req, 'server', { e: e.message }) }); }
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is already in use (another Tally, or another program). Try another port:  PORT=8790 npm start`); process.exit(1); }
  throw e;
});
server.listen(PORT, HOST, () => console.log(`Tally is running: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${L.needsSetup() ? '  (first run — open it to set up your household)' : ''}`));
