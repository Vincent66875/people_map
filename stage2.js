// Stage 2 verification: scores with component reasons, full chain paths,
// absence re-scoring, zoom sentences. Assertions at the end.
import assert from 'node:assert/strict';
import mock from '../src/data/jiraMock.js';
import { adapt } from '../src/analysis/adapter.js';
import { buildIndex, analyzeAll, analyzePerson, downstreamUnblock, nearbyPeople, absentImpact, WEIGHTS } from '../src/analysis/coverage.js';
import { ticketLines, themeLines, teamLines } from '../src/analysis/sentences.js';

const model = adapt({ users: mock.users, searchResponse: mock.searchResponse, now: mock.fetchedAt });
const ix = buildIndex(model);
const byName = Object.fromEntries(model.people.map((p) => [p.firstName, p.accountId]));
const nameOf = (id) => ix.personById.get(id)?.firstName ?? id;
const hr = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`);

function printPerson(r) {
  console.log(`\n${nameOf(r.accountId)} — coverage risk ${r.score}  [${r.reasons.map((f) => `${f.count} ${f.text}`).join(' · ') || 'nothing'}]`);
  for (const c of r.components) if (c.count) console.log(`   ${String(c.points).padStart(3)} = ${c.count} × ${c.each}  ${c.label}  [${c.keys.join(', ')}]`);
  for (const o of r.orphaned) console.log(`   orphaned ${o.key} '${o.summary}' (${o.role})${o.scored ? '' : '  NOT SCORED: nothing waits on it'}${o.trouble ? `  +trouble: ${o.troubleWhy}` : ''}`);
  for (const w of r.waiting) console.log(`   waiting  ${nameOf(w.accountId).padEnd(5)} chain: ${w.people.join(' → ')}   (${w.keys.join(' → ')})`);
  for (const b of r.bridges) console.log(`   bridge   ${b.teams.join(' ↔ ')}  [${b.keys.join(', ')}]`);
  for (const l of r.leadChanges) console.log(`   lead     ${l.key} '${l.summary}' — ${l.why}`);
  for (const s of r.stale) console.log(`   STALE    ${s.key} '${s.summary}' ${s.days}d (flag, not scored)`);
  const u = downstreamUnblock(ix, r.accountId);
  console.log(`   unblock  ${u.sentence}${u.tasks.length ? ` [${u.tasks.map((t) => `${t.key}←${t.on.join('+')}`).join(', ')}]` : ''}${u.further.length ? `  further down: ${u.further.join(', ')}` : ''}`);
  for (const n of nearbyPeople(ix, r.accountId)) console.log(`   near     ${n.name}: ${n.reason}`);
}

hr('WEIGHTS');
console.log(WEIGHTS);

hr('BASELINE (nobody out)');
const base = analyzeAll(ix);
for (const r of [...base.byId.values()].sort((a, b) => b.score - a.score)) printPerson(r);
console.log('\nRanking:', base.ranking.map((r) => `${nameOf(r.accountId)} ${r.score}`).join(' > '));

hr('SCENARIO: Mia out');
const out = new Set([byName.Mia]);
const sc = analyzeAll(ix, out);
console.log('stalled:', sc.absentImpact.stalled, ' broken edges:', [...sc.absentImpact.brokenEdgeIds].map((id) => id.split('->').map(nameOf).join('→')));
for (const w of sc.absentImpact.waiting) console.log(`  waiting ${nameOf(w.accountId)}: ${w.people.join(' → ')} (${w.keys.join(' → ')})`);
console.log('Ranking:', sc.ranking.map((r) => `${nameOf(r.accountId)} ${r.score}`).join(' > '));

hr('SCENARIO: Omar out (cycle + helper coverage)');
const sc2 = analyzeAll(ix, new Set([byName.Omar]));
console.log('stalled:', sc2.absentImpact.stalled);
for (const w of sc2.absentImpact.waiting) console.log(`  waiting ${nameOf(w.accountId)}: ${w.people.join(' → ')} (${w.keys.join(' → ')})`);
console.log('Ranking:', sc2.ranking.map((r) => `${nameOf(r.accountId)} ${r.score}`).join(' > '));
printPerson(sc2.byId.get(byName.Sofia));

hr('ZOOM: ticket');
ticketLines(model.edges).forEach((l) => console.log(`  ${l.text}  [${l.keys}]`));
hr('ZOOM: theme');
themeLines(model.edges).forEach((l) => console.log(`  ${l.text}  [${l.keys}]`));
hr('ZOOM: team');
teamLines(model.edges, nameOf, new Set(), model.collabEdges).forEach((l) => console.log(`  ${l.text}  [${l.keys}]`));
hr('ZOOM: team, Mia out');
teamLines(model.edges, nameOf, out).forEach((l) => console.log(`  ${l.text}`));

// ---------- assertions ----------
hr('ASSERTIONS');
const S = (n, absent) => analyzePerson(ix, byName[n], absent).score;
const P = (n, absent) => analyzePerson(ix, byName[n], absent);
const checks = [
  ['score = sum of components, always', () => [...base.byId.values()].forEach((r) => assert.equal(r.score, r.components.reduce((s, c) => s + c.each * c.count, 0)))],
  ['staleness never in score (no stale component)', () => [...base.byId.values()].forEach((r) => assert.ok(!r.components.some((c) => /stale/i.test(c.rule))))],
  ['chain followed to the end: Mia out leaves Ravi waiting via Ken', () => assert.deepEqual(P('Mia').waiting.find((w) => w.accountId === byName.Ravi).people, ['Mia', 'Ken', 'Ravi'])],
  ['chain keys spelled out: DES-2 → WEB-2 → WEB-3', () => assert.deepEqual(P('Mia').waiting.find((w) => w.accountId === byName.Ravi).keys, ['DES-2', 'WEB-2', 'WEB-3'])],
  ['cycle terminates: Omar out -> Lena waiting once', () => assert.deepEqual(P('Omar').waiting.map((w) => nameOf(w.accountId)), ['Lena'])],
  ['helper covers: Sofia out does not orphan API-2 (Omar has API-3)', () => assert.ok(!P('Sofia').orphaned.some((o) => o.key === 'API-2'))],
  ['...so Sofia gets a lead change on API-2 instead', () => assert.ok(P('Sofia').leadChanges.some((l) => l.key === 'API-2'))],
  ['coverage lost live: with Omar out, Sofia orphans API-2 and Ken waits', () => { const r = P('Sofia', new Set([byName.Omar])); assert.ok(r.orphaned.some((o) => o.key === 'API-2' && o.scored && o.trouble)); assert.ok(r.waiting.some((w) => w.accountId === byName.Ken)); }],
  ['solo task with no dependents is listed but not scored (API-6)', () => { const o = P('Sofia', new Set([byName.Omar])).orphaned.find((x) => x.key === 'API-6'); assert.equal(o.scored, false); }],
  ['reporter is not coverage: Jo scores only the OPS-4 lead change', () => assert.deepEqual(P('Jo').components.filter((c) => c.count).map((c) => c.rule), ['leadChange'])],
  ['sole bridge: Ken alone links Frontend to Design and API', () => assert.deepEqual(P('Ken').bridges.map((b) => b.other).sort(), ['API', 'Design'])],
  ['unassigned blocker OPS-3 scores nobody', () => [...base.byId.values()].forEach((r) => assert.ok(!r.components.some((c) => c.keys.includes('OPS-3')))) ],
  ['absent people are not ranked', () => assert.ok(!sc.ranking.some((r) => r.accountId === byName.Mia))],
  ['Mia out breaks Ken→Mia edge', () => assert.ok(sc.absentImpact.brokenEdgeIds.has(`${byName.Ken}->${byName.Mia}`))],
  ['unblock count: Mia 2 tasks (WEB-2, WEB-4)', () => assert.deepEqual(downstreamUnblock(ix, byName.Mia).tasks.map((t) => t.key).sort(), ['WEB-2', 'WEB-4'])],
  ['candidates: max 3, never include self or absent', () => model.people.forEach((p) => { const n = nearbyPeople(ix, p.accountId, out); assert.ok(n.length <= 3); assert.ok(!n.some((x) => x.accountId === p.accountId || out.has(x.accountId))); })],
  ['team sentence derived: "Frontend waits on Design, through Mia only"', () => assert.ok(teamLines(model.edges, nameOf).some((l) => l.text === 'Frontend waits on Design, through Mia only'))],
  ['team sentence with collab: past shared work Frontend/Design', () => assert.ok(teamLines(model.edges, nameOf, new Set(), model.collabEdges).some((l) => l.text === 'Frontend waits on Design, through Mia only · shared work before (DES-2)'))],
  ['team sentence with collab: Frontend/API has no shared work', () => assert.ok(teamLines(model.edges, nameOf, new Set(), model.collabEdges).some((l) => l.text === 'Frontend waits on API, through Sofia only · no shared work'))],
  ['absence positive side: Sofia out -> API-2 continues with Omar', () => { const im = absentImpact(ix, new Set([byName.Sofia])); assert.deepEqual(im.continuing.map((t) => [t.key, t.by.map(nameOf)]), [['API-2', ['Omar']]]); assert.equal(im.carriedCollabIds.size, 1); }],
  ['scores unchanged by collaboration layer', () => assert.deepEqual(base.ranking.map((r) => `${nameOf(r.accountId)} ${r.score}`), ['Mia 18', 'Ken 12', 'Omar 12', 'Lena 10', 'Sofia 4', 'Jo 2', 'Ravi 2'])],
  ['no banned wording in any generated text', () => {
    const txt = JSON.stringify([base, sc, ticketLines(model.edges), themeLines(model.edges), teamLines(model.edges, nameOf), model.people.map((p) => nearbyPeople(ix, p.accountId))], (k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v.values()] : v));
    assert.ok(!/bus factor|person risk|most important|backup|capacity|hours/i.test(txt));
  }],
];
let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
