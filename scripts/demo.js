// Builds a demo household with ~4 months of made-up spending, for trying Tally out or taking screenshots.
// Usage:  node --no-warnings scripts/demo.js en      → data/demo-en.db
//         node --no-warnings scripts/demo.js zh      → data/demo-zh.db
// Then:   TALLY_DB=data/demo-en.db npm start         (every demo PIN is 1234)
// Nothing here touches your real database (data/tally.db).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const lang = process.argv[2] === 'zh' ? 'zh' : 'en';
const file = path.join(__dirname, '..', 'data', `demo-${lang}.db`);
for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
process.env.TALLY_DB = file;
const L = require('../lib');

const P = {
  en: { admin: 'Alex', members: [['Sam', 'member'], ['Grandma', 'recorder'], ['Mia', 'personal']], home: 'USD', extra: [{ code: 'EUR', rate: 0.92 }],
    accts: [['Visa (Alex)', 'card', 'USD'], ['Mastercard (Sam)', 'card', 'USD'], ['Joint checking', 'bank', 'USD'], ['Euro travel card', 'card', 'EUR']] },
  zh: { admin: '大伟', members: [['小美', 'member'], ['奶奶', 'recorder'], ['乐乐', 'personal']], home: 'CAD', extra: [{ code: 'CNY', rate: 5.1 }],
    accts: [['招行信用卡（大伟）', 'card', 'CAD'], ['Visa（小美）', 'card', 'CAD'], ['家庭储蓄卡', 'bank', 'CAD'], ['微信零钱', 'cash', 'CNY']] },
}[lang];

L.setup({ lang, name: P.admin, pin: '1234', member_pin: '1234', home_currency: P.home, extra_currencies: P.extra, template: lang,
  members: P.members.map(([name, role]) => ({ name, role })) });
L.setSetting('demo', true);
for (const [name, type, cur] of P.accts) L.db.prepare('INSERT INTO accounts(name,owner,currency,type,sort) VALUES(?,?,?,?,0)').run(name, '', cur, type);
const acct = n => L.db.prepare('SELECT id FROM accounts WHERE name=?').get(n).id;
const user = n => L.db.prepare('SELECT id,name,role,default_account,personal_budget FROM users WHERE name=?').get(n);
const [A, B, G, K] = [P.admin, ...P.members.map(m => m[0])].map(user);
L.db.prepare('UPDATE users SET default_account=? WHERE id=?').run(acct(P.accts[0][0]), A.id);
L.db.prepare('UPDATE users SET default_account=? WHERE id=?').run(acct(P.accts[1][0]), B.id);
L.db.prepare('UPDATE users SET personal_budget=? WHERE id=?').run(80, K.id);
A.default_account = acct(P.accts[0][0]); B.default_account = acct(P.accts[1][0]);

// A tiny seeded random number generator, so the demo looks the same every time
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const amt = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;

