// Coverage-risk analysis. Pure: no React, no I/O.
// Input: the model from adapt(). Every function takes an `absent` set of
// accountIds so the whole analysis can be re-run live with people marked out.
//
// A person's coverage risk answers: "if this person is ALSO out (on top of
// whoever is already marked out), what stops?"

export const WEIGHTS = {
  orphan: 4, //          open task with nobody left doing work on it
  orphanTrouble: 2, //   ... and that task is already blocked or overdue
  waiting: 4, //         each distinct person left waiting (chains followed to the end)
  bridge: 2, //          each team pair this person alone connects
  leadChange: 2, //      each task that keeps going but changes lead
};

// A solo task only matters when something depends on it (spec: no "single owner"
// finding). Orphaned tasks with nothing waiting on them are listed, not scored.
export const ORPHAN_REQUIRES_DEPENDENT = true;

// ---------- index ----------
export function buildIndex(model) {
  const issues = model.issues;
  const down = new Map(); // blockerKey -> [waiterKey]
  const up = new Map(); //   waiterKey  -> [blockerKey]
  const push = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]));
  for (const d of model.dependencies) {
    if (!d.active) continue;
    push(down, d.blockerKey, d.waiterKey);
    push(up, d.waiterKey, d.blockerKey);
  }
  const openWork = Object.values(issues).filter((i) => i.kind === 'work' && i.isOpen);
  const personById = new Map(model.people.map((p) => [p.accountId, p]));
  return { model, issues, down, up, openWork, personById };
}

const nameOf = (ix, id) => (id ? ix.personById.get(id)?.firstName ?? id : 'unassigned');
const remaining = (issue, out) => issue.workers.filter((w) => !out.has(w));
const inTrouble = (issue) => issue.overdue || issue.statusBlocked;
const troubleWhy = (issue) =>
  [issue.statusBlocked && `status ${issue.status}`, issue.overdue && `overdue ${-issue.daysToDue}d`].filter(Boolean).join(', ');

