// Print the adapter output for a fixture: node scripts/inspect.js [small|large]
import { buildModel, provenance } from '../src/analysis/adapter.js';

const name = process.argv[2] ?? 'large';
const { default: fixture } = await import(`../src/data/${name}.js`);
const m = buildModel(fixture);
const n = m.nameOf;

console.log(`== ${name} ==`);
console.log(provenance(m).text);
console.log('\nPeople:');
for (const p of m.people) console.log(`  ${p.name.padEnd(6)} ${String(p.team).padEnd(9)} (${p.teamSource})${p.reporterOnly ? ' reporter-only' : ''} open=${p.openKeys.join(',')}`);
console.log('Excluded:', m.excluded.map((e) => `${e.displayName} (${e.reason}) on ${e.keys.join(',')}`).join('; '));
console.log('\nDependencies:');
for (const d of m.dependencies) console.log(`  ${d.waiterKey} waits on ${d.blockerKey}  links=${d.linkIds.join(',')} ${d.open ? 'open' : 'resolved'}`);
console.log('\nPerson edges:');
for (const e of m.personEdges) for (const p of e.pairs) console.log(`  [w${e.weight}${e.red ? ' red' : ''}] ${p.sentence}`);
console.log('\nKnowledge records:');
for (const k of m.knowledge) console.log(`  ${k.issueKey.padEnd(7)} ${n(k.person).padEnd(5)} ${k.how.padEnd(14)} via ${k.via.padEnd(7)} ${k.current ? 'now   ' : 'before'} ${k.when.slice(0, 10)}`);
console.log('\nData quality:');
const dq = m.dataQuality;
console.log(JSON.stringify({
  issues: { total: dq.issues.total, epics: dq.issues.epics.length, subtasks: dq.issues.subtasks.length, openWork: dq.issues.openWork.length },
  openWorkAssigned: dq.openWorkAssigned,
  links: Object.fromEntries(Object.entries(dq.links).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.linkId) : v])),
  dependencies: { total: dq.dependencies.total, open: dq.dependencies.open.length, resolved: dq.dependencies.resolved },
  blockersWithoutAssignee: dq.blockersWithoutAssignee,
  teamSources: Object.fromEntries(Object.entries(dq.teamSources).map(([k, v]) => [k, v.map(n)])),
  secondPerson: dq.secondPerson,
  stale: dq.stale,
  changelog: dq.changelog,
}, null, 1));
