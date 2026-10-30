// Stage 1 verification: run the adapter on the mock Jira data and print
// derived people, collapsed edges (both ticket keys) and the data-quality report.
// Also asserts the fixture cases the spec requires, so a regression fails loudly.
import assert from 'node:assert/strict';
import mock from '../src/data/jiraMock.js';
import { adapt } from '../src/analysis/adapter.js';
import { edgeSentences, collabSentences } from '../src/analysis/sentences.js';

const model = adapt({ users: mock.users, searchResponse: mock.searchResponse, now: mock.fetchedAt });
const nameOf = (id) => model.people.find((p) => p.accountId === id)?.firstName ?? id;

const hr = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`);

hr('PEOPLE');
for (const p of model.people) {
  const r = p.roles;
  console.log(
    `${p.displayName.padEnd(14)} team=${p.team.padEnd(9)} (${p.teamSource.padEnd(11)})` +
      ` owns=[${r.owns}] helps=[${r.helps}] leads=[${r.leads}]` +
      (r.history.length ? ` history=[${r.history}]` : '') +
      (p.doesWork ? '' : '  <- no open work (reporter only)'),
  );
}

hr('ISSUE-LEVEL DEPENDENCIES (after rollup + dedupe)');
for (const d of model.dependencies) {
  console.log(
    `${d.blockerKey.padEnd(6)} blocks ${d.waiterKey.padEnd(6)} links=[${d.linkIds}]` +
      (d.viaSubtask.length ? ` via sub-task ${d.viaSubtask}` : '') +
      (d.active ? '' : `  INACTIVE: ${d.inactiveReason}`),
  );
}

hr('PERSON EDGES (waiter -> blocker, collapsed)');
for (const e of model.edges) {
  console.log(
    `${nameOf(e.from)} -> ${nameOf(e.to)}  weight=${e.weight}  ${e.red ? 'RED' : 'ok '}  ` +
      `${e.fromTeam} -> ${e.toTeam}  pairs=${e.pairs.map((p) => `${p.blockerKey}→${p.waiterKey}`).join(', ')}`,
  );
  for (const s of edgeSentences(e, nameOf)) console.log(`    ${s}`);
}

hr('COLLABORATION (same task, undirected)');
for (const c of model.collabEdges) {
  console.log(`${nameOf(c.a)} ~ ${nameOf(c.b)}  ${c.current ? 'now   ' : 'before'}  ${c.aTeam}/${c.bTeam}  tasks=[${c.tasks.map((t) => t.key)}] keys=[${c.keys}]`);
  for (const s of collabSentences(c, nameOf)) console.log(`    ${s}`);
}

hr('DATA QUALITY');
console.log(JSON.stringify(model.quality, null, 2));

hr('PROVENANCE LINE');
const q = model.quality;
console.log(
  `Built from ${q.issuesFetched} Jira issues with no manual input · ${q.pctOpenAssigned}% of open work assigned · ${q.dependencyLinks} dependency links`,
);

// ---------- assertions on required fixture cases ----------
hr('ASSERTIONS');
const edge = (a, b) => model.edges.find((e) => nameOf(e.from) === a && nameOf(e.to) === b);
const dep = (id) => model.dependencies.find((d) => d.id === id);
const checks = [
  ['parallel edges collapse: Ken->Mia is one edge, weight 2', () => assert.equal(edge('Ken', 'Mia')?.weight, 2)],
  ['no duplicate edge ids', () => assert.equal(new Set(model.edges.map((e) => e.id)).size, model.edges.length)],
  ['every pair keeps BOTH ticket keys', () => model.edges.flatMap((e) => e.pairs).forEach((p) => assert.ok(p.blockerKey && p.waiterKey))],
  ['Jira double-listing de-duplicated: link 30001 counted once', () => assert.deepEqual(dep('DES-2>WEB-2').linkIds, ['30001', '30002'])],
  ['sub-task link rolled up: DES-4 -> DES-2', () => assert.deepEqual(dep('DES-2>WEB-2').viaSubtask, ['DES-4'])],
  ['"depends on" reversed correctly: DES-5 blocks WEB-4', () => assert.ok(dep('DES-5>WEB-4'))],
  ['cycle present: Omar->Lena and Lena->Omar', () => { assert.ok(edge('Omar', 'Lena')); assert.ok(edge('Lena', 'Omar')); }],
  ['cycle closed via sub-task API-5', () => assert.deepEqual(dep('API-4>OPS-2').viaSubtask, ['API-5'])],
  ['unassigned blocker reported: OPS-3', () => assert.deepEqual(q.blockersWithNoAssignee, [{ blockerKey: 'OPS-3', waiterKey: 'API-6' }])],
  ['deactivated assignee treated as unassigned: OPS-4', () => assert.ok(q.unassignedOpen.some((x) => x.key === 'OPS-4'))],
  ['bot + deactivated excluded from people', () => assert.ok(!model.people.some((p) => /Automation|Dan/.test(p.displayName)))],
  ['resolved dep (Done blocker) inactive: DES-6>WEB-7', () => assert.equal(dep('DES-6>WEB-7').active, false)],
  ['relates-to link ignored', () => assert.ok(q.nonDependencyLinksIgnored.some((x) => x.type === 'Relates'))],
  ['red edge: Ken->Sofia (API-2 overdue)', () => assert.equal(edge('Ken', 'Sofia').red, true)],
  ['red edge: Lena->Omar (API-4 status Blocked)', () => assert.equal(edge('Lena', 'Omar').red, true)],
  ['not red: Ravi->Ken (WEB-2 only waiting upstream)', () => assert.equal(edge('Ravi', 'Ken').red, false)],
  ['stale is a flag on the pair, not a red edge: Ken->Mia', () => assert.equal(edge('Ken', 'Mia').red, false)],
  ['reporter not a helper: Jo has no work roles', () => assert.equal(model.people.find((p) => p.firstName === 'Jo').doesWork, false)],
  ['OPS-3 lead: bot reporter -> none', () => assert.equal(model.issues['OPS-3'].leadSource, 'none')],
  ['OPS-4 lead falls back to reporter Jo', () => assert.equal(model.issues['OPS-4'].leadSource, 'reporter')],
  ['progress capped at 95% while open', () => Object.values(model.issues).filter((i) => i.isOpen).forEach((i) => assert.ok(i.progress <= 0.95))],
  ['team fallbacks used: field, group, project key', () => assert.deepEqual(new Set(model.people.map((p) => p.teamSource)), new Set(['team field', 'Jira group', 'project key']))],
  ['collab: Ken~Ravi current via WEB-5 on WEB-3', () => { const c = model.collabEdges.find((x) => [x.a, x.b].map(nameOf).sort().join() === 'Ken,Ravi'); assert.ok(c?.current); assert.deepEqual(c.keys, ['WEB-3', 'WEB-5']); }],
  ['collab: Omar~Sofia current via API-3 on API-2', () => assert.ok(model.collabEdges.find((x) => [x.a, x.b].map(nameOf).sort().join() === 'Omar,Sofia')?.current)],
  ['collab: Mia~Ravi past only (Done sub-task DES-3)', () => assert.equal(model.collabEdges.find((x) => [x.a, x.b].map(nameOf).sort().join() === 'Mia,Ravi')?.current, false)],
  ['collab: reporter never makes a pair (Jo absent)', () => assert.ok(!model.collabEdges.some((x) => [x.a, x.b].map(nameOf).includes('Jo')))],
  ['collab: done helper is not coverage (DES-2 still solo)', () => assert.deepEqual(model.issues['DES-2'].workers.map(nameOf), ['Mia'])],
  ['quality: 2 of 13 open tasks have 2+ people', () => assert.deepEqual(q.openWithTwoPlus.sort(), ['API-2', 'WEB-3'])],
];
let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
