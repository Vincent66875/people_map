// node scripts/search.js [small|large] [query ...]
import { buildModel } from '../src/analysis/adapter.js';
import { whoHasWorkedOn } from '../src/analysis/search.js';
import { teamSentences, edgeLabels, ZOOMS } from '../src/analysis/labels.js';

const [name = 'large', ...queries] = process.argv.slice(2);
const { default: fixture } = await import(`../src/data/${name}.js`);
const m = buildModel(fixture);
const qs = queries.length ? queries : name === 'large' ? ['DES-2', 'API-2', 'WEB-3', 'MOB-3', 'API-7', 'component:design-system', 'label:checkout-2026', 'epic:MOB-1'] : ['PLAT-1', 'APP-1', 'PLAT-3', 'APP-2', 'component:auth', 'label:login'];
for (const q of qs) {
  const r = whoHasWorkedOn(m, q);
  console.log(`\n? ${q} → ${r.label}  (related: ${r.keys.join(',')}; dropped old: ${r.dropped}; more: ${r.more})`);
  for (const p of r.people) console.log(`   [t${p.tier}] ${p.line}`);
}
console.log('\nTeam sentences:');
for (const s of teamSentences(m)) console.log(`  ${s.sentence}   [${s.keys.join(',')}]`);
for (const z of ZOOMS) {
  console.log(`\nLabels @${z}:`);
  for (const [id, l] of edgeLabels(m, z)) console.log(`  ${id.padEnd(14)} ${l.text}`);
}
