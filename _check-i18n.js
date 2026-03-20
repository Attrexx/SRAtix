const fs = require('fs');
const src = fs.readFileSync('sratix-client/public/js/sratix-i18n.js', 'utf8');
const lines = src.split('\n');

// Find language block boundaries
const langStarts = [];
lines.forEach((l, i) => {
  const m = l.match(/^\s+'?([\w-]+)'?\s*:\s*\{/);
  if (m && ['en','fr','de','it','zh-TW'].includes(m[1])) langStarts.push({ lang: m[1], line: i + 1 });
});
console.log('Language blocks:', langStarts.map(s => s.lang + ' @L' + s.line).join(', '));

// Extract keys per language block
const keyRe = /^\s*'([^']+)'\s*:/;
const langKeys = {};
for (let b = 0; b < langStarts.length; b++) {
  const start = langStarts[b].line - 1;
  const end = b + 1 < langStarts.length ? langStarts[b + 1].line - 1 : lines.length;
  const keys = [];
  for (let i = start; i < end; i++) {
    const km = lines[i].match(keyRe);
    if (km) keys.push(km[1]);
  }
  langKeys[langStarts[b].lang] = keys;
}

// Check counts
const ref = Object.keys(langKeys)[0];
const refSet = new Set(langKeys[ref]);
let issues = 0;
for (const [lang, keys] of Object.entries(langKeys)) {
  console.log(lang + ': ' + keys.length + ' keys');
  // Check duplicates
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) { console.log('  DUPLICATE:', [...new Set(dupes)]); issues++; }
}
// Cross-check
for (const [lang, keys] of Object.entries(langKeys)) {
  if (lang === ref) continue;
  const lSet = new Set(keys);
  const missing = [...refSet].filter(k => !lSet.has(k));
  const extra = keys.filter(k => !refSet.has(k));
  if (missing.length) { console.log('  MISSING from ' + lang + ':', missing); issues++; }
  if (extra.length) { console.log('  EXTRA in ' + lang + ':', extra); issues++; }
}

if (!issues) console.log('\nAll clean — no duplicates, no missing/extra keys across languages.');
else console.log('\n' + issues + ' issue(s) found.');