// ---------- per-person analysis ----------
export function analyzePerson(ix, personId, absent = new Set()) {
  const out = new Set(absent);
  out.add(personId);
  const issue = (k) => ix.issues[k];

  // 1. Open tasks that would have no one doing work on them.
  const orphaned = [];
  for (const i of ix.openWork) {
    if (!i.workers.includes(personId)) continue;
    if (remaining(i, out).length) continue;
    const dependents = ix.down.get(i.key) ?? [];
    const scored = !ORPHAN_REQUIRES_DEPENDENT || dependents.length > 0;
    orphaned.push({
      key: i.key,
      summary: i.summary,
      role: i.owner === personId ? 'owner' : 'sub-task',
      dependents,
      scored,
      trouble: inTrouble(i),
      troubleWhy: troubleWhy(i),
    });
  }

  // 2. People left waiting: start from every task this absence stalls, follow
  //    active dependencies downstream to the end. `visited` guards cycles.
  const waiting = new Map(); // accountId -> {accountId, keys:[...], people:[...]}
  const visited = new Set(orphaned.map((o) => o.key));
  const queue = orphaned.map((o) => [o.key]);
  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];
    for (const w of ix.down.get(last) ?? []) {
      if (visited.has(w)) continue; // already reached by a shorter path (or a cycle)
      visited.add(w);
      const next = [...path, w];
      queue.push(next);
      for (const who of remaining(issue(w), out)) {
        if (waiting.has(who)) continue;
        waiting.set(who, { accountId: who, keys: next, people: waitPath(ix, next, who) });
      }
    }
  }

  // 3. Team pairs this person alone connects (on their side of the pair).
  const bridges = [];
  const me = ix.personById.get(personId);
  if (me) {
    const pairs = new Map(); // "A|B" -> {teams, sides:{team:Set}, keys:Set}
    for (const e of ix.model.edges) {
      if (e.fromTeam === e.toTeam) continue;
      const teams = [e.fromTeam, e.toTeam].sort();
      const id = teams.join('|');
      if (!pairs.has(id)) pairs.set(id, { teams, sides: { [teams[0]]: new Set(), [teams[1]]: new Set() }, keys: new Set() });
      const p = pairs.get(id);
      if (!absent.has(e.from)) p.sides[e.fromTeam].add(e.from);
      if (!absent.has(e.to)) p.sides[e.toTeam].add(e.to);
      for (const pr of e.pairs) if (e.from === personId || e.to === personId) { p.keys.add(pr.blockerKey); p.keys.add(pr.waiterKey); }
    }
    for (const p of pairs.values()) {
      const side = p.sides[me.team];
      if (side && side.size === 1 && side.has(personId)) {
        const other = p.teams.find((t) => t !== me.team);
        bridges.push({ teams: [me.team, other], other, keys: [...p.keys].sort() });
      }
    }
  }

  // 4. Tasks that keep going but change lead (lead = assignee, else reporter).
  const orphanKeys = new Set(orphaned.map((o) => o.key));
  const leadChanges = [];
  for (const i of ix.openWork) {
    if (i.lead !== personId || orphanKeys.has(i.key)) continue;
    const left = remaining(i, out);
    leadChanges.push({
      key: i.key,
      summary: i.summary,
      why:
        i.leadSource === 'reporter'
          ? `${nameOf(ix, personId)} is lead as reporter (no assignee)`
          : `${left.map((x) => nameOf(ix, x)).join(', ')} still working on it`,
    });
  }

  // Score with its components. Staleness is NOT part of it.
  const scoredOrphans = orphaned.filter((o) => o.scored);
  const components = [
    { rule: 'orphan', label: 'open task with no one left', each: WEIGHTS.orphan, count: scoredOrphans.length, keys: scoredOrphans.map((o) => o.key) },
    { rule: 'orphanTrouble', label: '…already blocked or overdue', each: WEIGHTS.orphanTrouble, count: scoredOrphans.filter((o) => o.trouble).length, keys: scoredOrphans.filter((o) => o.trouble).map((o) => o.key) },
    { rule: 'waiting', label: 'person left waiting', each: WEIGHTS.waiting, count: waiting.size, keys: uniq([...waiting.values()].flatMap((w) => w.keys)) },
    { rule: 'bridge', label: 'team pair connected only through them', each: WEIGHTS.bridge, count: bridges.length, keys: uniq(bridges.flatMap((b) => b.keys)) },
    { rule: 'leadChange', label: 'task whose lead would change', each: WEIGHTS.leadChange, count: leadChanges.length, keys: leadChanges.map((l) => l.key) },
  ].map((c) => ({ ...c, points: c.each * c.count }));
  const score = components.reduce((s, c) => s + c.points, 0);

  // Separate flag, never scored.
  const stale = ix.openWork
    .filter((i) => i.owner === personId && i.stale)
    .map((i) => ({ key: i.key, summary: i.summary, days: i.daysSinceUpdate }));

  return {
    accountId: personId,
    score,
    components,
    reasons: reasonFragments(components),
    orphaned,
    waiting: [...waiting.values()],
    bridges,
    leadChanges,
    stale,
  };
}

function reasonFragments(components) {
  const c = Object.fromEntries(components.map((x) => [x.rule, x]));
  const out = [];
  if (c.orphan.count) out.push({ rule: 'orphan', count: c.orphan.count, text: 'with no owner left', keys: c.orphan.keys });
  if (c.waiting.count) out.push({ rule: 'waiting', count: c.waiting.count, text: 'waiting', keys: c.waiting.keys });
  if (c.bridge.count) out.push({ rule: 'bridge', count: c.bridge.count, text: c.bridge.count === 1 ? 'sole team link' : 'sole team links', keys: c.bridge.keys });
  if (c.leadChange.count) out.push({ rule: 'leadChange', count: c.leadChange.count, text: c.leadChange.count === 1 ? 'lead change' : 'lead changes', keys: c.leadChange.keys });
  return out;
}

const uniq = (a) => [...new Set(a)];

