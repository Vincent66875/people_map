// Plain-language sentences for derived facts. Pure. No pronouns are guessed:
// Jira has no gender field, so we repeat first names instead of "her"/"his".

export function dueFragment(p) {
  if (p.blockerDaysToDue == null) return 'no due date';
  const d = p.blockerDaysToDue;
  if (d < 0) return `overdue by ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'due today';
  return `due in ${d} day${d === 1 ? '' : 's'}`;
}

export function blockerState(p) {
  const bits = [p.blockerStatus, dueFragment(p)];
  if (p.blockerStale) bits.push(`no update in ${p.blockerDaysSinceUpdate} days`);
  if (p.blockerBlocked && !/block/i.test(p.blockerStatus)) bits.push(`itself ${p.blockerBlockedReason}`);
  return bits.join(', ');
}

// "Ken waits on Mia: Mia's 'Design tokens' (In Progress, due in 3 days) blocks Ken's 'Token migration'."
export function pairSentence(edge, p, nameOf) {
  const waiter = nameOf(edge.from);
  const blocker = nameOf(edge.to);
  return `${waiter} waits on ${blocker}: ${blocker}'s '${p.blockerSummary}' [${p.blockerKey}] (${blockerState(p)}) blocks ${waiter}'s '${p.waiterSummary}' [${p.waiterKey}].`;
}

export function edgeSentences(edge, nameOf) {
  return edge.pairs.map((p) => pairSentence(edge, p, nameOf));
}

export const truncate = (s, n = 22) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const uniq = (a) => [...new Set(a)];

// ---------- zoom levels: all three are views of the SAME person edges ----------
export const ZOOMS = ['ticket', 'theme', 'team'];

// ticket -> "Design tokens blocks Token migration"
export function ticketLines(edges) {
  return edges.flatMap((e) =>
    e.pairs.map((p) => ({
      id: `${e.id}:${p.blockerKey}>${p.waiterKey}`,
      edgeIds: [e.id],
      text: `${p.blockerSummary} blocks ${p.waiterSummary}`,
      keys: [p.blockerKey, p.waiterKey],
    })),
  );
}

// theme -> "Design system refresh blocks Frontend rebuild"
export function themeLines(edges) {
  const groups = new Map();
  for (const e of edges) for (const p of e.pairs) {
    const b = p.blockerEpic ?? `(no epic) ${p.blockerKey.split('-')[0]}`;
    const w = p.waiterEpic ?? `(no epic) ${p.waiterKey.split('-')[0]}`;
    const id = `${b}>${w}`;
    if (!groups.has(id)) groups.set(id, { id, b, w, keys: [], edgeIds: new Set(), n: 0 });
    const g = groups.get(id);
    g.n++;
    g.keys.push(p.blockerKey, p.waiterKey);
    g.edgeIds.add(e.id);
  }
  return [...groups.values()].map((g) => ({
    id: g.id,
    edgeIds: [...g.edgeIds],
    keys: uniq(g.keys),
    text: g.b === g.w ? `Within ${g.b}: ${g.n} task${g.n === 1 ? ' waits' : 's wait'} on others in the same epic` : `${g.b} work blocks ${g.w} work${g.n > 1 ? ` (${g.n} links)` : ''}`,
  }));
}

// team -> "Frontend waits on Design, through Mia only". Derived from person edges.
export function teamLines(edges, nameOf, absent = new Set(), collabEdges = null) {
  const groups = new Map();
  for (const e of edges) {
    const id = `${e.fromTeam}>${e.toTeam}`;
    if (!groups.has(id)) groups.set(id, { id, from: e.fromTeam, to: e.toTeam, blockers: new Set(), waiters: new Set(), pairs: [], keys: [], edgeIds: [], n: 0 });
    const g = groups.get(id);
    g.pairs.push([e.from, e.to]);
    g.blockers.add(e.to);
    g.waiters.add(e.from);
    g.edgeIds.push(e.id);
    g.n += e.weight;
    for (const p of e.pairs) g.keys.push(p.blockerKey, p.waiterKey);
  }
  const lines = [...groups.values()].map((g) => {
    const blockers = [...g.blockers];
    const names = blockers.map(nameOf);
    const out = blockers.filter((b) => absent.has(b));
    const outNote = out.length ? ` — ${list(out.map(nameOf))} ${out.length === 1 ? 'is' : 'are'} out` : '';
    const shared = g.from === g.to || !collabEdges ? { note: '', keys: [] } : sharedBetween(collabEdges, g.from, g.to);
    const text =
      g.from === g.to
        ? `Within ${g.from}, ${list(g.pairs.map(([w, b]) => `${nameOf(w)} waits on ${nameOf(b)}`))}${outNote}`
        : `${g.from} waits on ${g.to}, through ${list(names)}${blockers.length === 1 ? ' only' : ''}${shared.note}${outNote}`;
    return { id: g.id, edgeIds: g.edgeIds, keys: uniq([...g.keys, ...shared.keys]), text, sole: blockers.length === 1, cold: !!collabEdges && !shared.keys.length && g.from !== g.to, broken: out.length > 0 && out.length === blockers.length };
  });
  // Team pairs that share work but have no dependency either way.
  const depPairs = new Set([...groups.values()].map((g) => [g.from, g.to].sort().join('|')));
  const collabPairs = new Map();
  for (const c of collabEdges ?? []) {
    if (c.aTeam === c.bTeam) continue;
    const id = [c.aTeam, c.bTeam].sort().join('|');
    if (depPairs.has(id)) continue;
    if (!collabPairs.has(id)) collabPairs.set(id, []);
    collabPairs.get(id).push(c);
  }
  for (const [id, cs] of collabPairs) {
    const [t1, t2] = id.split('|');
    const keys = uniq(cs.flatMap((c) => c.tasks.map((t) => t.key)));
    lines.push({ id: `collab:${id}`, edgeIds: cs.map((c) => c.id), keys, text: `${t1} and ${t2} share work on ${keys.join(', ')} (no dependency)`, sole: false, cold: false, broken: false });
  }
  return lines;
}

// ---------- collaboration sentences ----------
// "Ken and Ravi work together: Ken has sub-task WEB-5 on Ravi's 'Checkout page restyle' [WEB-3]."
export function collabTaskSentence(c, t, nameOf) {
  const [x, y] = [c.a, c.b];
  const rx = t.roles[x], ry = t.roles[y];
  const owner = rx.role === 'assignee' ? x : ry.role === 'assignee' ? y : null;
  const verb = t.current ? 'has' : 'had';
  let body;
  if (owner) {
    const helper = owner === x ? y : x;
    const via = t.roles[helper].viaKeys.join(', ');
    body = `${nameOf(helper)} ${verb} sub-task ${via} on ${nameOf(owner)}'s '${t.summary}' [${t.key}]`;
  } else {
    body = `both ${t.current ? 'have' : 'had'} sub-tasks on '${t.summary}' [${t.key}] (${rx.viaKeys.join(', ')} / ${ry.viaKeys.join(', ')})`;
  }
  return `${nameOf(x)} and ${nameOf(y)} ${t.current ? 'work together' : 'worked together before'}: ${body}.`;
}

