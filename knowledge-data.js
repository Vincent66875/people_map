// Knowledge stage 1: who has worked on which work item, from Jira data only
// (assignees, sub-task assignees, changelog assignee changes). Prints records per
// person and the changelog parse report, then asserts the fixture cases.
// Usage: npm run check:knowledge
import assert from 'node:assert/strict';
import large from '../src/data/jiraMockLarge.js';
import small from '../src/data/jiraMock.js';
import { adapt } from '../src/analysis/adapter.js';

const model = adapt({ users: large.users, searchResponse: large.searchResponse, now: large.fetchedAt });
const nameOf = (id) => large.users.find((u) => u.accountId === id)?.displayName.split(' ')[0] ?? id;
const hr = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`);
const K = model.knowledge;

hr('KNOWLEDGE RECORDS PER PERSON');
const byPerson = new Map();
for (const k of K) (byPerson.get(k.person) ?? byPerson.set(k.person, []).get(k.person)).push(k);
for (const [p, ks] of [...byPerson].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))) {
  console.log(`${nameOf(p)} (${ks.length})`);
  for (const k of ks.sort((a, b) => a.daysAgo - b.daysAgo)) {
    const i = model.issues[k.issueKey];
    console.log(`   ${k.issueKey.padEnd(7)} ${k.how.padEnd(13)} ${k.current ? 'now   ' : 'before'} ${String(k.daysAgo).padStart(4)}d ago${k.via.length ? `  via ${k.via.join(', ')}` : ''}  · ${i.summary}${i.components.length ? ` [${i.components}]` : ''}${i.isDone ? ' (Done)' : ''}`);
  }
}

hr('CHANGELOG PARSE REPORT');
console.log(JSON.stringify(model.quality.knowledge, null, 2));

hr('ASSERTIONS');
const rec = (who, key, how) => K.find((k) => nameOf(k.person) === who && k.issueKey === key && (!how || k.how === how));
const cl = model.quality.knowledge.changelog;
const checks = [
  ['every record has person, issueKey, how, when', () => K.forEach((k) => assert.ok(k.person && k.issueKey && k.how && k.when))],
  ['how is only assignee | sub-task | past assignee', () => K.forEach((k) => assert.ok(['assignee', 'sub-task', 'past assignee'].includes(k.how), k.how))],
  ['changelog: Grace is past assignee of API-4 (2026-08-10)', () => assert.equal(rec('Grace', 'API-4', 'past assignee')?.when.slice(0, 10), '2026-08-10')],
  ['changelog: Mia past assignee of DES-5, Sam of OPS-5, Priya of WEB-6', () => { assert.ok(rec('Mia', 'DES-5', 'past assignee')); assert.ok(rec('Sam', 'OPS-5', 'past assignee')); assert.ok(rec('Priya', 'WEB-6', 'past assignee')); }],
  ['changelog on a sub-task: Priya credited on WEB-3 as sub-task via WEB-5', () => assert.deepEqual(rec('Priya', 'WEB-3', 'sub-task')?.via, ['WEB-5'])],
  ['changelog on Done work: Ken past assignee of WEB-10', () => assert.ok(rec('Ken', 'WEB-10', 'past assignee'))],
  ['deactivated past assignee (Dan on OPS-2) is not recorded', () => { assert.ok(!K.some((k) => k.person === '5f1a-dan')); assert.equal(cl.ignored.excludedAccount, 1); }],
  ['"from unassigned" changes are ignored (API-4, API-7)', () => assert.equal(cl.ignored.fromUnassigned, 2)],
  ['status-only history items are ignored (API-7)', () => assert.equal(cl.ignored.nonAssigneeItems, 1)],
  ['changelog counts: 9 issues with history, 11 assignee changes, 7 recorded', () => { assert.equal(cl.issuesWithHistory, 9); assert.equal(cl.assigneeChanges, 11); assert.equal(cl.recorded, 7); }],
  ['bounced assignment (OPS-7 Sam → Nora → Sam): Sam not re-recorded, Nora is past assignee', () => { assert.equal(cl.ignored.stillOnIt, 1); assert.ok(rec('Nora', 'OPS-7', 'past assignee')); assert.ok(!rec('Sam', 'OPS-7', 'past assignee')); }],
  ['current vs before: Ana on DES-2 now, Priya on WEB-3 before, Ravi on DES-2 before', () => { assert.equal(rec('Ana', 'DES-2').current, true); assert.equal(rec('Priya', 'WEB-3').current, false); assert.equal(rec('Ravi', 'DES-2').current, false); }],
  ['Done work is never current', () => K.filter((k) => model.issues[k.issueKey].isDone).forEach((k) => assert.equal(k.current, false))],
  ['sub-task by someone else credited to the parent: Ana on DES-2 via DES-4', () => assert.deepEqual(rec('Ana', 'DES-2', 'sub-task')?.via, ['DES-4'])],
  ['Done sub-task still counts: Ravi on DES-2 via DES-3', () => assert.ok(rec('Ravi', 'DES-2', 'sub-task'))],
  ['own sub-task is not a separate record: Omar has no sub-task record on API-4', () => assert.ok(!rec('Omar', 'API-4', 'sub-task'))],
  ['reporter never counts: Jo (reporter on everything) has no records', () => assert.ok(!K.some((k) => nameOf(k.person) === 'Jo'))],
  ['bots never count', () => assert.ok(!K.some((k) => k.person.includes('auto')))],
  ['epics are not work: no records on DES-1 / WEB-1 / API-1 / OPS-1', () => assert.ok(!K.some((k) => /-1$/.test(k.issueKey)))],
  ['old work kept as records (search drops it later): DES-12 ~15 months', () => assert.ok(rec('Mia', 'DES-12').daysAgo > 365)],
  ['components and labels parsed', () => { assert.deepEqual(model.issues['DES-2'].components, ['Tokens']); assert.deepEqual(model.issues['DES-7'].labels, ['checkout', 'a11y']); }],
  ['scores untouched: Done history never enters open work', () => assert.equal(model.quality.openWorkItems, 21)],
  ['small fixture still adapts with no changelog/components', () => {
    const m = adapt({ users: small.users, searchResponse: small.searchResponse, now: small.fetchedAt });
    assert.equal(m.quality.knowledge.changelog.issuesWithHistory, 0);
    assert.ok(m.knowledge.length > 0);
  }],
];
let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
