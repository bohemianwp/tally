// Tally — the phone app (one page, no framework). Strings live in i18n.js.
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, tab: null, month: null, q: null, year: null };

// ---------- language ----------
let LANG = 'en';
function pickLang(serverDefault) {
  let l = null; try { l = localStorage.getItem('tally_lang'); } catch {}
  LANG = l || serverDefault || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  if (!I18N[LANG]) LANG = 'en';
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
}
function t(key, vars = {}) {
  const s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return LANG === 'zh' ? `${y} 年 ${m} 月` : new Date(y, m - 1, 15).toLocaleString('en', { month: 'short', year: 'numeric' }); };
const mon = m => LANG === 'zh' ? `${m} 月` : new Date(2000, m - 1, 15).toLocaleString('en', { month: 'short' });
const forName = f => f ? f : t('family');

// ---------- money ----------
const SYM = { USD: '$', CAD: '$', AUD: '$', NZD: '$', CNY: '¥', JPY: '¥', EUR: '€', GBP: '£', HKD: 'HK$', TWD: 'NT$', SGD: 'S$', KRW: '₩', INR: '₹', CHF: 'CHF ', MXN: '$' };
const NOCENTS = ['JPY', 'KRW'];
const homeCur = () => (S.me && S.me.home) || 'USD';
const sym = c => { const h = homeCur(); if (c !== h && SYM[c] && SYM[c] === SYM[h]) return c === 'USD' ? 'US$' : c + ' '; return SYM[c] || c + ' '; };
const num = (n, d) => Math.abs(n).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n, d = 0) => (n < 0 ? '-' : '') + sym(homeCur()) + num(n, NOCENTS.includes(homeCur()) ? 0 : d);
const money2 = n => money(n, 2);
const fmtCur = (n, c) => (Number(n) < 0 ? '-' : '') + sym(c) + num(Number(n), NOCENTS.includes(c) ? 0 : 2);
const curList = () => S.me.currencies;
const curOptions = sel => curList().map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');

function acctOptions(selected, filter = () => true, emptyLabel) {
  const groups = {};
  for (const a of S.me.accounts.filter(filter)) (groups[a.type || 'bank'] ||= []).push(a);
  return (emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : '') + Object.entries(groups).map(([ty, list]) => `<optgroup label="${esc(t('at.' + ty))}">${list.map(a =>
    `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}${a.currency !== homeCur() ? ' · ' + a.currency : ''}</option>`).join('')}</optgroup>`).join('');
}
const acctById = id => S.me.accounts.find(a => a.id === Number(id));
const catOf = name => S.me.categories.find(c => c.name === name);

// ---------- sounds (synthesized in code, no audio files) ----------
let AC = null;
function soundOn() { try { return localStorage.getItem('tally_sound') !== 'off'; } catch { return true; } }
function audio() { if (!soundOn()) return null; try { AC ||= new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; } catch { return null; } }
function tone(ac, f, t0, dur, type = 'sine', vol = 0.25) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, ac.currentTime + t0);
  g.gain.setValueAtTime(0.0001, ac.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur);
  o.connect(g).connect(ac.destination); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dur + 0.05);
}
function noise(ac, t0, dur, from, to, vol = 0.2) {
  const n = ac.createBufferSource(), b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, ac.currentTime + t0); f.frequency.exponentialRampToValueAtTime(to, ac.currentTime + t0 + dur);
  g.gain.setValueAtTime(vol, ac.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur);
  n.buffer = b; n.connect(f).connect(g).connect(ac.destination); n.start(ac.currentTime + t0);
}
function playSound(ac, kind) {
  if (!ac) return;
  if (kind === 'expense') {        // cash register: drawer click + two bells
    noise(ac, 0, 0.06, 3000, 1500, 0.35);
    tone(ac, 2093, 0.05, 0.5, 'triangle', 0.22); tone(ac, 2637, 0.05, 0.5, 'sine', 0.12);
    tone(ac, 1568, 0.16, 0.7, 'triangle', 0.22); tone(ac, 3136, 0.16, 0.5, 'sine', 0.08);
  } else if (kind === 'income') { // rising notes
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(ac, f, i * 0.08, 0.35, 'sine', 0.2));
  } else {                       // transfer: a whoosh
    noise(ac, 0, 0.35, 600, 4000, 0.25); tone(ac, 880, 0.25, 0.25, 'sine', 0.1);
  }
}

// ---------- talking to the server ----------
async function call(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Lang': LANG }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 409 && data.error === 'setup_needed') { renderSetup(); throw new Error(t('setup.title')); }
  if (r.status === 401 && !path.includes('login')) { S.me = null; renderLogin(); throw new Error(data.error || 'login'); }
  if (!r.ok) throw new Error(data.error || t('err.http', { n: r.status }));
  return data;
}
function toast(msg, ms = 2200) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(el._h); el._h = setTimeout(() => el.hidden = true, ms); }

// ---------- offline queue: save on the phone first, upload when connected ----------
const QKEY = 'tally_queue';
function qGet() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } }
function qSet(a) { try { localStorage.setItem(QKEY, JSON.stringify(a)); } catch {} showSync(); }
function showSync() {
  const q = qGet(), n = q.filter(e => !e.err).length, f = q.length - n;
  $('#sync').textContent = [n ? t('sync.waiting', { n }) : '', f ? t('sync.notSaved', { n: f }) : ''].filter(Boolean).join(' · ');
}
let flushing = false;
async function flush() {
  // Entries the server refused (e.g. invalid amount) stay on the phone, marked with the reason, until the
  // person retries or discards them in the list. Nothing typed on the phone is ever dropped silently.
  const q = qGet().filter(e => !e.err); if (!q.length || flushing) return 0;
  flushing = true;
  try {
    const r = await call('/api/entries', { method: 'POST', body: { entries: q } });
    const done = new Set(r.results.filter(x => !x.error).map(x => x.client_id));
    const bad = new Map(r.results.filter(x => x.error).map(x => [x.client_id, x.error]));
    qSet(qGet().filter(e => !done.has(e.client_id)).map(e => bad.has(e.client_id) ? { ...e, err: bad.get(e.client_id) } : e));
    if (bad.size) toast(t('sync.failed', { n: bad.size, e: [...bad.values()][0] }), 5000);
    if ((bad.size || done.size) && S.me && S.tab === 'list') renderList();   // the list may have been drawn before this upload finished
    return done.size;
  } catch { return 0; } finally { flushing = false; }
}
window.addEventListener('online', () => flush().then(n => n && toast(t('sync.uploaded', { n }))));
setInterval(() => flush(), 30000);

