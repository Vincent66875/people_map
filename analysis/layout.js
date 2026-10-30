// Person-graph layout. Pure geometry, no React, so it can be checked in node.
// Columns = teams. Rows = people, ordered by baseline coverage risk so nodes
// never jump around when someone is marked out.

export const GEOM = { colW: 200, rowH: 128, padX: 150, top: 96, bottom: 56 };

export const radiusFor = (score) => 16 + 5.5 * Math.sqrt(Math.max(0, score));

export function layoutGraph(people, edges, baselineScores) {
  const teams = [...new Set(people.map((p) => p.team))];
  // Teams that mostly wait on others sit left, teams others wait on sit right,
  // teams with no edges go last. Arrows then tend to run left -> right.
  const net = Object.fromEntries(teams.map((t) => [t, { out: 0, in: 0 }]));
  for (const e of edges) {
    if (e.fromTeam === e.toTeam) continue;
    if (net[e.fromTeam]) net[e.fromTeam].out += e.weight;
    if (net[e.toTeam]) net[e.toTeam].in += e.weight;
  }
  teams.sort((a, b) => {
    const ea = net[a].out + net[a].in === 0, eb = net[b].out + net[b].in === 0;
    if (ea !== eb) return ea ? 1 : -1;
    return net[b].out - net[b].in - (net[a].out - net[a].in) || a.localeCompare(b);
  });
  // Then reorder linked teams so cross-team arrows are as short as possible
  // (sum of weight × columns spanned). Exhaustive for up to 7 linked teams;
  // the heuristic order above breaks ties and is the fallback for more.
  const linked = teams.filter((t) => net[t].out + net[t].in > 0);
  if (linked.length > 2 && linked.length <= 7) {
    const cross = edges.filter((e) => e.fromTeam !== e.toTeam);
    const cost = (order) => {
      const at = Object.fromEntries(order.map((t, i) => [t, i]));
      return cross.reduce((s, e) => s + e.weight * Math.abs(at[e.fromTeam] - at[e.toTeam]), 0);
    };
    let best = linked, bestCost = cost(linked);
    const permute = (rest, acc) => {
      if (!rest.length) { const c = cost(acc); if (c < bestCost) { best = acc; bestCost = c; } return; }
      rest.forEach((t, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, t]));
    };
    permute(linked, []);
    teams.splice(0, linked.length, ...best);
  }

  const columns = teams.map((team, c) => {
    const members = people
      .filter((p) => p.team === team)
      .sort((a, b) => (baselineScores.get(b.accountId) ?? 0) - (baselineScores.get(a.accountId) ?? 0) || a.displayName.localeCompare(b.displayName));
    return { team, x: GEOM.padX + c * GEOM.colW, members };
  });
  const pos = new Map();
  for (const col of columns) {
    col.members.forEach((p, r) => pos.set(p.accountId, { x: col.x, y: GEOM.top + r * GEOM.rowH, col: columns.indexOf(col), row: r }));
  }
  const rows = Math.max(1, ...columns.map((c) => c.members.length));
  return {
    columns,
    pos,
    width: GEOM.padX * 2 + (columns.length - 1) * GEOM.colW,
    height: GEOM.top + (rows - 1) * GEOM.rowH + GEOM.bottom + 40,
    // keyboard order: column by column, top to bottom
    order: columns.flatMap((c) => c.members.map((m) => m.accountId)),
  };
}

// Quadratic curve from waiter to blocker, trimmed to the node rims.
export function edgePath(a, b, ra, rb, { reverse = false } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // left-hand normal of a->b
  const span = Math.abs((b.col ?? 0) - (a.col ?? 0));
  let bend = 0.12 * len;
  if (reverse) bend = Math.max(bend, 34);
  if (span === 0) bend = Math.max(70, 0.35 * len) * (nx > 0 ? -1 : 1); // same team: always bow out to the left
  if (span > 1) bend = Math.max(bend, GEOM.rowH); // skipping columns: dip into the gap between rows
  const cx = (a.x + b.x) / 2 + nx * bend;
  const cy = (a.y + b.y) / 2 + ny * bend;
  const toward = (p, q, r) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: p.x + ((q.x - p.x) / l) * r, y: p.y + ((q.y - p.y) / l) * r };
  };
  const s = toward(a, { x: cx, y: cy }, ra + 2);
  const e = toward(b, { x: cx, y: cy }, rb + 7); // room for the arrowhead
  const lx = 0.25 * s.x + 0.5 * cx + 0.25 * e.x;
  const ly = 0.25 * s.y + 0.5 * cy + 0.25 * e.y;
  const at = (t) => ({ x: r1((1 - t) ** 2 * s.x + 2 * t * (1 - t) * cx + t * t * e.x), y: r1((1 - t) ** 2 * s.y + 2 * t * (1 - t) * cy + t * t * e.y) });
  return { d: `M${r1(s.x)},${r1(s.y)} Q${r1(cx)},${r1(cy)} ${r1(e.x)},${r1(e.y)}`, label: { x: r1(lx), y: r1(ly) }, at };
}
const r1 = (n) => Math.round(n * 10) / 10;