// Like personPath, but ends with the person actually waiting: a sub-task helper on the
// last task is not its owner, so name them: Mia → Ken → Ravi → Leo (sub-task on WEB-3).
export function waitPath(ix, keys, who) {
  const names = personPath(ix, keys);
  const last = ix.issues[keys[keys.length - 1]];
  if (last.owner !== who) names.push(`${nameOf(ix, who)} (sub-task on ${last.key})`);
  return names;
}

// Issue path -> people path, collapsing repeats: [DES-2, WEB-2, WEB-3] -> Mia, Ken, Ravi
export function personPath(ix, keys) {
  const names = [];
  for (const k of keys) {
    const n = nameOf(ix, ix.issues[k].owner);
    if (names[names.length - 1] !== n) names.push(n);
  }
  return names;
}

// ---------- whole-team analysis ----------
export function analyzeAll(ix, absent = new Set()) {
  const candidates = ix.model.people.filter((p) => p.doesWork || p.roles.leads.length);
  const results = candidates.filter((p) => !absent.has(p.accountId)).map((p) => analyzePerson(ix, p.accountId, absent));
  const byId = new Map(results.map((r) => [r.accountId, r]));
  const ranking = results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || nameOf(ix, a.accountId).localeCompare(nameOf(ix, b.accountId)));
  return { byId, ranking, absentImpact: absentImpact(ix, absent) };
}

// What the CURRENT absence breaks: stalled tasks, broken edges, who is waiting.
export function absentImpact(ix, absent) {
  if (!absent.size) return { stalled: [], brokenEdgeIds: new Set(), waitingIds: new Set(), waiting: [], continuing: [], carriedCollabIds: new Set() };
  const stalled = ix.openWork.filter((i) => i.workers.some((w) => absent.has(w)) && remaining(i, absent).length === 0);
  const stalledKeys = new Set(stalled.map((i) => i.key));
  const brokenEdgeIds = new Set(
    ix.model.edges.filter((e) => absent.has(e.to) && e.pairs.some((p) => stalledKeys.has(p.blockerKey))).map((e) => e.id),
  );
  const waiting = new Map();
  const visited = new Set(stalledKeys);
  const queue = [...stalledKeys].map((k) => [k]);
  while (queue.length) {
    const path = queue.shift();
    for (const w of ix.down.get(path[path.length - 1]) ?? []) {
      if (visited.has(w)) continue;
      visited.add(w);
      const next = [...path, w];
      queue.push(next);
      for (const who of remaining(ix.issues[w], absent)) {
        if (!waiting.has(who)) waiting.set(who, { accountId: who, keys: next, people: waitPath(ix, next, who) });
      }
    }
  }
  // The positive side: open work an absent person is on that keeps going because someone else is on it too.
  const continuing = ix.openWork
    .filter((i) => i.workers.some((w) => absent.has(w)) && remaining(i, absent).length > 0)
    .map((i) => ({ key: i.key, summary: i.summary, out: i.workers.filter((w) => absent.has(w)), by: remaining(i, absent) }));
  const carriedCollabIds = new Set();
  for (const c of ix.model.collabEdges ?? []) {
    const [o, r] = absent.has(c.a) && !absent.has(c.b) ? [c.a, c.b] : absent.has(c.b) && !absent.has(c.a) ? [c.b, c.a] : [null, null];
    if (!o) continue;
    if (continuing.some((t) => t.out.includes(o) && t.by.includes(r) && c.tasks.some((x) => x.key === t.key))) carriedCollabIds.add(c.id);
  }
  return { stalled: [...stalledKeys], brokenEdgeIds, waitingIds: new Set(waiting.keys()), waiting: [...waiting.values()], continuing, carriedCollabIds };
}

