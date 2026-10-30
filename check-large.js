// Check the larger demo fixture (src/data/jiraMockLarge.js).
// Prints ranking, team sentences, collaboration; asserts the scenarios it was built for.
// Usage: npm run check:large
import assert from 'node:assert/strict';
import mock from '../src/data/jiraMockLarge.js';
import { adapt } from '../src/analysis/adapter.js';
import { buildIndex, analyzeAll, analyzePerson, absentImpact } from '../src/analysis/coverage.js';
import { teamLines, collabSentences } from '../src/analysis/sentences.js';

const model = adapt({ users: mock.users, searchResponse: mock.searchResponse, now: mock.fetchedAt });
const ix = buildIndex(model);
const byName = Object.fromEntries(model.people.map((p) => [p.firstName, p.accountId]));
const nameOf = (id) => ix.personById.get(id)?.firstName ?? id;
const hr = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`);

hr('TEAMS');
const teams = {};
for (const p of model.people) (teams[p.team] ??= []).push(`${p.firstName}${p.doesWork ? '' : '*'}`);
for (const [t, ps] of Object.entries(teams)) console.log(`${t.padEnd(9)} ${ps.join(', ')}`);
console.log('(* = no open work)');

hr('RANKING (nobody out)');
const base = analyzeAll(ix);
for (const r of base.ranking) console.log(`${nameOf(r.accountId).padEnd(6)} ${String(r.score).padStart(3)}  ${r.reasons.map((f) => `${f.count} ${f.text}`).join(' · ')}`);

hr('SCENARIO: Ana out, then what does Mia score?');
const anaOut = new Set([byName.Ana]);
const mia = analyzePerson(ix, byName.Mia, anaOut);
console.log(`Mia ${base.byId.get(byName.Mia).score} -> ${mia.score}`);
for (const w of mia.waiting) console.log(`  waiting ${nameOf(w.accountId)}: ${w.people.join(' → ')} (${w.keys.join(' → ')})`);

hr('TEAM SENTENCES');
teamLines(model.edges, nameOf, new Set(), model.collabEdges).forEach((l) => console.log(`  ${l.text}`));

hr('WORKING TOGETHER');
model.collabEdges.forEach((c) => collabSentences(c, nameOf).forEach((s) => console.log(`  ${s}`)));

hr('DATA QUALITY');
const q = model.quality;
console.log(`issues ${q.issuesFetched} · open work ${q.openWorkItems} · ${q.pctOpenAssigned}% assigned · ${q.dependencyLinks} dep links · ${q.pctOpenWithTwoPlus}% open work with 2+ people`);
console.log(`unassigned blockers: ${q.blockersWithNoAssignee.map((b) => `${b.blockerKey}→${b.waiterKey}`).join(', ')} · excluded: ${q.excludedAccounts.map((a) => a.displayName).join(', ')}`);

hr('ASSERTIONS');
const score = (n) => base.byId.get(byName[n])?.score;
const linkSides = {};
for (const i of mock.searchResponse.issues) for (const l of i.fields.issuelinks) (linkSides[l.id] ??= []).push(i.key);
const checks = [
  ['every link is written on exactly 2 issues', () => Object.entries(linkSides).forEach(([id, ks]) => assert.equal(ks.length, 2, `link ${id} on ${ks}`))],
  ['teams of 3–4 working people', () => ['Design', 'Frontend', 'API', 'Platform'].forEach((t) => { const n = model.people.filter((p) => p.team === t && p.doesWork).length; assert.ok(n >= 3 && n <= 4, `${t}: ${n}`); })],
  ['covered blocker: Mia alone stalls nothing', () => assert.equal(analyzePerson(ix, byName.Mia).orphaned.length, 0)],
  ['Ana out -> Mia leaves 4 people waiting, chain to Priya', () => { assert.equal(mia.waiting.length, 4); assert.deepEqual(mia.waiting.find((w) => w.accountId === byName.Priya).keys, ['DES-2', 'WEB-2', 'WEB-3', 'WEB-8']); }],
  ['top of ranking: Ken and Omar 16', () => { assert.equal(score('Ken'), 16); assert.equal(score('Omar'), 16); }],
  ['no sole link where 2 people connect teams (Frontend→Design)', () => assert.ok(teamLines(model.edges, nameOf).some((l) => l.text === 'Frontend waits on Design, through Mia and Theo'))],
  ['sole team link stays for API↔Platform (Omar)', () => assert.ok(analyzePerson(ix, byName.Omar).bridges.some((b) => b.other === 'Platform'))],
  ['cross-team collaboration: Priya on Theo\'s DES-7', () => assert.ok(model.collabEdges.some((c) => c.tasks.some((t) => t.key === 'DES-7' && t.current)))],
  ['isolated work: Ivan shares no task', () => assert.ok(!model.collabEdges.some((c) => c.a === byName.Ivan || c.b === byName.Ivan))],
  ['Lena out -> OPS-2 continues with Sam', () => assert.ok(absentImpact(ix, new Set([byName.Lena])).continuing.some((t) => t.key === 'OPS-2' && t.by.includes(byName.Sam)))],
  ['edge cases kept: unassigned blocker, bot, deactivated', () => { assert.ok(q.blockersWithNoAssignee.some((b) => b.blockerKey === 'OPS-3')); assert.equal(q.excludedAccounts.length, 2); }],
];
let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
