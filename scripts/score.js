// node scripts/score.js [small|large] [Name,Name ...marked out]
import { buildModel } from '../src/analysis/adapter.js';
import { ranking, coverageRisk, absenceImpact, coverBadges, FORMULA } from '../src/analysis/scoring.js';

const [name = 'large', outArg = ''] = process.argv.slice(2);
const { default: fixture } = await import(`../src/data/${name}.js`);
const m = buildModel(fixture);
const idOf = (n) => m.people.find((p) => p.name === n)?.accountId;
const absent = new Set(outArg.split(',').filter(Boolean).map(idOf));

console.log('Formula:'); for (const f of FORMULA) console.log(`  +${f.points} ${f.unit}  ${f.text}`);
console.log(`\nRanking${absent.size ? ` with out: ${outArg}` : ''}:`);
for (const r of ranking(m, absent).rows)
  console.log(`  ${r.name.padEnd(6)} ${String(r.score).padStart(2)}${absent.size ? ` (${r.delta >= 0 ? '+' : ''}${r.delta})` : ''}${r.out ? ' [out]' : ''}  ${r.reasonText}`);
console.log('\nPer person:');
for (const p of m.people) {
  const r = coverageRisk(m, p.accountId, absent);
  console.log(`  ${p.name}: ${r.unblock.sentence}`);
  for (const w of r.waiting) console.log(`     waiting ${w.chainText}   [${w.keysText}]`);
  for (const c of r.covered) console.log(`     covered ${c.key}: ${c.leftOn.join(', ')} still on it`);
  if (r.solo.length) console.log(`     solo (not scored): ${r.solo.join(', ')}`);
  if (r.leadOnly.length) console.log(`     lead only, nothing depends (not scored): ${r.leadOnly.map((l) => l.key).join(', ')}`);
  if (r.stale.length) console.log(`     stale: ${r.stale.join(', ')}`);
}
console.log('\nBadges:');
for (const [id, b] of coverBadges(m, absent)) console.log(`  ${id.padEnd(14)} ${b.color}  ${b.pairs.map((p) => `${p.blockerKey}:${p.others.join('/') || '-'}`).join(' ')}`);
if (absent.size) {
  const a = absenceImpact(m, absent);
  console.log('\nAbsence impact:', JSON.stringify({ stalled: a.stalledKeys, broken: a.brokenEdges, leftWaiting: a.leftWaiting.map((w) => w.chainText), context: a.context.map((c) => `${c.name}: ${c.items.map((i) => i.key).join(',')}`) }, null, 1));
}