// ---------- first run: set up the household ----------
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'CNY', 'HKD', 'TWD', 'JPY', 'SGD', 'KRW', 'INR', 'CHF', 'MXN'];
function renderSetup() {
  $('#tabs').hidden = true; $('#meBtn').hidden = true; $('#title').textContent = 'Tally';
  const guessHome = (Intl.NumberFormat().resolvedOptions().locale || '').endsWith('CA') ? 'CAD' : 'USD';
  const st = { members: [{ name: '', role: 'member' }] };
  const draw = () => {
    const keep = id => ($('#' + id) || {}).value;
    const v = { name: keep('sname') || '', pin: keep('spin') || '', home: keep('shome') || guessHome, cur2: keep('scur2') || '', rate: keep('srate') || '' };
    $('#app').innerHTML = `
      <div class="seg" id="slang" style="margin-bottom:12px">${[['en', 'English'], ['zh', '中文']].map(([k, n]) => `<button data-l="${k}" class="${LANG === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h2>${t('setup.title')}</h2><p class="muted small">${t('setup.intro')}</p>
      <div class="card"><h3 style="margin-top:0">${t('setup.you')}</h3>
        <label>${t('setup.yourName')}</label><input id="sname" value="${esc(v.name)}" autocomplete="off" placeholder="${t('setup.namePh')}">
        <label>${t('setup.pin')}</label><input id="spin" inputmode="numeric" autocomplete="off" value="${esc(v.pin)}" placeholder="${t('setup.pinPh')}">
        <p class="small muted">${t('setup.adminNote')}</p></div>
      <div class="card"><h3 style="margin-top:0">${t('setup.money')}</h3>
        <label>${t('setup.home')}</label><select id="shome">${CURRENCIES.map(c => `<option ${c === v.home ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <label>${t('setup.second')}</label>
        <div class="two"><select id="scur2"><option value="">${t('setup.none')}</option>${CURRENCIES.map(c => `<option ${c === v.cur2 ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <input id="srate" class="num" inputmode="decimal" value="${esc(v.rate)}" placeholder="${t('setup.ratePh')}"></div>
        <p class="small muted" id="srateNote"></p>
        <label class="check"><input type="checkbox" id="sbud" checked> ${t('setup.exampleBudgets')}</label></div>
      <div class="card"><h3 style="margin-top:0">${t('setup.family')}</h3><p class="small muted">${t('setup.familyNote')}</p>
        ${st.members.map((m, i) => `<div class="two" style="margin-top:8px"><input class="mname" data-i="${i}" value="${esc(m.name)}" placeholder="${t('setup.memberPh')}">
          <select class="mrole" data-i="${i}">${['member', 'recorder', 'personal'].map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${t('role.' + r)}</option>`).join('')}</select></div>`).join('')}
        <button class="btn ghost sm" id="sadd" style="margin-top:8px">${t('setup.addMember')}</button>
        <details style="margin-top:10px"><summary class="small">${t('setup.rolesHelp')}</summary><p class="small muted">${t('setup.rolesText')}</p></details></div>
      <button class="btn" id="sgo">${t('setup.create')}</button>`;
    const rateNote = () => { const c = $('#scur2').value; $('#srateNote').textContent = c ? t('setup.rateNote', { home: $('#shome').value, c }) : ''; $('#srate').hidden = !c; };
    $('#scur2').onchange = rateNote; $('#shome').onchange = rateNote; rateNote();
    $('#slang').querySelectorAll('button').forEach(b => b.onclick = () => { saveMembers(); LANG = b.dataset.l; try { localStorage.setItem('tally_lang', LANG); } catch {} pickLang(); draw(); });
    $('#sadd').onclick = () => { saveMembers(); st.members.push({ name: '', role: 'member' }); draw(); };
    $('#sgo').onclick = create;
  };
  const saveMembers = () => document.querySelectorAll('.mname').forEach(i => { st.members[i.dataset.i].name = i.value; st.members[i.dataset.i].role = document.querySelector(`.mrole[data-i="${i.dataset.i}"]`).value; });
  const create = async () => {
    saveMembers();
    const name = $('#sname').value.trim(), pin = $('#spin').value.trim(), c2 = $('#scur2').value, rate = Number($('#srate').value);
    if (!name) { toast(t('setup.needName')); return; }
    if (!/^\d{4,6}$/.test(pin)) { toast(t('setup.needPin')); return; }
    if (c2 && !(rate > 0)) { toast(t('setup.needRate')); return; }
    try {
      const r = await call('/api/setup', { method: 'POST', body: { lang: LANG, name, pin, home_currency: $('#shome').value, template: LANG,
        extra_currencies: c2 ? [{ code: c2, rate }] : [], members: st.members.filter(m => m.name.trim()), zero_budgets: !$('#sbud').checked } });
      const pins = Object.entries(r.pins || {});
      $('#app').innerHTML = `<h2>✓ ${t('setup.done')}</h2>
        ${pins.length ? `<div class="card"><p>${t('setup.pinsIntro')}</p>${pins.map(([n, p]) => `<div class="row"><b>${esc(n)}</b><b class="num">${p}</b></div>`).join('')}
          <p class="small muted">${t('setup.pinsNote')}</p></div>` : ''}
        <div class="card small">${t('setup.next')}</div>
        <button class="btn" id="sstart">${t('setup.start')}</button>`;
      $('#sstart').onclick = boot;
    } catch (e) { toast(e.message, 3500); }
  };
  draw();
}

// ---------- log in ----------
async function renderLogin() {
  $('#tabs').hidden = true; $('#meBtn').hidden = true; $('#title').textContent = 'Tally';
  let d;
  try { d = await call('/api/login-names'); } catch (e) { if (!$('#sgo')) $('#app').innerHTML = `<div class="card">${t('login.cantReach', { e: esc(e.message) })}</div>`; return; }
  pickLang(d.lang);
  $('#app').innerHTML = `<h2>${t('login.who')}</h2><div class="names">${d.names.map(n => `<button data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
  $('#app').querySelectorAll('.names button').forEach(b => b.onclick = () => renderPin(b.dataset.n));
}
function renderPin(name) {
  let pin = '';
  $('#app').innerHTML = `<h2>${t('login.pin', { name: esc(name) })}</h2><div class="dots" id="dots"></div><p class="center small" id="perr" style="color:var(--over)"></p>
    <div class="pinpad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'OK'].map(k => `<button data-k="${k}">${k === 'OK' ? t('login.ok') : k}</button>`).join('')}</div>
    <p class="center"><button class="btn ghost sm" id="back">${t('login.switch')}</button></p>`;
  $('#back').onclick = renderLogin;
  const upd = () => $('#dots').textContent = '●'.repeat(pin.length);
  $('#app').querySelectorAll('.pinpad button').forEach(b => b.onclick = async () => {
    const k = b.dataset.k;
    if (k === '←') pin = pin.slice(0, -1);
    else if (k !== 'OK' && pin.length < 6) pin += k;
    upd();
    if (k === 'OK') {
      try { await call('/api/login', { method: 'POST', body: { name, pin } }); await boot(); }
      catch (e) { pin = ''; upd(); $('#perr').textContent = e.message; }
    }
  });
}

// ---------- bottom tabs ----------
const TABS = {
  admin: [['home', '◉', 'tab.home'], ['list', '☰', 'tab.list'], ['report', '▤', 'tab.reports']],
  member: [['home', '◉', 'tab.home'], ['list', '☰', 'tab.list'], ['report', '▤', 'tab.reports']],
  recorder: [['home', '◉', 'tab.home'], ['list', '☰', 'tab.mine']],
  personal: [['home', '◉', 'tab.home'], ['list', '☰', 'tab.mine']],
};
const REPORTS = [['month', 'rep.month'], ['quarter', 'rep.quarter'], ['year', 'rep.year']];
function renderTabs() {
  const tabs = TABS[S.me.user.role];
  const on = k => S.tab === k || (k === 'report' && REPORTS.some(r => r[0] === S.tab));
  $('#tabs').innerHTML = tabs.map(([k, i, label]) => `<button data-k="${k}" class="${on(k) ? 'on' : ''}"><b>${i}</b>${t(label)}</button>`).join('');
  $('#tabs').hidden = false;
  $('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.k));
}
function go(tab) {
  if (tab === 'report') tab = S.rtab || 'month';
  if (REPORTS.some(r => r[0] === tab)) S.rtab = tab;
  S.tab = tab; try { sessionStorage.setItem('tally_tab', tab); } catch {}
  renderTabs(); window.scrollTo(0, 0);
  ({ home: renderHome, add: renderAdd, month: renderMonth, quarter: renderQuarter, year: renderYear, list: renderList, me: renderMe }[tab])();
}

async function boot() {
  let s; try { s = await (await fetch('/api/setup')).json(); } catch { s = {}; }
  if (s.needed) { pickLang(s.lang); return renderSetup(); }
  try { S.me = await call('/api/me'); } catch { return; }
  pickLang(S.me.lang);
  S.month ||= S.me.today.slice(0, 7);
  S.year ||= Number(S.me.today.slice(0, 4));
  S.q ||= [S.year, Math.ceil(Number(S.me.today.slice(5, 7)) / 3)];
  $('#title').textContent = `Tally · ${S.me.user.name}`;
  showSync(); flush();
  let tb = location.hash.slice(1) || null; if (!tb) try { tb = sessionStorage.getItem('tally_tab'); } catch {}
  $('#meBtn').hidden = false; $('#meBtn').onclick = () => go('me'); $('#meBtn').setAttribute('aria-label', t('tab.me'));
  const fam = ['admin', 'member'].includes(S.me.user.role);
  go(['home', 'list', 'me', 'add'].includes(tb) || (fam && REPORTS.some(r => r[0] === tb)) ? tb : 'home');
  if (location.hash === '#rec') openRecord();
}

// ---------- full form (used for transfers) ----------
function renderAdd(startKind) {
  const me = S.me, u = me.user;
  const st = { kind: 'expense', category: null, manual: false };
  const cats = k => me.categories.filter(c => c.kind === k);
  const forOpts = ['', ...me.people].map(p => `<option value="${esc(p)}">${esc(forName(p))}</option>`).join('');
  $('#app').innerHTML = `
    <div class="seg" id="kind">${['expense', 'income', 'transfer'].map(k => `<button data-k="${k}" class="${k === 'expense' ? 'on' : ''}">${t('k.' + k)}</button>`).join('')}</div>
    <label>${t('add.amount')}</label>
    <div class="amt-row"><input class="amount num" id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off">
      <select id="cur">${curOptions((acctById(u.default_account) || {}).currency || homeCur())}</select></div>
    <label>${t('add.noteLabel')}</label>
    <input id="note" autocomplete="off" placeholder="${t('add.notePh')}">
    <div class="guess" id="guess"></div>
    <div id="catbox"></div>
    <div class="two">
      <div><label id="acctLabel">${t('add.account')}</label><select id="acct">${acctOptions(u.default_account, a => a.type !== 'agent')}</select></div>
      <div id="forBox" ${u.role === 'personal' ? 'hidden' : ''}><label>${t('add.forWhom')}</label><select id="for">${forOpts}</select></div>
    </div>
    <div class="two">
      <div><label>${t('add.date')}</label><input type="date" id="date" value="${me.today}"></div>
      <div id="oneBox"><label class="check" style="margin-top:34px"><input type="checkbox" id="one"> ${t('add.oneTime')}</label></div>
    </div>
    <button class="btn" id="save">${t('add.save')}</button>
    <p class="small muted" style="margin-top:12px">${t('add.oneTimeNote')}</p>`;
  const drawCats = () => {
    const isX = st.kind === 'transfer';
    $('#acctLabel').textContent = isX ? t('add.fromAcct') : t('add.account');
    $('#forBox').hidden = isX || u.role === 'personal'; $('#oneBox').hidden = isX;
    if (isX) {
      $('#guess').innerHTML = '';
      $('#catbox').innerHTML = `
        <label>${t('add.via')}</label>
        <select id="via">${acctOptions(null, a => a.type === 'agent', t('add.viaNone'))}</select>
        <label>${t('add.toAcct')}</label><select id="to">${acctOptions(null, a => a.type !== 'agent', t('add.pick'))}</select>
        <label>${t('add.amountIn')}</label>
        <div class="amt-row"><input id="amtin" class="num" inputmode="decimal" placeholder="${t('add.amountInPh')}"><select id="curin">${curOptions(homeCur())}</select></div>
        <div class="guess" id="rate"></div>
        <p class="small muted">${t('add.transferNote')}</p>`;
      const showRate = () => {
        const a = Number($('#amt').value.replace(/[, $]/g, '')), b = Number($('#amtin').value.replace(/[, $]/g, ''));
        const ca = $('#cur').value, cb = $('#curin').value;
        $('#rate').innerHTML = ca !== cb && a > 0 && b > 0 ? t('add.actualRate', { a: ca, b: cb, r: (a / b).toFixed(4) }) : '';
      };
      $('#to').onchange = () => { const x = acctById($('#to').value); if (x) $('#curin').value = x.currency; showRate(); };
      $('#amtin').oninput = showRate; $('#curin').onchange = showRate; $('#amt').oninput = showRate; $('#cur').onchange = showRate;
      return;
    }
    const list = cats(st.kind);
    const quick = st.kind === 'expense' ? list.filter(c => c.quick) : list;
    const rest = list.filter(c => !quick.includes(c));
    $('#catbox').innerHTML = `<label>${t('add.category')} ${st.manual ? t('add.youPicked') : t('add.autoIfEmpty')}</label>
      <div class="chips">${quick.map(c => `<button class="chip ${st.category === c.name ? 'on' : ''}" data-c="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>
      ${rest.length ? `<select id="more" style="margin-top:8px"><option value="">${t('add.moreCats')}</option>${rest.map(c => `<option ${st.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}`;
    $('#catbox').querySelectorAll('.chip').forEach(b => b.onclick = () => { const same = st.category === b.dataset.c && st.manual; st.category = same ? null : b.dataset.c; st.manual = !same; drawCats(); guess(); });
    const more = $('#more'); if (more) more.onchange = () => { st.category = more.value || null; st.manual = !!more.value; drawCats(); guess(); };
  };
  let gt;
  const guess = () => {
    clearTimeout(gt);
    if (st.manual || st.kind === 'transfer') { $('#guess').innerHTML = ''; return; }
    gt = setTimeout(async () => {
      const text = $('#note').value.trim();
      if (!text) { $('#guess').innerHTML = ''; st.category = null; return; }
      try {
        const g = await call('/api/classify', { method: 'POST', body: { text, kind: st.kind } });
        if (st.manual) return;
        if (!g.category) { $('#guess').innerHTML = `<span class="muted">${t('add.unknown')}</span>`; st.category = null; return; }
        $('#guess').innerHTML = `${t('add.autoCat')} <b>${esc(g.category)}</b> <span class="muted">${g.confidence >= 0.5 ? '' : t('add.unsure')}</span>`;
      } catch { $('#guess').innerHTML = `<span class="muted">${t('add.offlineGuess')}</span>`; }
    }, 300);
  };
  $('#kind').querySelectorAll('button').forEach(b => b.onclick = () => {
    st.kind = b.dataset.k; st.category = null; st.manual = false;
    $('#kind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); drawCats(); guess();
  });
  $('#note').oninput = guess;
  if (startKind) setTimeout(() => { const b = $(`#kind button[data-k="${startKind}"]`); if (b) b.click(); }, 0);
  $('#acct').onchange = () => { const a = acctById($('#acct').value); if (a) $('#cur').value = a.currency; };
  drawCats();
  $('#save').onclick = async () => {
    const ac = audio();   // the sound has to be created during the tap, or phones stay silent
    const amount = Number($('#amt').value.replace(/[, $]/g, ''));
    if (!(amount > 0)) { toast(t('add.needAmount')); $('#amt').focus(); return; }
    if (st.kind === 'transfer' && !$('#to').value) { toast(t('add.needTo')); return; }
    if (st.kind !== 'transfer' && !curOk(Number($('#acct').value), $('#cur').value)) return;
    const e = { client_id: newId(), kind: st.kind, amount, currency: $('#cur').value,
      note: $('#note').value.trim(), category: st.manual ? st.category : null, account_id: Number($('#acct').value),
      for_whom: $('#for') ? $('#for').value : '', date: $('#date').value, one_time: $('#one').checked };
    if (st.kind === 'transfer') Object.assign(e, { to_account_id: Number($('#to').value), via_account_id: Number($('#via').value) || null,
      amount_in: Number($('#amtin').value.replace(/[, $]/g, '')) || null, currency_in: $('#curin').value });
    qSet([...qGet(), e]);
    playSound(ac, st.kind);
    const n = await flush();
    toast(n ? t('rec.saved', { a: fmtCur(amount, e.currency) }) : t('rec.savedOffline'));
    renderAdd();
  };
  setTimeout(() => $('#amt').focus(), 50);
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());

// ---------- home: "how much can we still spend this month" at a glance ----------
async function renderHome() {
  const app = $('#app'); const u = S.me.user;
  const fam = ['admin', 'member'].includes(u.role);
  app.innerHTML = `<p class="muted">${t('loading')}</p>`;
  const fab = `<button class="fab" id="fab">＋ ${t('home.record')}</button>`;
  try {
    if (!fam) {
      const d = await call('/api/dash/personal');
      const left = d.budget ? d.budget - d.spent : null;
      app.innerHTML = `<div class="hero">
          <div class="hk">${left !== null ? t(u.role === 'personal' ? 'home.allowanceLeft' : 'home.budgetLeft') : t('home.youRecorded')}</div>
          <div class="hv num">${money(left !== null ? left : d.spent)}</div>
          ${d.budget ? bar(d.spent, d.budget, 0, d.spent > d.budget ? 'over' : d.spent > d.budget * .8 ? 'warn' : 'ok', true) + `<div class="hk">${t('home.spentOf', { s: money2(d.spent), b: money(d.budget) })}</div>` : ''}
        </div>${fab}
        ${d.byCat.length ? `<h3>${t('home.whereWent')}</h3><div class="card">${kList(d.byCat)}</div>` : `<p class="muted center">${t('home.nothingYet')}</p>`}`;
    } else {
      const d = await call('/api/dash/month');
      // the big number only counts everyday spending; lumpy planned costs (kids, travel) get their own block, otherwise "per day" is meaningless
      const daily = d.items.filter(i => i.daily), plan = d.items.filter(i => i.variable && !i.daily);
      const dB = daily.reduce((a, i) => a + i.budget, 0), dS = daily.reduce((a, i) => a + i.spent, 0);
      const left = dB - dS, daysLeft = Math.max(1, d.days - d.elapsed + 1);
      const lv = left < 0 ? 'over' : d.elapsed >= 4 && dS > dB * d.pace * 1.1 ? 'ahead' : 'ok';
      const hot = daily.filter(i => i.budget > 0 && i.spent > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget).slice(0, 4);
      const m = Number(d.month.slice(5));
      app.innerHTML = `<div class="hero ${lv}">
          <div class="hk">${t(left >= 0 ? 'home.canSpend' : 'home.overBy', { m: mon(m) })}</div>
          <div class="hv num">${money(Math.abs(left))}</div>
          ${bar(dS, dB, d.pace, lv, true)}
          <div class="hk">${left >= 0 ? t('home.perDay', { n: daysLeft, a: money(left / daysLeft) }) : t('home.goEasy')}</div>
          <div class="hk small" style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px">${t('home.dailyOnly', { list: daily.map(i => esc(i.name)).join(t('sep')), b: money(dB) })}</div>
        </div>${fab}
        <div id="nudges"></div>
        ${plan.length ? `<h3>${t('home.planned')} <span class="small muted">${t('home.plannedNote')}</span></h3>
        <div class="card">${plan.map(i => `<div style="margin-top:8px"><div class="row"><span>${esc(i.name)}</span><span class="num small">${i.spent > 0 ? t('home.thisMonth', { s: money(i.spent), b: money(i.budget) }) : t('home.notYet', { b: money(i.budget) })}</span></div>
            <div class="row small muted"><span>${t('home.ytd', { s: money(i.ytd), b: money(i.yBudget) })}</span><span class="num" style="color:${i.yLeft < 0 ? 'var(--over)' : 'var(--ok)'}">${i.yLeft >= 0 ? t('home.yLeft', { a: money(i.yLeft) }) : t('home.yOver', { a: money(-i.yLeft) })}</span></div>
            ${bar(i.ytd, i.yBudget, m / 12, i.yLeft < 0 ? 'over' : i.ytd > i.ySoFar ? 'ahead' : 'ok')}${i.yLeft >= 0 && i.ytd > i.ySoFar ? `<div class="small" style="color:var(--ahead)">${t('home.aheadOfYear', { m, a: money(i.ytd - i.ySoFar) })}</div>` : ''}</div>`).join('')}
          <p class="small muted" style="margin-top:8px">${t('home.plannedHelp')}</p></div>` : ''}
        ${hot.length ? `<h3>${t('home.hot')} <span class="small muted">${t('home.hotNote')}</span></h3>` : `<p class="muted center small">${t('home.noSpendYet')}</p>`}
        <div class="card" ${hot.length ? '' : 'hidden'}>${hot.map(i => `<div class="row" style="margin-top:4px"><span>${esc(i.name)}${LV[i.level] ? `<span class="tag ${i.level}">${t(LV[i.level])}</span>` : ''}</span>
            <span class="num small">${t(i.left >= 0 ? 'home.usedLeft' : 'home.usedOver', { p: Math.round(i.spent / i.budget * 100), a: money(Math.abs(i.left)) })}</span></div>${bar(i.spent, i.budget, d.pace, i.level)}`).join('')}
          <button class="btn ghost sm" id="all" style="margin-top:8px">${t('home.allCats')}</button></div>`;
      $('#all').onclick = () => go('month');
      const nd = $('#nudges');
      if (d.pending) nd.insertAdjacentHTML('beforeend', `<div class="card nudge" data-go="list">🟡 ${t('home.pending', { n: d.pending })}</div>`);
      nd.querySelectorAll('.nudge').forEach(n => n.onclick = () => go(n.dataset.go));
      try {   // recurring bills: a card when due; one quiet line for the rest
        const bs = await call('/api/bills/status'), due = bs.due;
        const parts = [...bs.done.map(n => esc(n) + ' ✓'), ...bs.upcoming.map(b => t('bills.on', { n: esc(b.name), d: b.day, a: fmtCur(b.amount, b.currency) }))];
        if (parts.length) nd.insertAdjacentHTML('beforeend', `<p class="small muted" style="margin:4px 2px">📅 ${t('bills.line')}${bs.done.length ? t('bills.doneThisMonth') : ''}${parts.join(' · ')}</p>`);
        for (const b of [...due].reverse()) {
          const c = document.createElement('div'); c.className = 'card';
          c.innerHTML = `<div class="row"><span>📅 <b>${esc(b.name)}</b> ${t(b.vary ? 'bills.billed' : 'bills.due', { d: b.day })}</span>${b.vary ? `<input class="num" inputmode="decimal" data-a="amt" style="width:110px;text-align:right;padding:6px" placeholder="${b.amount ? t('bills.last', { a: b.amount }) : t('bills.fromBill')}" value="">` : `<b class="num">${fmtCur(b.amount, b.currency)}</b>`}</div>
            ${b.vary ? `<div class="small muted">${t('bills.varyNote')}</div>` : ''}
            <div class="two" style="margin-top:8px"><button class="btn ghost sm" data-a="skip">${t('bills.skip')}</button><button class="btn sm" data-a="rec">${t('bills.record')}</button></div>`;
          c.querySelector('[data-a="rec"]').onclick = async () => { const ac = audio(); const amt = b.vary ? Number((c.querySelector('[data-a="amt"]') || {}).value) : b.amount;
            if (!(amt > 0)) { toast(t('bills.needAmount')); return; }
            try { await call(`/api/bills/${b.id}/record`, { method: 'POST', body: { amount: amt } }); playSound(ac, 'expense'); toast(t('rec.saved', { a: b.name + ' ' + fmtCur(amt, b.currency) })); renderHome(); } catch (e) { toast(e.message); } };
          c.querySelector('[data-a="skip"]').onclick = async () => { await call(`/api/bills/${b.id}/skip`, { method: 'POST', body: {} }); renderHome(); };
          nd.prepend(c);
        }
      } catch {}
    }
  } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)}</div>${fab}`; }
  $('#fab').onclick = () => openRecord();
}

const detailLine = d => { let o = d; if (typeof d === 'string') { try { o = JSON.parse(d); } catch { return ''; } } return o ? Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''; };

// ---------- record: big keypad + frequent notes, done in 5 seconds ----------
async function openRecord(kind = 'expense') {
  const me = S.me, u = me.user;
  const st = { kind, amt: '', cur: (acctById(u.default_account) || {}).currency || homeCur(), note: '', category: null, guessCat: null, det: {}, manual: false, acct: u.default_account, acctManual: false, date: me.today };
  const sh = $('#sheet'); sh.classList.add('full');
  const close = () => { sh.hidden = true; sh.innerHTML = ''; sh.classList.remove('full'); };
  const acctName = () => (acctById(st.acct) || {}).name || t('rec.pickAcct');
  sh.innerHTML = `<div class="panel rec">
    <div class="row"><button class="btn ghost sm" id="rx">✕ ${t('close')}</button>
      <div class="seg" id="rkind" style="width:170px">${['expense', 'income'].map(k => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${t('k.' + k)}</button>`).join('')}</div></div>
    <div class="amtdisp"><button id="rcur" class="curbtn">$</button><span id="ramt" class="num">0</span></div>
    <input id="rnote" autocomplete="off" placeholder="${t('rec.notePh')}">
    <div id="rguess" class="small muted" style="min-height:20px;margin-top:4px"></div>
    <div id="rdet" class="card" hidden style="padding:10px 12px;margin:4px 0 8px"></div>
    <div class="small muted" style="margin:2px 2px 4px">${t('rec.frequent')}</div>
    <div class="chips" id="rsug"></div>
    <div class="chips" style="margin-top:8px">
      <label class="chip sel">💳 <span id="racctl">${esc(acctName())}</span> ▾<select id="racct">${acctOptions(st.acct, a => a.type !== 'agent')}</select></label>
      <label class="chip sel">📅 <span id="rdatel">${t('today')}</span> ▾<input type="date" id="rdate" value="${st.date}"></label>
      <button class="chip" id="rmore">${t('rec.more')}</button>
    </div>
    <div id="rmorebox" hidden class="card">
      <label>${t('rec.catLabel')}</label><div class="chips" id="rcats"></div>
      <div class="two"><div ${u.role === 'personal' ? 'hidden' : ''}><label>${t('add.forWhom')}</label><select id="rfor">${['', ...me.people].map(p => `<option value="${esc(p)}">${esc(forName(p))}</option>`).join('')}</select></div>
        <div><label class="check" style="margin-top:30px"><input type="checkbox" id="rone"> ${t('rec.oneTime')}</label></div></div>
      ${u.role === 'personal' ? '' : `<button class="btn ghost sm" id="rxfer" style="margin-top:10px">${t('rec.isTransfer')}</button>`}
    </div>
    <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
    <button class="btn" id="rsave">${t('rec.save')}</button>
  </div>`;
  sh.hidden = false;
  $('#rx').onclick = close;
  const drawAmt = () => { $('#ramt').textContent = st.amt || '0'; $('#rcur').textContent = sym(st.cur).trim(); };
  sh.querySelectorAll('.keypad button').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === '⌫') st.amt = st.amt.slice(0, -1);
    else if (k === '.') { if (!st.amt.includes('.')) st.amt = (st.amt || '0') + '.'; }
    else if (!/\.\d\d$/.test(st.amt) && st.amt.replace('.', '').length < 8) st.amt = st.amt === '0' ? k : st.amt + k;
    drawAmt();
  });
  $('#rcur').onclick = () => { const cs = curList(); st.cur = cs[(cs.indexOf(st.cur) + 1) % cs.length]; drawAmt(); };
  sh.querySelectorAll('#rkind button').forEach(b => b.onclick = () => { st.kind = b.dataset.k; st.category = null; st.manual = false;
    sh.querySelectorAll('#rkind button').forEach(x => x.classList.toggle('on', x === b)); drawCats(); guess(); });
  $('#racct').onchange = () => { st.acctManual = true; st.acct = Number($('#racct').value); $('#racctl').textContent = acctName(); const a = acctById(st.acct); if (a) { st.cur = a.currency; drawAmt(); } };
  $('#rdate').onchange = () => { st.date = $('#rdate').value || me.today; $('#rdatel').textContent = st.date === me.today ? t('today') : st.date.slice(5); };
  $('#rmore').onclick = () => { $('#rmorebox').hidden = !$('#rmorebox').hidden; };
  const xf = $('#rxfer'); if (xf) xf.onclick = () => { close(); S.tab = 'add'; renderTabs(); renderAdd('transfer'); };
  const drawCats = () => {
    const list = me.categories.filter(c => c.kind === st.kind && (st.kind !== 'expense' || c.quick || c.name === st.category));
    const rest = me.categories.filter(c => c.kind === st.kind && !list.includes(c));
    $('#rcats').innerHTML = list.map(c => `<button class="chip ${st.manual && st.category === c.name ? 'on' : ''}" data-c="${esc(c.name)}">${esc(c.name)}</button>`).join('') +
      (rest.length ? `<select id="rcmore" style="margin-top:6px"><option value="">${t('add.moreCats')}</option>${rest.map(c => `<option>${esc(c.name)}</option>`).join('')}</select>` : '');
    $('#rcats').querySelectorAll('.chip').forEach(b => b.onclick = () => { const same = st.manual && st.category === b.dataset.c; st.category = same ? null : b.dataset.c; st.manual = !same; drawCats(); guess(); });
    const rm = $('#rcmore'); if (rm) rm.onchange = () => { if (rm.value) { st.category = rm.value; st.manual = true; drawCats(); guess(); } };
  };
  let gt;
  const guess = () => {
    clearTimeout(gt);
    if (st.manual) { $('#rguess').innerHTML = `${t('rec.cat')} <b>${esc(st.category)}</b>`; drawDet(); return; }
    gt = setTimeout(async () => {
      const text = $('#rnote').value.trim(); if (!text) { $('#rguess').textContent = ''; st.guessCat = null; drawDet(); return; }
      try { const g = await call('/api/classify', { method: 'POST', body: { text, kind: st.kind } });
        if (st.manual) return;
        st.guessCat = g.category && g.confidence >= .5 ? g.category : null; drawDet();
        $('#rguess').innerHTML = g.category ? `${t('rec.willGo')} <b>${esc(g.category)}</b>${g.confidence < .5 ? ' ' + t('add.unsure') : ''}` : t('rec.unknown');
      } catch { $('#rguess').textContent = t('rec.offline'); }
    }, 300);
  };
  $('#rnote').oninput = () => { st.note = $('#rnote').value; guess(); };
  const detCache = {};
  const drawDet = async () => {
    const box = $('#rdet'), cat = st.manual ? st.category : st.guessCat, c = catOf(cat), tpl = st.kind === 'expense' && c && c.fields;
    const la = (me.lastAcct || {})[cat];   // the card used last time for this category (only same currency, and only if you haven't picked one)
    if (st.kind === 'expense' && !st.acctManual && la && acctById(la) && la !== st.acct && acctById(la).currency === st.cur) {
      st.acct = la; $('#racct').value = la; $('#racctl').textContent = acctName(); }
    if (!tpl) { box.hidden = true; box.dataset.cat = ''; return; }
    if (box.dataset.cat === cat) return;   // same category → don't redraw, or we'd wipe what you're typing
    box.dataset.cat = cat; st.det = {};
    let hist = detCache[cat]; if (!hist) { try { hist = detCache[cat] = await call('/api/details?category=' + encodeURIComponent(cat)); } catch { hist = {}; } }
    if (box.dataset.cat !== cat) return;
    box.innerHTML = `<div class="small muted" style="margin-bottom:6px">📝 ${t('rec.details', { c: esc(cat) })}</div>` + tpl.map(([k, ph, pre], i) => {
      const opts = [...new Set([...(Array.isArray(pre) ? pre : []), ...(pre === 'who' ? me.people : []), ...(hist[k] || [])])].slice(0, 10);
      return `<div style="margin-top:${i ? 8 : 0}px"><input data-f="${esc(k)}" placeholder="${esc(k)}${ph ? ' (' + esc(ph) + ')' : ''}" style="padding:8px">
        ${opts.length ? `<div class="chips" style="margin-top:4px">${opts.map(o => `<button class="chip sm" data-f="${esc(k)}" data-v="${esc(o)}" data-multi="${pre === 'who' ? 1 : ''}">${esc(o)}</button>`).join('')}</div>` : ''}</div>`;
    }).join('');
    box.hidden = false;
    const SEP = LANG === 'zh' ? '、' : ', ';
    box.querySelectorAll('input[data-f]').forEach(i => i.oninput = () => { st.det[i.dataset.f] = i.value; });
    box.querySelectorAll('button[data-v]').forEach(b => b.onclick = () => {
      const inp = box.querySelector(`input[data-f="${CSS.escape(b.dataset.f)}"]`);
      if (b.dataset.multi) { const cur = inp.value.split(/[、,]/).map(x => x.trim()).filter(Boolean); const i = cur.indexOf(b.dataset.v); i >= 0 ? cur.splice(i, 1) : cur.push(b.dataset.v); inp.value = cur.join(SEP); }
      else inp.value = inp.value === b.dataset.v ? '' : b.dataset.v;
      st.det[b.dataset.f] = inp.value;
      box.querySelectorAll(`button[data-f="${CSS.escape(b.dataset.f)}"]`).forEach(x => x.classList.toggle('on', inp.value.split(/[、,]/).map(s => s.trim()).includes(x.dataset.v)));
    });
  };
  drawAmt(); drawCats();
  call('/api/suggest').then(list => {
    const fill = me.categories.filter(c => c.kind === 'expense' && c.quick && !list.some(x => x.category === c.name)).map(c => ({ note: c.name, category: c.name }));
    const sug = [...list, ...fill].slice(0, 8);
    $('#rsug').innerHTML = sug.map((x, i) => `<button class="chip" data-i="${i}">${esc(x.note)}</button>`).join('');
    $('#rsug').querySelectorAll('.chip').forEach(b => b.onclick = () => {
      const x = sug[Number(b.dataset.i)];
      $('#rnote').value = st.note = x.note; st.category = x.category; st.manual = true;
      if (x.account_id && acctById(x.account_id)) { st.acctManual = true; st.acct = x.account_id; $('#racct').value = x.account_id; $('#racctl').textContent = acctName(); }
      $('#rsug').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); drawCats(); guess();
    });
  }).catch(() => {});
  $('#rsave').onclick = async () => {
    const ac = audio();
    const amount = Number(st.amt);
    if (!(amount > 0)) { toast(t('rec.needAmount')); return; }
    if (!$('#rnote').value.trim() && !st.manual) { toast(t('rec.needNote'), 3000); $('#rmorebox').hidden = false; return; }
    if (!curOk(st.acct, st.cur)) { $('#rmorebox').hidden = false; return; }
    const e = { client_id: newId(), kind: st.kind, amount, currency: st.cur,
      note: $('#rnote').value.trim(), category: st.manual ? st.category : null, account_id: st.acct, for_whom: $('#rfor') ? $('#rfor').value : '',
      date: st.date, one_time: $('#rone').checked, details: st.kind === 'expense' && Object.values(st.det).some(v => String(v).trim()) ? st.det : null };
    qSet([...qGet(), e]); playSound(ac, st.kind); close();
    const n = await flush();
    let msg = n ? t('rec.saved', { a: fmtCur(amount, st.cur) }) : t('rec.savedOffline');
    if (n && st.kind === 'expense' && ['admin', 'member'].includes(u.role)) {
      try { const d = await call('/api/dash/month?month=' + e.date.slice(0, 7)); const last = (await call('/api/entries?month=' + e.date.slice(0, 7))).find(x => x.client_id === e.client_id);
        const it = last && d.items.find(i => i.name === last.category);
        if (it && it.budget > 0) msg += ' · ' + t(it.left >= 0 ? 'rec.catLeft' : 'rec.catOver', { c: it.name, a: money(Math.abs(it.left)) });
      } catch {}
    }
    toast(msg, 3500);
    if (S.tab === 'home') renderHome(); else if (S.tab === 'list') renderList();
  };
}

// ---------- reports ----------
function view() {
  const a = $('#app'); a.innerHTML = '';
  if (REPORTS.some(r => r[0] === S.tab)) {
    const seg = document.createElement('div'); seg.className = 'seg'; seg.style.marginBottom = '10px';
    seg.innerHTML = REPORTS.map(([k, label]) => `<button data-k="${k}" class="${S.tab === k ? 'on' : ''}">${t(label)}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.k));
    a.append(seg);
  }
  return a;
}
function monthNav(label, onPrev, onNext) {
  const d = document.createElement('div'); d.className = 'monthnav';
  d.innerHTML = `<button aria-label="previous">‹</button><b>${label}</b><button aria-label="next">›</button>`;
  d.children[0].onclick = onPrev; d.children[2].onclick = onNext; return d;
}
const shiftMonth = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
const LV = { over: 'lv.over', ahead: 'lv.ahead', warn: 'lv.warn', nobudget: 'lv.nobudget', overok: 'lv.overok', aheadok: 'lv.aheadok' };
function bar(spent, budget, pace, level, big) {
  const w = budget > 0 ? Math.min(100, spent / budget * 100) : (spent > 0 ? 100 : 0);
  return `<div class="bar ${big ? 'big' : ''} lv-${level}"><i style="width:${w}%"></i>${pace > 0 && pace < 1 ? `<s style="left:${pace * 100}%"></s>` : ''}</div>`;
}
function alertText(a) {
  if (a.total) return t('al.total', { s: money(a.spent), e: money(a.expected), b: money(a.budget) });
  const y = a.budget > 0 ? t(a.yOver ? 'al.yOver' : 'al.yOk', { m: a.m, s: money(a.ytd), b: money(a.ySoFar) }) : '';
  if (a.level === 'over' || a.level === 'overok') return t('al.over', { c: a.cat, a: money(a.spent - a.budget), b: money(a.budget) }) + y;
  if (a.level === 'ahead' || a.level === 'aheadok') return t('al.ahead', { c: a.cat, s: money(a.spent), e: money(a.expected) }) + y;
  return t('al.warn', { c: a.cat, p: a.pct, a: money(a.left) }) + y;
}
async function renderMonth() {
  const app = view();
  app.append(monthNav(monthName(S.month), () => { S.month = shiftMonth(S.month, -1); renderMonth(); }, () => { S.month = shiftMonth(S.month, 1); renderMonth(); }));
  const box = document.createElement('div'); box.innerHTML = `<p class="muted">${t('loading')}</p>`; app.append(box);
  let d; try { d = await call('/api/dash/month?month=' + S.month); } catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const m = Number(d.month.slice(5));
  const curWeek = d.elapsed > 0 && d.elapsed < d.days ? Math.min(4, Math.floor((d.elapsed - 1) / 7)) : -1;
  const lvTotal = d.vSpent > d.vBudget ? 'over' : (d.pace < 1 && d.elapsed >= 4 && d.vSpent > d.vBudget * d.pace * 1.1 ? 'ahead' : 'ok');
  const rank = { over: 0, ahead: 1, nobudget: 2, warn: 3, aheadok: 4, overok: 5, ok: 6 };
  const variable = d.items.filter(i => i.variable).sort((x, y) => rank[x.level] - rank[y.level] || (y.spent / (y.budget || 1)) - (x.spent / (x.budget || 1))), fixed = d.items.filter(i => !i.variable);
  const catCard = i => `<div class="card cat" data-n="${esc(i.name)}">
      <div class="row"><span class="grow">${esc(i.name)}${LV[i.level] ? `<span class="tag ${i.level}">${t(LV[i.level])}</span>` : ''}</span>
        <span class="num">${money(i.spent)} <span class="muted small">/ ${money(i.budget)}</span></span></div>
      ${bar(i.spent, i.budget, d.pace, i.level)}
      <div class="row small muted"><span>${i.left >= 0 ? t('m.left', { a: money(i.left) }) : t('m.over', { a: money(-i.left) })}</span>${i.variable && d.pace < 1 && i.budget > 0 ? `<span>${t('m.expected', { a: money(i.expected) })}</span>` : ''}</div>
      ${i.budget > 0 ? `<div class="row small ${i.yOver ? 'yover' : 'muted'}"><span>${t('m.ytd', { m, a: money(i.ytd) })}</span><span>${t('m.ytdBudget', { m, a: money(i.ySoFar) })}${i.yOver ? t('m.ytdOver', { a: money(i.ytd - i.ySoFar) }) : ''}</span></div>` : ''}
      <div class="weeks" hidden>${i.weeks.map((w, k) => `<div class="${k === curWeek ? 'now' : ''}"><div class="muted">${t('m.week', { a: d.weeks[k][0], b: d.weeks[k][1] })}</div><b class="num">${money(w)}</b></div>`).join('')}</div>
    </div>`;
  box.innerHTML = `
    <div class="card">
      <div class="row"><span>${t('m.everyday')}</span><span class="num"><b>${money(d.vSpent)}</b> <span class="muted">/ ${money(d.vBudget)}</span></span></div>
      ${bar(d.vSpent, d.vBudget, d.pace, lvTotal, true)}
      <div class="row small muted"><span>${t('m.day', { a: d.elapsed, b: d.days })}</span><span>${t('m.left', { a: money(d.vBudget - d.vSpent) })}</span></div>
      <div class="row small" style="margin-top:6px"><span>${t('m.withFixed')}</span><span class="num">${money(d.spentTotal)} <span class="muted">/ ${money(d.budgetTotal)}</span></span></div>
    </div>
    <div class="stat">
      <div class="card"><div class="k">${t('m.oneTime')}</div><div class="v num">${money(d.oneTimeTotal)}</div></div>
      <div class="card"><div class="k">${t('m.income')}</div><div class="v num">${money(d.income)}</div></div>
    </div>
    ${d.pending ? `<div class="card small" id="pend">🟡 ${t('m.pending', { n: d.pending })}</div>` : ''}
    ${d.alerts.length ? `<h2>⚠️ ${t('m.alerts')}</h2><div class="alerts">${d.alerts.map(a => `<div class="a ${a.level}">${esc(alertText(a))}</div>`).join('')}</div>` : `<p class="muted small">${t('m.noAlerts')}</p>`}
    <h2>${t('m.everyday')} <span class="small muted">${t('m.tapWeeks')}</span></h2>
    ${variable.map(catCard).join('') || `<p class="muted">${t('m.empty')}</p>`}
    ${fixed.length ? `<details><summary>${t('m.fixed', { n: fixed.length, s: money(fixed.reduce((a, i) => a + i.spent, 0)), b: money(fixed.reduce((a, i) => a + i.budget, 0)) })}</summary>${fixed.map(catCard).join('')}</details>` : ''}`;
  box.querySelectorAll('.cat').forEach(c => c.onclick = () => { const w = $('.weeks', c); w.hidden = !w.hidden; });
  const p = $('#pend', box); if (p) p.onclick = () => go('list');
}

async function renderQuarter() {
  const app = view();
  const [y, q] = S.q;
  app.append(monthNav(t('q.label', { y, q }), () => { S.q = q === 1 ? [y - 1, 4] : [y, q - 1]; renderQuarter(); }, () => { S.q = q === 4 ? [y + 1, 1] : [y, q + 1]; renderQuarter(); }));
  const box = document.createElement('div'); app.append(box);
  let d; try { d = await call(`/api/dash/quarter?y=${y}&q=${q}`); } catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const diff = d.spentTotal - d.prevTotal;
  const maxM = Math.max(1, ...d.monthTotals.map(m => m.regular + m.oneTime));
  box.innerHTML = `
    <div class="card"><div class="row"><span>${t('q.everyday')}</span><span class="num"><b>${money(d.spentTotal)}</b> <span class="muted">/ ${money(d.budgetTotal)}</span></span></div>
      ${bar(d.spentTotal, d.budgetTotal, 0, d.spentTotal > d.budgetTotal ? 'over' : 'ok', true)}
      <div class="row small muted"><span>${t('q.prev', { a: money(d.prevTotal) })}</span><span>${t(diff >= 0 ? 'q.more' : 'q.less', { a: money(Math.abs(diff)) })}</span></div></div>
    <div class="card"><h3 style="margin-top:0">${t('q.byMonth')}</h3>
      ${d.monthTotals.map(m => `<div class="list-k"><span>${mon(Number(m.month.slice(5)))}</span><span class="num">${money(m.regular)}${m.oneTime ? ` <span class="tag onetime">${t('q.plusOne', { a: money(m.oneTime) })}</span>` : ''}</span></div>
        <div class="hbar" style="width:${(m.regular + m.oneTime) / maxM * 100}%"></div>`).join('')}
      <p class="small muted">${t('q.oneTimeNote', { a: money(d.oneTimeTotal) })}</p></div>
    <h2>${t('q.byCat')}</h2>
    <div class="card"><table><tr><th>${t('q.cat')}</th><th>${t('q.spent')}</th><th>${t('q.budget')}</th><th>${t('q.prevQ')}</th></tr>
      ${d.items.sort((a, b) => b.spent - a.spent).map(i => `<tr><td>${esc(i.name)}${i.overMonths.length ? `<span class="tag over">${t('q.overIn', { m: i.overMonths.map(mon).join(t('sep')) })}</span>` : ''}</td>
        <td style="${i.budget && i.spent > i.budget ? 'color:var(--over)' : ''}">${money(i.spent)}</td><td class="muted">${money(i.budget)}</td><td class="muted">${money(i.prev)}</td></tr>`).join('')}
    </table><p class="small muted">${t('q.overHelp')}</p></div>`;
}

function yearChart(monthly, avg) {
  const W = 340, H = 150, pad = 22, bw = (W - pad) / 12;
  const max = Math.max(avg * 1.3, ...monthly.map(m => m.regular + m.oneTime)) || 1;
  const y = v => H - 16 - v / max * (H - 26);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t('y.chartLabel')}">`;
  monthly.forEach((m, i) => {
    const x = pad + i * bw + 3, w = bw - 6;
    s += `<rect x="${x}" y="${y(m.regular)}" width="${w}" height="${H - 16 - y(m.regular)}" rx="2" fill="var(--accent)"><title>${m.month} ${money(m.regular)}</title></rect>`;
    if (m.oneTime) s += `<rect x="${x}" y="${y(m.regular + m.oneTime)}" width="${w}" height="${y(m.regular) - y(m.regular + m.oneTime)}" rx="2" fill="var(--onetime)"><title>${money(m.oneTime)}</title></rect>`;
    s += `<text x="${x + w / 2}" y="${H - 3}" text-anchor="middle">${i + 1}</text>`;
  });
  if (avg > 0) { const by = y(avg); s += `<line x1="${pad}" x2="${W}" y1="${by}" y2="${by}" stroke="var(--pace)" stroke-dasharray="3 3" opacity=".6"/><text x="${pad - 2}" y="${by + 3}" text-anchor="end">${t('y.avg')}</text>`; }
  return s + '</svg>';
}
function kList(arr, total, label = x => x) {
  const max = Math.max(1, ...arr.map(a => a.s));
  return arr.map(a => `<div class="list-k"><span>${esc(label(a.k))}</span><span class="num">${money(a.s)}${total ? ` <span class="muted small">${Math.round(a.s / total * 100)}%</span>` : ''}</span></div><div class="hbar" style="width:${a.s / max * 100}%"></div>`).join('');
}
async function renderYear() {
  const app = view();
  app.append(monthNav(String(S.year), () => { S.year--; renderYear(); }, () => { S.year++; renderYear(); }));
  const box = document.createElement('div'); app.append(box);
  let d; try { d = await call('/api/dash/year?y=' + S.year); } catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const lv = d.spent > d.annualBudget ? 'over' : d.spent > d.expectedByNow * 1.1 ? 'ahead' : 'ok';
  box.innerHTML = `
    <div class="card"><div class="row"><span>${t('y.total')}</span><span class="num"><b>${money(d.spent)}</b> <span class="muted">/ ${money(d.annualBudget)}</span></span></div>
      ${bar(d.spent, d.annualBudget, d.elapsedFrac, lv, true)}
      <div class="row small muted"><span>${t('y.expected', { a: money(d.expectedByNow) })}</span>${d.projected ? `<span>${t('y.projected', { a: money(d.projected) })}</span>` : ''}</div></div>
    <div class="stat">
      <div class="card"><div class="k">${t('y.everyday')}</div><div class="v num">${money(d.regular)}</div></div>
      <div class="card"><div class="k">${t('m.oneTime')}</div><div class="v num">${money(d.oneTime)}</div></div>
      <div class="card"><div class="k">${t('y.income')}</div><div class="v num">${money(d.income)}</div></div>
      <div class="card"><div class="k">${t('y.net')}</div><div class="v num" style="color:${d.income - d.spent >= 0 ? 'var(--ok)' : 'var(--over)'}">${money(d.income - d.spent)}</div></div>
    </div>
    <div class="card">${yearChart(d.monthly, d.annualBudget / 12)}<p class="small muted">${t('y.chartNote', { a: money(d.annualBudget / 12) })}</p></div>
    <h2>${t('y.byCat', { n: d.byCat.length })}</h2><div class="card">${kList(d.byCat, d.regular) || `<p class="muted">${t('none')}</p>`}</div>
    <h2>${t('y.byAccount')}</h2><div class="card">${kList(d.byAccount, 0, k => k || t('y.noAccount'))}</div>
    <h2>${t('y.byRecorder')}</h2><div class="card">${kList(d.byRecorder)}</div>
    <h2>${t('y.byForWhom')}</h2><div class="card">${kList(d.byForWhom, 0, forName)}</div>
    <h2>${t('y.oneTimeList')}</h2><div class="card">${d.oneTimeList.map(o => `<div class="list-k"><span class="grow">${o.date.slice(5)} ${esc(o.category)} <span class="muted small">${esc(o.note)}</span></span><span class="num">${money(o.home)}</span></div>`).join('') || `<p class="muted">${t('none')}</p>`}</div>`;
}

// ---------- entries list ----------
async function renderList() {
  const app = $('#app'); app.innerHTML = '';
  app.append(monthNav(monthName(S.month), () => { S.month = shiftMonth(S.month, -1); renderList(); }, () => { S.month = shiftMonth(S.month, 1); renderList(); }));
  const box = document.createElement('div'); app.append(box);
  const q = qGet(), u = S.me.user;
  const rows = await call('/api/entries?month=' + S.month);
  const canEdit = e => u.role === 'admin' || e.recorder_id === u.id;
  const row = e => `<div class="entry" data-id="${e.id}">
      <div class="grow"><div>${esc(e.kind === 'transfer' ? t('k.transfer') : e.category || '')}${e.one_time ? `<span class="tag onetime">${t('l.oneTime')}</span>` : ''}</div>
        <div class="small muted">${esc(e.recorder_name || '')}${e.kind === 'transfer' && e.to_name ? ' · ' + esc(e.account_name) + (e.via_name ? ' → ' + esc(e.via_name) : '') + ' → ' + esc(e.to_name) : e.account_name ? ' · ' + esc(e.account_name) : ''}${e.for_whom ? ' · ' + t('l.for', { n: esc(e.for_whom) }) : ''}</div>
        ${e.note ? `<div class="small">${esc(String(e.note).slice(0, 60))}</div>` : ''}${e.details ? `<div class="small muted">${esc(detailLine(e.details))}</div>` : ''}</div>
      <div class="amt num ${e.kind === 'income' ? 'in' : ''}">${e.kind === 'transfer' ? `⇄ ${fmtCur(e.amount, e.currency)}${e.amount_in && e.currency_in !== e.currency ? `<div class="small muted">→ ${fmtCur(e.amount_in, e.currency_in)}</div>` : ''}`
        : `${e.kind === 'income' ? '+' : ''}${money2(e.home)}${e.currency !== homeCur() ? `<div class="small muted">${fmtCur(e.amount, e.currency)}</div>` : ''}`}</div>
    </div>`;
  // ① not recognized: fix the category right here with one tap
  const pend = rows.filter(e => e.status === 'pending');
  const fb = (S.me.categories.find(c => c.kind === 'expense' && c.fallback) || {}).name;
  const quick = S.me.categories.filter(c => c.kind === 'expense' && c.quick && c.name !== fb).map(c => c.name);
  const pendHtml = pend.length ? `<h3>🟡 ${t('l.pendingTitle', { n: pend.length })}</h3>` + pend.map(e => `<div class="card" data-p="${e.id}">
      <div class="row"><span>${esc(e.note || t('l.noNote'))} <span class="small muted">${e.date.slice(5)} · ${esc(e.recorder_name || '')}</span></span><b class="num">${money2(e.home)}</b></div>
      ${canEdit(e) ? `<div class="chips" style="margin-top:8px">${quick.map(c => `<button class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}${fb ? `<button class="chip" data-c="${esc(fb)}">${t('l.reallyMisc', { c: esc(fb) })}</button>` : ''}
        <button class="chip" data-more="1">${t('l.other')}</button></div>` : `<p class="small muted">${t('l.someoneElse')}</p>`}</div>`).join('') : '';
  // ② the rest grouped by day, with a daily total
  const rest = rows.filter(e => e.status !== 'pending'), byDay = {};
  for (const e of rest) (byDay[e.date] ||= []).push(e);
  const yd = (() => { const d = new Date(S.me.today + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  const dayLabel = d => d === S.me.today ? t('today') : d === yd ? t('yesterday') : new Date(d + 'T12:00:00').toLocaleDateString(LANG === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', weekday: 'short' });
  const daysHtml = Object.entries(byDay).map(([d, list]) => {
    const tot = list.filter(e => e.kind === 'expense').reduce((a, e) => a + e.home, 0);
    return `<div class="dayhdr"><span>${dayLabel(d)}</span>${tot ? `<span class="num">${money2(tot)}</span>` : ''}</div><div class="card" style="margin-top:4px">${list.map(row).join('')}</div>`;
  }).join('');
  const waiting = q.filter(e => !e.err), failed = q.filter(e => e.err);
  const failedHtml = failed.map(e => `<div class="card small" data-qf="${esc(e.client_id)}">⚠️ ${t('l.notSaved', { e: esc(e.err) })}
      <div style="margin-top:4px">${esc(e.date || '')} · ${fmtCur(e.amount, e.currency || homeCur())}${e.note ? ' · ' + esc(String(e.note).slice(0, 40)) : ''}</div>
      <div class="chips" style="margin-top:8px"><button class="chip" data-retry="1">${t('l.retry')}</button><button class="chip" data-drop="1">${t('l.discard')}</button></div></div>`).join('');
  box.innerHTML = (waiting.length ? `<div class="card small">📤 ${t('l.queued', { n: waiting.length })} <button class="btn sm" id="fl">${t('l.uploadNow')}</button></div>` : '') +
    failedHtml + pendHtml + (daysHtml || (pend.length ? '' : `<p class="muted center">${t('m.empty')}</p>`));
  const fl = $('#fl', box); if (fl) fl.onclick = async () => { const n = await flush(); if (n) toast(t('sync.uploaded', { n })); else if (qGet().some(e => !e.err)) toast(t('l.stillOffline')); renderList(); };
  box.querySelectorAll('[data-qf]').forEach(card => {
    const id = card.dataset.qf;
    card.querySelector('[data-retry]').onclick = async () => {
      qSet(qGet().map(e => { if (e.client_id !== id) return e; const { err, ...rest } = e; return rest; }));
      const n = await flush(); if (n) toast(t('sync.uploaded', { n })); renderList();
    };
    card.querySelector('[data-drop]').onclick = () => { qSet(qGet().filter(e => e.client_id !== id)); renderList(); };
  });
  box.querySelectorAll('.entry').forEach(el => el.onclick = () => editSheet(rows.find(r => r.id === Number(el.dataset.id))));
  box.querySelectorAll('[data-p]').forEach(card => {
    const e = rows.find(r => r.id === Number(card.dataset.p));
    card.querySelectorAll('.chip').forEach(b => b.onclick = async () => {
      if (b.dataset.more) return editSheet(e);
      try {
        await call('/api/entries/' + e.id, { method: 'PUT', body: b.dataset.c === e.category ? { confirm: true } : { category: b.dataset.c } });
        toast(e.note ? t('l.learned', { n: String(e.note).slice(0, 14), c: b.dataset.c }) : t('l.changed', { c: b.dataset.c }), 3000);
        renderList();
      } catch (err) { toast(err.message); }
    });
  });
}

// currency doesn't match the account → ask once before saving
function curOk(acctId, cur) {
  const a = acctById(acctId);
  if (!a || a.currency === cur) return true;
  return confirm(t('cur.mismatch', { a: a.name, ac: a.currency, c: cur }));
}
function editSheet(e) {
  const me = S.me, u = me.user;
  const can = u.role === 'admin' || e.recorder_id === u.id;
  const sh = $('#sheet');
  const cats = me.categories.filter(c => c.kind === e.kind);
  const dis = can ? '' : 'disabled';
  sh.innerHTML = `<div class="panel">
    <div class="row"><b>${t('k.' + e.kind)} ${money2(e.home)}</b><button class="btn ghost sm" id="x">${t('close')}</button></div>
    ${!can ? `<p class="small muted">${t('e.readOnly')}</p>` : ''}
    <label>${t('add.amount')}</label><div class="amt-row"><input id="eamt" class="num" inputmode="decimal" value="${e.amount}" ${dis}>
      <select id="ecur" ${dis}>${curOptions(e.currency)}</select></div>
    ${e.kind !== 'transfer' ? `<label>${t('add.category')}</label><select id="ecat" ${dis}>${cats.map(c => `<option ${c.name === e.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
    <label>${t('e.note')}</label><input id="enote" value="${esc(e.note || '')}" ${dis}>
    ${e.kind === 'transfer' ? `<label>${t('add.via')}</label><select id="evia" ${dis}>${acctOptions(e.via_account_id, a => a.type === 'agent', t('add.viaNone'))}</select>
      <label>${t('add.toAcct')}</label><select id="eto" ${dis}>${acctOptions(e.to_account_id, a => a.type !== 'agent', '—')}</select>
      <label>${t('e.amountIn')}</label><div class="amt-row"><input id="eamtin" class="num" inputmode="decimal" value="${e.amount_in ?? ''}" ${dis}>
      <select id="ecurin" ${dis}>${curOptions(e.currency_in || e.currency)}</select></div>` : ''}
    <div class="two"><div><label>${e.kind === 'transfer' ? t('add.fromAcct') : t('e.account')}</label><select id="eacct" ${dis}>${acctOptions(e.account_id, () => true, '—')}</select></div>
      <div><label>${t('add.date')}</label><input type="date" id="edate" value="${e.date}" ${dis}></div></div>
    ${e.kind !== 'transfer' && u.role !== 'personal' ? `<label>${t('add.forWhom')}</label><select id="efor" ${dis}>${['', ...me.people].map(p => `<option value="${esc(p)}" ${p === (e.for_whom || '') ? 'selected' : ''}>${esc(forName(p))}</option>`).join('')}</select>` : ''}
    <label class="check"><input type="checkbox" id="eone" ${e.one_time ? 'checked' : ''} ${dis}> ${t('rec.oneTime')}</label>
    ${can ? `<button class="btn" id="esave">${e.status === 'pending' ? t('e.confirmSave') : t('e.save')}</button><button class="btn danger" id="edel">${t('e.delete')}</button>` : ''}
  </div>`;
  sh.hidden = false;
  const close = () => { sh.hidden = true; sh.innerHTML = ''; };
  $('#x').onclick = close; sh.onclick = ev => { if (ev.target === sh) close(); };
  if (!can) return;
  $('#esave').onclick = async () => {
    const patch = { amount: Number($('#eamt').value), currency: $('#ecur').value, note: $('#enote').value, date: $('#edate').value,
      account_id: $('#eacct').value ? Number($('#eacct').value) : null, one_time: $('#eone').checked, confirm: true };
    if ($('#efor')) patch.for_whom = $('#efor').value;
    if (e.kind !== 'transfer' && patch.account_id && !curOk(patch.account_id, patch.currency)) return;
    if ($('#ecat') && $('#ecat').value !== e.category) patch.category = $('#ecat').value;
    if (e.kind === 'transfer') Object.assign(patch, { to_account_id: Number($('#eto').value) || null, via_account_id: Number($('#evia').value) || null,
      amount_in: $('#eamtin').value === '' ? null : Number($('#eamtin').value), currency_in: $('#ecurin').value });
    try { await call('/api/entries/' + e.id, { method: 'PUT', body: patch }); toast(patch.category ? t('e.savedLearn') : t('e.saved')); close(); renderList(); }
    catch (err) { toast(err.message); }
  };
  $('#edel').onclick = async () => {
    const b = $('#edel');
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = t('e.deleteSure'); return; }
    try { await call('/api/entries/' + e.id, { method: 'DELETE' }); toast(t('e.deleted')); close(); renderList(); } catch (err) { toast(err.message); }
  };
}

// ---------- me / settings ----------
async function renderMe() {
  const u = S.me.user;
  $('#app').innerHTML = `
    <div class="card"><b>${esc(u.name)}</b> <span class="muted">· ${t('role.' + u.role)}</span></div>
    <h2>${t('me.language')}</h2><div class="card"><div class="seg" id="mlang">${[['en', 'English'], ['zh', '中文']].map(([k, n]) => `<button data-l="${k}" class="${LANG === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <p class="small muted">${t('me.langNote')}</p></div>
    <h2>${t('me.pin')}</h2><div class="card"><input id="np" inputmode="numeric" placeholder="${t('setup.pinPh')}" autocomplete="off"><button class="btn" id="setp">${t('me.changePin')}</button></div>
    <h2>${t('me.sound')}</h2><div class="card"><label class="check" style="margin:0"><input type="checkbox" id="snd" ${soundOn() ? 'checked' : ''}> ${t('me.soundOn')}</label>
      <p class="small muted">${t('me.soundNote')}</p><button class="btn ghost sm" id="try">${t('me.soundTry')}</button></div>
    <div id="admin"></div>
    <button class="btn ghost" id="out">${t('me.logout')}</button>
    <p class="small muted center" style="margin-top:16px">${t('me.privacy')}</p>`;
  $('#mlang').querySelectorAll('button').forEach(b => b.onclick = async () => {
    LANG = b.dataset.l; try { localStorage.setItem('tally_lang', LANG); } catch {}
    if (u.role === 'admin') await call('/api/admin/settings', { method: 'POST', body: { lang: LANG } }).catch(() => {});
    pickLang(); renderTabs(); renderMe();
  });
  $('#snd').onchange = () => { try { localStorage.setItem('tally_sound', $('#snd').checked ? 'on' : 'off'); } catch {} };
  $('#try').onclick = () => { const ac = audio(); if (!ac) return toast(t('me.soundOff')); playSound(ac, 'expense'); setTimeout(() => playSound(ac, 'income'), 900); setTimeout(() => playSound(ac, 'transfer'), 1700); };
  $('#setp').onclick = async () => { try { await call('/api/pin', { method: 'POST', body: { pin: $('#np').value.trim() } }); toast(t('me.pinChanged')); $('#np').value = ''; } catch (e) { toast(e.message); } };
  $('#out').onclick = async () => { await call('/api/logout', { method: 'POST', body: {} }).catch(() => {}); S.me = null; renderLogin(); };
  if (u.role !== 'admin') return;
  const users = await call('/api/admin/users');
  const exp = S.me.categories.filter(c => c.kind === 'expense');
  const rates = S.me.rates;
  $('#admin').innerHTML = `
    <h2>${t('a.bills')} <span class="small muted">${t('a.billsNote')}</span></h2>
    <div class="card" id="bills"></div>
    <h2>${t('a.budgets')} <span class="small muted">${t('a.autoSave')}</span></h2>
    <div class="card"><table>${exp.map(c => `<tr><td>${esc(c.name)}${c.variable ? '' : ` <span class="muted small">${t('a.fixed')}</span>`}</td>
      <td><input class="num bud" data-n="${esc(c.name)}" inputmode="decimal" value="${c.budget}" style="width:110px;text-align:right;padding:6px 8px"></td></tr>`).join('')}</table>
      <label>${t('a.newCat')}</label><div class="two"><input id="ncat" placeholder="${t('a.newCatPh')}"><select id="nkind"><option value="expense">${t('k.expense')}</option><option value="income">${t('k.income')}</option></select></div>
      <label class="check"><input type="checkbox" id="ndaily"> ${t('a.daily')}</label>
      <button class="btn sm" id="addcat" style="margin-top:8px">${t('a.add')}</button></div>
    <h2>${t('a.accounts')}</h2>
    <div class="card">${S.me.accounts.map(a => `<div class="row" style="margin:6px 0"><input class="acc grow" data-id="${a.id}" value="${esc(a.name)}"><span class="small muted" style="white-space:nowrap">${t('at.' + a.type)} · ${a.currency}</span></div>`).join('')}
      <label>${t('a.addAccount')}</label>
      <input id="newacc" placeholder="${t('a.addAccountPh')}">
      <div class="two" style="margin-top:8px"><select id="newtype">${S.me.acctTypes.map(ty => `<option value="${ty}">${t('at.' + ty)}</option>`).join('')}</select>
        <select id="newcur">${curOptions(homeCur())}</select></div>
      <button class="btn sm" id="addacc" style="margin-top:8px">${t('a.add')}</button></div>
    <h2>${t('a.currencies')}</h2>
    <div class="card"><p class="small muted">${t('a.homeIs', { c: homeCur() })}</p>
      ${Object.entries(rates).map(([c, r]) => `<div class="row" style="margin:6px 0"><span>1 ${homeCur()} =</span><input class="num rate" data-c="${c}" value="${r}" inputmode="decimal" style="width:110px;text-align:right"><span>${c}</span></div>`).join('')}
      <div class="row" style="margin-top:8px"><input id="ncur" placeholder="${t('a.curCode')}" style="width:90px" maxlength="3"><input id="nrate" class="num" inputmode="decimal" placeholder="${t('a.rate')}" style="width:110px"><button class="btn sm" id="addcur">${t('a.add')}</button></div>
      <p class="small muted">${t('a.ratesNote')}</p></div>
    <h2>${t('a.family')}</h2>
    <div class="card">${users.map(x => `<div class="row" style="margin:8px 0"><span class="grow">${esc(x.name)} <span class="muted small">${t('role.' + x.role)}</span></span>
      ${x.role === 'personal' ? `<input class="pb num" data-id="${x.id}" placeholder="${t('a.allowance')}" value="${x.personal_budget ?? ''}" style="width:100px">` : ''}
      ${x.id !== u.id ? `<button class="btn ghost sm rp" data-id="${x.id}">${t('a.resetPin')}</button>` : ''}</div>`).join('')}
      <label>${t('a.addPerson')}</label><div class="two"><input id="nuser" placeholder="${t('setup.memberPh')}"><select id="nrole">${['member', 'recorder', 'personal'].map(r => `<option value="${r}">${t('role.' + r)}</option>`).join('')}</select></div>
      <button class="btn sm" id="adduser" style="margin-top:8px">${t('a.add')}</button>
      <details style="margin-top:10px"><summary class="small">${t('setup.rolesHelp')}</summary><p class="small muted">${t('setup.rolesText')}</p></details></div>`;
  const refresh = async () => { S.me = await call('/api/me'); };
  const drawBills = async () => {
    const bills = await call('/api/admin/bills');
    const cats = exp.map(c => c.name);
    const rowH = b => `<div class="bill" data-id="${b.id || ''}" style="border-bottom:1px solid var(--line);padding:8px 0">
      <div class="two"><input class="bn" placeholder="${t('a.billName')}" value="${esc(b.name || '')}"><div class="row"><input class="ba num" inputmode="decimal" placeholder="${t('add.amount')}" value="${b.amount ?? ''}"><select class="bcur" style="width:90px">${curOptions(b.currency || homeCur())}</select></div></div>
      <div class="two" style="margin-top:6px"><select class="bc">${cats.map(c => `<option ${c === b.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="row"><select class="bf" style="width:auto"><option value="month" ${b.freq !== 'year' ? 'selected' : ''}>${t('a.monthly')}</option><option value="year" ${b.freq === 'year' ? 'selected' : ''}>${t('a.yearly')}</option></select>
          <select class="bm" style="width:auto" ${b.freq === 'year' ? '' : 'hidden'}>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${b.month === i + 1 ? 'selected' : ''}>${mon(i + 1)}</option>`).join('')}</select>
          <input class="bd num" inputmode="numeric" value="${b.day || 1}" style="width:56px" aria-label="day"><span class="small muted">${t('a.day')}</span></div></div>
      <div class="row" style="margin-top:6px"><label class="check" style="margin:0"><input type="checkbox" class="bv" ${b.vary ? 'checked' : ''}>${t('a.vary')}</label>
        ${b.id ? `<label class="check" style="margin:0"><input type="checkbox" class="bact" ${b.active ? 'checked' : ''}>${t('a.active')}</label>` : `<button class="btn sm" data-add="1">${t('a.addBill')}</button>`}</div></div>`;
    $('#bills').innerHTML = bills.map(rowH).join('') + rowH({ category: (exp.find(c => !c.variable) || exp[0] || {}).name });
    $('#bills').querySelectorAll('.bill').forEach(r => {
      $('.bf', r).addEventListener('change', () => { $('.bm', r).hidden = $('.bf', r).value !== 'year'; });
      const save = async () => {
        try { await call('/api/admin/bill', { method: 'POST', body: { id: r.dataset.id ? Number(r.dataset.id) : undefined, name: $('.bn', r).value, amount: Number($('.ba', r).value),
          currency: $('.bcur', r).value, category: $('.bc', r).value, day: Number($('.bd', r).value), freq: $('.bf', r).value, month: Number($('.bm', r).value),
          vary: $('.bv', r).checked, active: $('.bact', r) ? $('.bact', r).checked : true } }); toast(t('a.billSaved')); if (!r.dataset.id) drawBills(); }
        catch (e) { toast(e.message); }
      };
      if (r.dataset.id) r.querySelectorAll('input,select').forEach(i => i.addEventListener('change', save)); else $('[data-add]', r).onclick = save;
    });
  };
  drawBills();
  $('#admin').querySelectorAll('.bud').forEach(i => i.onchange = async () => { await call('/api/admin/budget', { method: 'POST', body: { name: i.dataset.n, budget: Number(i.value) } }); await refresh(); toast(t('a.budgetSaved', { c: i.dataset.n, a: money(Number(i.value)) })); });
  $('#addcat').onclick = async () => { try { await call('/api/admin/category', { method: 'POST', body: { name: $('#ncat').value, kind: $('#nkind').value, daily: $('#ndaily').checked } }); await refresh(); toast(t('a.added')); renderMe(); } catch (e) { toast(e.message); } };
  $('#admin').querySelectorAll('.acc').forEach(i => i.onchange = async () => { try { await call('/api/admin/account', { method: 'POST', body: { id: Number(i.dataset.id), name: i.value } }); await refresh(); toast(t('a.renamed')); } catch (e) { toast(e.message); } });
  $('#addacc').onclick = async () => { const n = $('#newacc').value.trim(); if (!n) return; try { await call('/api/admin/account', { method: 'POST', body: { name: n, type: $('#newtype').value, currency: $('#newcur').value } }); await refresh(); toast(t('a.added')); renderMe(); } catch (e) { toast(e.message); } };
  const saveRates = async r => { await call('/api/admin/settings', { method: 'POST', body: { rates: r } }); await refresh(); toast(t('a.ratesSaved')); };
  $('#admin').querySelectorAll('.rate').forEach(i => i.onchange = () => saveRates({ ...S.me.rates, [i.dataset.c]: Number(i.value) }));
  $('#addcur').onclick = async () => { const c = $('#ncur').value.trim().toUpperCase(), r = Number($('#nrate').value); if (!/^[A-Z]{3}$/.test(c) || !(r > 0)) return toast(t('a.curNeed')); await saveRates({ ...S.me.rates, [c]: r }); renderMe(); };
  $('#admin').querySelectorAll('.pb').forEach(i => i.onchange = async () => { await call('/api/admin/user', { method: 'POST', body: { id: Number(i.dataset.id), personal_budget: i.value === '' ? null : Number(i.value) } }); toast(t('a.allowanceSaved')); });
  $('#adduser').onclick = async () => {
    const name = $('#nuser').value.trim();
    try { const r = await call('/api/admin/user', { method: 'POST', body: { name, role: $('#nrole').value } }); await refresh();
      await renderMe(); toast(t('a.personAdded', { n: name, p: r.pin }), 10000); } catch (e) { toast(e.message); }
  };
  $('#admin').querySelectorAll('.rp').forEach(b => b.onclick = async () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = t('a.sure'); return; }
    const r = await call('/api/admin/user', { method: 'POST', body: { id: Number(b.dataset.id), reset_pin: true } });
    b.outerHTML = `<b class="num">${t('a.newPin', { p: r.pin })}</b>`;
  });
}

// ---------- start ----------
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
pickLang();
boot();