const C = lang === 'en' ? {
  rent: 'Rent / Mortgage', util: 'Utilities', net: 'Internet & Phone', ins: 'Insurance', fuel: 'Fuel & Charging', groc: 'Groceries', dine: 'Dining Out',
  cloth: 'Clothing & Beauty', kids: "Kids' Activities", books: 'Books', health: 'Health & Dental', pets: 'Pets', travel: 'Travel', fun: 'Entertainment',
  subs: 'Subscriptions', tech: 'Electronics', gift: 'Gifts & Social', misc: 'Misc', salary: 'Salary', side: 'Side Income',
  notes: { groc: ['Costco', "Trader Joe's", 'Whole Foods', 'Farmers market', 'Kroger'], dine: ['Lunch with Sam', 'Pizza night', 'Sushi dinner', 'Starbucks', 'Tacos'],
    fuel: ['Shell gas', 'Supercharger', 'Costco gas'], kids: ['Tennis lesson', 'Piano lesson', 'Swimming class'], fun: ['Movie night', 'Bowling', 'Museum tickets'],
    cloth: ['Haircut', 'Winter jacket', 'New shoes'], pets: ['Dog food', 'Vet visit'], books: ['Kindle book', 'Indigo'], health: ['Pharmacy', 'Dentist'],
    misc: ['Amazon order', 'Home Depot', 'Post office'], gift: ['Birthday gift', 'Gift card'], tech: ['Phone charger'], travel: ['Hotel weekend', 'Campsite'],
    unknown: ['Etsy order', 'Venmo to Jordan', 'Card payment'] },
  bills: [['Rent', 'rent', 2000, 1], ['Internet', 'net', 70, 12], ['Phone plan', 'net', 65, 18], ['Netflix', 'subs', 15.49, 9], ['Car insurance', 'ins', 145, 20]],
  oneOff: ['New laptop', 'tech', 1299], tutor: 'Coach Kim',
  kidMine: ['Ice cream', 'Comic book', 'Snacks', 'Bubble tea'], grandma: ['Groceries for dinner', 'Farmers market', 'Pharmacy'],
} : {
  rent: '房租房贷', util: '水电气', net: '网络电话', ins: '保险', fuel: '加油充电', groc: '超市采购', dine: '外出就餐', cloth: '服饰美容', kids: '子女教育活动',
  books: '书籍', health: '医疗牙科', pets: '宠物', travel: '旅行', fun: '娱乐', subs: '订阅', tech: '数码', gift: '人情礼物', misc: '杂项', salary: '工资', side: '副业收入',
  notes: { groc: ['Costco 买菜', '大统华', 'No Frills', '买水果', 'Walmart 日用品'], dine: ['和小美吃火锅', '奶茶', '周末早茶', 'Tim Hortons 咖啡', '拉面'],
    fuel: ['加油', 'Costco gas', '充电'], kids: ['网球课', '钢琴课', '游泳课'], fun: ['看电影', '保龄球', '博物馆门票'],
    cloth: ['理发', '羽绒服', '买鞋'], pets: ['狗粮', '看兽医'], books: ['买书', 'Kindle 电子书'], health: ['药店', '看牙'],
    misc: ['亚马逊', 'Home Depot', '寄快递'], gift: ['生日礼物', '红包'], tech: ['耳机'], travel: ['周末酒店', '露营'],
    unknown: ['转给朋友', '网上订单', 'Etsy'] },
  bills: [['房租', 'rent', 2000, 1], ['网费', 'net', 70, 12], ['手机费', 'net', 65, 18], ['Netflix', 'subs', 15.49, 9], ['车险', 'ins', 145, 20]],
  oneOff: ['新电脑', 'tech', 1299], tutor: '金教练',
  kidMine: ['冰淇淋', '漫画书', '零食', '奶茶'], grandma: ['买菜做饭', '买水果', '药店'],
};

const today = L.today();
const start = new Date(Number(today.slice(0, 4)), 0, 1);   // January 1st of this year, so the year report is full
const add = (u, o) => L.addEntry(u, { client_id: `demo-${Math.round(rnd() * 1e12)}`, ...o });
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const wantDetails = lang === 'en' ? { Activity: null, 'Teacher / coach': C.tutor, For: K.name } : { 什么活动: null, 老师教练: C.tutor, 给谁: K.name };