export function collabSentences(c, nameOf) {
  return c.tasks.map((t) => collabTaskSentence(c, t, nameOf));
}

export function collabLabel(c, zoom) {
  if (zoom === 'team') return c.aTeam === c.bTeam ? `within ${c.aTeam}` : `${c.aTeam}–${c.bTeam}`;
  const k = c.tasks.map((t) => t.key);
  return `${c.current ? 'shares' : 'shared'} ${k[0]}${k.length > 1 ? ` +${k.length - 1}` : ''}`;
}

// Shared work between two teams, for the team sentence.
function sharedBetween(collabEdges, t1, t2) {
  const hits = collabEdges.filter((c) => (c.aTeam === t1 && c.bTeam === t2) || (c.aTeam === t2 && c.bTeam === t1));
  if (!hits.length) return { note: ' · no shared work', keys: [] };
  const keys = uniq(hits.flatMap((c) => c.tasks.map((t) => t.key)));
  const current = hits.some((c) => c.current);
  return { note: current ? ` · shared work on ${keys.join(', ')}` : ` · shared work before (${keys.join(', ')})`, keys };
}

// Short label drawn on a graph edge for the current zoom.
export function edgeLabel(edge, zoom, allEdges) {
  if (zoom === 'theme') {
    const epics = uniq(edge.pairs.map((p) => p.blockerEpic ?? p.blockerKey.split('-')[0]));
    return truncate(epics.join(' + '), 24);
  }
  if (zoom === 'team') {
    if (edge.fromTeam === edge.toTeam) return `within ${edge.fromTeam}`;
    const same = allEdges.filter((e) => e.fromTeam === edge.fromTeam && e.toTeam === edge.toTeam).length;
    return same === 1 ? `only ${edge.fromTeam}→${edge.toTeam} link` : `1 of ${same} ${edge.fromTeam}→${edge.toTeam}`;
  }
  const first = truncate(edge.pairs[0].blockerSummary);
  return edge.weight > 1 ? `${first} ×${edge.weight}` : first;
}
