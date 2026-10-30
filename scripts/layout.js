// node scripts/layout.js [small|large] [zoom]
import { buildModel } from '../src/analysis/adapter.js';
import { graphData } from '../src/graph/graphData.js';
const [name = 'large', zoom = 'ticket'] = process.argv.slice(2);
const { default: fx } = await import(`../src/data/${name}.js`);
const m = buildModel(fx);
const { layout } = graphData(m, { zoom });
console.log('columns:', layout.order.join(' | '), ` size ${layout.width}x${layout.height}`);
for (const n of layout.nodes) console.log(`  ${n.name.padEnd(6)} c${n.col} r${n.row} (${Math.round(n.x)},${Math.round(n.y)}) r=${n.r.toFixed(1)}`);
for (const e of layout.edges) console.log(`  ${e.id.padEnd(14)} hits=${e.nodeHits} labelCollisions=${e.label.collisions} [${e.label.lines.join(' / ')}]`);