for (let d = new Date(start); iso(d) <= today; d.setDate(d.getDate() + 1)) {
  const date = iso(d), dow = d.getDay(), day = d.getDate();
  const who = () => (rnd() < 0.55 ? A : B);
  if (day === 1) add(A, { date, kind: 'expense', amount: 2000, category: C.rent, note: C.bills[0][0], account_id: acct(P.accts[2][0]) });
  if (day === 15) add(A, { date, kind: 'expense', amount: amt(140, 260), category: C.util, note: lang === 'en' ? 'Electric + water' : '电费水费' });
  if (day === 12) add(A, { date, kind: 'expense', amount: 70, category: C.net, note: C.bills[1][0] });
  if (day === 18) add(B, { date, kind: 'expense', amount: 65, category: C.net, note: C.bills[2][0] });
  if (day === 9) add(A, { date, kind: 'expense', amount: 15.49, category: C.subs, note: 'Netflix' });
  if (day === 20) add(A, { date, kind: 'expense', amount: 145, category: C.ins, note: C.bills[4][0] });
  if (day === 1 || day === 15) add(A, { date, kind: 'income', amount: 3900, category: C.salary, note: lang === 'en' ? 'Paycheck' : '工资', account_id: acct(P.accts[2][0]) });
  if (day === 25 && rnd() < 0.7) add(B, { date, kind: 'income', amount: amt(300, 700), category: C.side, note: lang === 'en' ? 'Freelance design' : '设计稿费' });
  if (dow === 6 || (dow === 3 && rnd() < 0.7)) add(who(), { date, kind: 'expense', amount: amt(45, 190), category: C.groc, note: pick(C.notes.groc) });
  if (rnd() < 0.3) add(who(), { date, kind: 'expense', amount: amt(8, 75), category: C.dine, note: pick(C.notes.dine) });
  if (dow === 0 && rnd() < 0.8) add(who(), { date, kind: 'expense', amount: amt(35, 60), category: C.fuel, note: pick(C.notes.fuel) });
  if (dow === 2 || dow === 4) { const n = pick(C.notes.kids); add(B, { date, kind: 'expense', amount: pick([45, 50, 60]), category: C.kids, note: n, for_whom: K.name,
    details: Object.fromEntries(Object.entries(wantDetails).map(([k, v]) => [k, v ?? n.replace(/ lesson| class|课/g, '')])) }); }
  if (rnd() < 0.06) add(who(), { date, kind: 'expense', amount: amt(15, 80), category: C.fun, note: pick(C.notes.fun) });
  if (rnd() < 0.05) add(B, { date, kind: 'expense', amount: amt(25, 140), category: C.cloth, note: pick(C.notes.cloth) });
  if (rnd() < 0.05) add(who(), { date, kind: 'expense', amount: amt(20, 90), category: C.pets, note: pick(C.notes.pets) });
  if (rnd() < 0.04) add(A, { date, kind: 'expense', amount: amt(10, 25), category: C.books, note: pick(C.notes.books) });
  if (rnd() < 0.03) add(who(), { date, kind: 'expense', amount: amt(15, 120), category: C.health, note: pick(C.notes.health) });
  if (rnd() < 0.08) add(who(), { date, kind: 'expense', amount: amt(10, 60), category: C.misc, note: pick(C.notes.misc) });
  if (rnd() < 0.03) add(B, { date, kind: 'expense', amount: amt(20, 60), category: C.gift, note: pick(C.notes.gift) });
  if (rnd() < 0.05) add(G, { date, kind: 'expense', amount: amt(15, 50), category: C.groc, note: pick(C.grandma) });
  if (rnd() < 0.12) add(K, { date, kind: 'expense', amount: amt(3, 12), category: C.dine, note: pick(C.kidMine) });
}
// a weekend trip in the previous month, partly paid in the second currency
const lastM = new Date(today.slice(0, 4), Number(today.slice(5, 7)) - 2, 14);
add(A, { date: iso(lastM), kind: 'expense', amount: 389, category: C.travel, note: pick(C.notes.travel), details: lang === 'en' ? { Type: 'Weekend / nearby' } : { 哪种: '短途（周末 / 周边）' } });
add(A, { date: iso(lastM), kind: 'expense', amount: lang === 'en' ? 120 : 600, currency: P.extra[0].code, category: C.dine, note: pick(C.notes.dine), account_id: acct(P.accts[3][0]) });
// one big one-off, and a few notes Tally can't place yet (shown as "needs a category")
add(A, { date: iso(new Date(today.slice(0, 4), Number(today.slice(5, 7)) - 3, 22)), kind: 'expense', amount: C.oneOff[2], category: C[C.oneOff[1]], note: C.oneOff[0], one_time: true });
for (const n of C.notes.unknown) add(B, { date: today, kind: 'expense', amount: amt(12, 60), note: n });
// recurring bills (reminders)
const ib = L.db.prepare('INSERT INTO bills(name,category,amount,currency,day,freq,last_period) VALUES(?,?,?,?,?,?,?)');
for (const [name, c, a, day] of C.bills) ib.run(name, C[c], a, P.home, day, 'month', Number(today.slice(8)) >= day ? today.slice(0, 7) : null);
ib.run(lang === 'en' ? 'Water bill' : '水费', C.util, 0, P.home, Math.max(1, Number(today.slice(8)) - 1), 'month', null);
L.db.prepare('UPDATE bills SET vary=1 WHERE amount=0').run();
L.rebuildLearnedRules();

const n = L.db.prepare('SELECT COUNT(*) n FROM entries').get().n;
console.log(`Demo household (${lang}) ready: ${file}\n${n} entries · people: ${[P.admin, ...P.members.map(m => m[0])].join(', ')} · every PIN is 1234\nStart it: TALLY_DB=data/demo-${lang}.db npm start`);