// ---------- headline: downstream unblock count ----------
// Open tasks directly waiting on open work this person owns.
export function downstreamUnblock(ix, personId) {
  const mine = ix.openWork.filter((i) => i.owner === personId);
  const direct = new Map(); // waiterKey -> {key, summary, on:[blockerKey], alsoOn:[otherPersonIds]}
  for (const b of mine) {
    for (const w of ix.down.get(b.key) ?? []) {
      if (!direct.has(w)) {
        const others = (ix.up.get(w) ?? []).map((k) => ix.issues[k]).filter((x) => x.owner !== personId);
        direct.set(w, {
          key: w,
          summary: ix.issues[w].summary,
          ownerName: nameOf(ix, ix.issues[w].owner),
          on: [],
          alsoWaitsOn: others.map((x) => ({ key: x.key, who: nameOf(ix, x.owner) })),
        });
      }
      direct.get(w).on.push(b.key);
    }
  }
  // Everything further down the chain, for context.
  const seen = new Set([...mine.map((i) => i.key), ...direct.keys()]);
  const further = [];
  const queue = [...direct.keys()];
  while (queue.length) {
    for (const w of ix.down.get(queue.shift()) ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      further.push(w);
      queue.push(w);
    }
  }
  const tasks = [...direct.values()];
  const name = nameOf(ix, personId);
  const n = tasks.length;
  const sentence = n
    ? `${n} task${n === 1 ? '' : 's'} start${n === 1 ? 's' : ''} once ${name}'s blocking work is done.`
    : `No open tasks are waiting on ${name}'s work.`;
  return { count: n, tasks, further, sentence, blockerKeys: uniq(tasks.flatMap((t) => t.on)) };
}

// ---------- "who else has worked near this" (candidates, never a recommendation) ----------
export function nearbyPeople(ix, personId, absent = new Set(), max = 3) {
  const me = personId;
  const all = Object.values(ix.issues);
  const myWork = all.filter((i) => i.kind === 'work' && i.owner === me);
  const mySubs = all.filter((i) => i.kind === 'subtask' && i.owner === me);
  const myEpics = new Set(myWork.filter((i) => i.isOpen).map((i) => i.epicKey).filter(Boolean));
  const found = new Map(); // id -> {strength, reason, keys}
  const offer = (id, strength, reason, keys) => {
    if (!id || id === me || absent.has(id) || !ix.personById.get(id)?.doesWork) return;
    const cur = found.get(id);
    if (!cur || strength > cur.strength) found.set(id, { accountId: id, strength, reason, keys });
  };
  const me1 = nameOf(ix, me);
  // a) has a sub-task on my work (open or done)
  for (const w of myWork) for (const k of w.subtaskKeys) {
    const s = ix.issues[k];
    offer(s.owner, 4, `has sub-task ${s.key} '${s.summary}' on ${me1}'s ${w.key}`, [s.key, w.key]);
  }
  // b) owns work where I have a sub-task
  for (const s of mySubs) {
    const p = ix.issues[s.parentKey];
    if (p) offer(p.owner, 3, `owns ${p.key} '${p.summary}', where ${me1} has sub-task ${s.key}`, [p.key, s.key]);
  }
  // c) works in the same epic (open or done)
  for (const i of all) {
    if (i.kind === 'epic' || !i.epicKey || !myEpics.has(i.epicKey) || i.owner === me) continue;
    offer(i.owner, 2, `also worked in epic '${i.epicName}' (${i.key})`, [i.key]);
  }
  // d) directly linked to my work
  for (const e of ix.model.edges) {
    if (e.to === me) offer(e.from, 1, `${e.pairs[0].waiterKey} waits on ${me1}'s ${e.pairs[0].blockerKey}`, [e.pairs[0].blockerKey, e.pairs[0].waiterKey]);
    if (e.from === me) offer(e.to, 1, `${me1}'s ${e.pairs[0].waiterKey} waits on their ${e.pairs[0].blockerKey}`, [e.pairs[0].blockerKey, e.pairs[0].waiterKey]);
  }
  return [...found.values()]
    .sort((a, b) => b.strength - a.strength || nameOf(ix, a.accountId).localeCompare(nameOf(ix, b.accountId)))
    .slice(0, max)
    .map(({ strength, ...rest }) => ({ ...rest, name: nameOf(ix, rest.accountId) }));
}

// ---------- who this person works with (current and past) ----------
export function worksWith(ix, personId) {
  return (ix.model.collabEdges ?? [])
    .filter((c) => c.a === personId || c.b === personId)
    .map((c) => ({ ...c, other: c.a === personId ? c.b : c.a }))
    .sort((x, y) => Number(y.current) - Number(x.current) || y.weight - x.weight);
}
