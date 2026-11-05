// Checks that every string key used in public/app.js exists in both languages, and both languages have the same keys.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..', 'public');
const ctx = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'i18n.js'), 'utf8') + ';this.I18N=I18N', ctx);
const { en, zh } = ctx.I18N;
const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const used = new Set([...src.matchAll(/'([a-z]+\.[a-zA-Z]+|loading|close|today|yesterday|none|family|sep)'/g)].map(m => m[1]));
for (const p of ['role.admin', 'role.member', 'role.recorder', 'role.personal', 'at.bank', 'at.card', 'at.cash', 'at.agent']) used.add(p);
const known = k => k in en;
const prefixes = new Set(Object.keys(en).map(k => k.split('.')[0]));
const missing = [...used].filter(k => prefixes.has(k.split('.')[0]) && !known(k));
const onlyEn = Object.keys(en).filter(k => !(k in zh)), onlyZh = Object.keys(zh).filter(k => !(k in en));
const unused = Object.keys(en).filter(k => !used.has(k));
console.log('keys:', Object.keys(en).length, '| used in app.js:', used.size);
console.log('missing from dictionary:', missing.length ? missing : 'none');
console.log('only in en:', onlyEn.length ? onlyEn : 'none', '| only in zh:', onlyZh.length ? onlyZh : 'none');
console.log('defined but unused:', unused.length ? unused : 'none');
process.exit(missing.length || onlyEn.length || onlyZh.length ? 1 : 0);
