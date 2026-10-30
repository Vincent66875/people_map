// Jira REST -> derived model. Pure: no React, no I/O, no Date.now().
// Everything here is derived from fields Jira already has. Nothing is entered.

export const DEP_LINK_RE = /block|depend/i;
export const STALE_DAYS = 14;
export const OPEN_PROGRESS_CAP = 0.95;
const STATUS_PROGRESS_DEFAULT = { new: 0, indeterminate: 0.5, done: 1 };
const DEFAULT_GROUP_RE = /^(jira-|confluence-|site-|org-|atlassian-|administrators$|users$)/i;
const BOT_NAME_RE = /\b(bot|automation|service account|integration)\b/i;
const BLOCKED_STATUS_RE = /block|on hold|waiting/i;
const DAY = 86_400_000;
// Red edge = blocker overdue or in a Blocked-type status. A blocker that is merely
// waiting on another open link is NOT red by default: in a chain, every edge but the
// first would go red and the signal drowns. Flip to true to include it.
export const RED_ON_UPSTREAM_WAIT = false;

// Jira timestamps come as "2026-10-25T14:00:00.000-0400"; add the colon for strict parsers.
const parseTs = (s) => (s ? Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN);
const parseDay = (s) => (s ? Date.parse(`${s}T00:00:00Z`) : NaN);
const dayOf = (ms) => parseDay(new Date(ms).toISOString().slice(0, 10));

// ---------- link direction ----------
// Returns which end of a link's OUTWARD phrase is the blocker.
// "A blocks B"      -> source is blocker
// "A depends on B"  -> target is blocker
export function outwardSourceRole(type) {
  const o = (type?.outward || '').toLowerCase();
  if (/blocked by|depends on|waits on|requires|needs/.test(o)) return { role: 'waiter', inferred: false };
  if (/blocks|is depended on|is required by|is needed by/.test(o)) return { role: 'blocker', inferred: false };
  return { role: 'blocker', inferred: true }; // unknown wording: assume Jira default "Blocks"
}

// ---------- people ----------
function classifyAccount(user) {
  if (!user) return 'missing';
  if (user.active === false) return 'deactivated';
  if (user.accountType && user.accountType !== 'atlassian') return `non-human account (${user.accountType})`;
  if (BOT_NAME_RE.test(user.displayName || '')) return 'bot-like display name';
  return null;
}

export function adapt({ users = [], searchResponse, now }) {
  const nowMs = typeof now === 'number' ? now : parseTs(now);
  if (Number.isNaN(nowMs)) throw new Error('adapt(): `now` is required (pass the fetch timestamp)');
  const today = dayOf(nowMs);
  const rawIssues = searchResponse?.issues ?? [];

  // Directory of accounts. Issue-embedded user objects fill gaps.
  const directory = new Map(users.map((u) => [u.accountId, u]));
  for (const i of rawIssues) {
    for (const r of [i.fields.assignee, i.fields.reporter]) {
      if (r && !directory.has(r.accountId)) directory.set(r.accountId, r);
    }
  }
  const excluded = new Map(); // accountId -> {accountId, displayName, reason}
  for (const u of directory.values()) {
    const reason = classifyAccount(u);
    if (reason) excluded.set(u.accountId, { accountId: u.accountId, displayName: u.displayName, reason });
  }
  const human = (ref) => (ref && !excluded.has(ref.accountId) ? ref.accountId : null);

  // ---------- issues ----------
  const issues = new Map();
  for (const raw of rawIssues) {
    const f = raw.fields;
    const cat = f.status?.statusCategory?.key ?? 'new';
    const isDone = cat === 'done';
    const kind = f.issuetype?.subtask ? 'subtask' : (f.issuetype?.hierarchyLevel ?? 0) >= 1 ? 'epic' : 'work';
    const updatedMs = parseTs(f.updated);
    const dueMs = parseDay(f.duedate);
    const daysToDue = Number.isNaN(dueMs) ? null : Math.round((dueMs - today) / DAY);
    const daysSinceUpdate = Number.isNaN(updatedMs) ? null : Math.floor((nowMs - updatedMs) / DAY);
    const rawAssignee = f.assignee?.accountId ?? null;
    issues.set(raw.key, {
      key: raw.key,
      summary: f.summary,
      kind,
      project: f.project?.key ?? raw.key.split('-')[0],
      status: f.status?.name ?? 'Unknown',
      statusCategory: cat,
      isDone,
      isOpen: !isDone,
      owner: human(f.assignee),
      ownerExcluded: rawAssignee && excluded.has(rawAssignee) ? rawAssignee : null,
      reporter: f.reporter?.accountId ?? null,
      reporterIsHuman: !!human(f.reporter),
      parentKey: f.parent?.key ?? null,
      due: f.duedate ?? null,
      daysToDue,
      overdue: !isDone && daysToDue != null && daysToDue < 0,
      updated: f.updated ?? null,
      daysSinceUpdate,
      stale: !isDone && daysSinceUpdate != null && daysSinceUpdate > STALE_DAYS,
      statusBlocked: !isDone && BLOCKED_STATUS_RE.test(f.status?.name ?? ''),
      storyPoints: f.customfield_10016 ?? f.storyPoints ?? null,
      components: (f.components ?? []).map((c) => c.name),
      labels: f.labels ?? [],
      resolved: f.resolutiondate ?? null,
      rawChangelog: raw.changelog?.histories ?? [],
      subtaskKeys: [],
      helpers: [], // [{accountId, viaKey, open}]
      rawLinks: f.issuelinks ?? [],
    });
  }

  // Parent / sub-task / epic wiring.
  for (const i of issues.values()) {
    if (i.kind === 'subtask' && i.parentKey && issues.has(i.parentKey)) {
      const p = issues.get(i.parentKey);
      p.subtaskKeys.push(i.key);
      if (i.owner && i.owner !== p.owner) p.helpers.push({ accountId: i.owner, viaKey: i.key, open: i.isOpen });
    }
  }
  const epicOf = (i) => {
    let cur = i;
    for (let hops = 0; cur && hops < 5; hops++) {
      if (cur.kind === 'epic') return cur;
      cur = cur.parentKey ? issues.get(cur.parentKey) : null;
    }
    return null;
  };
  // A sub-task's links roll up to this key.
  const workKeyOf = (key) => {
    const i = issues.get(key);
    if (!i) return key;
    return i.kind === 'subtask' && i.parentKey && issues.has(i.parentKey) ? i.parentKey : key;
  };

  for (const i of issues.values()) {
    const epic = epicOf(i);
    i.epicKey = epic && epic !== i ? epic.key : null;
    i.epicName = epic && epic !== i ? epic.summary : null;

    // lead = assignee, fallback reporter (humans only)
    if (i.owner) { i.lead = i.owner; i.leadSource = 'assignee'; }
    else if (i.reporterIsHuman) { i.lead = i.reporter; i.leadSource = 'reporter'; }
    else { i.lead = null; i.leadSource = 'none'; }

    // progress
    if (i.subtaskKeys.length) {
      const done = i.subtaskKeys.filter((k) => issues.get(k).isDone).length;
      i.progress = done / i.subtaskKeys.length;
      i.progressSource = `${done}/${i.subtaskKeys.length} sub-tasks done`;
    } else {
      i.progress = STATUS_PROGRESS_DEFAULT[i.statusCategory] ?? 0;
      i.progressSource = `status default (${i.statusCategory})`;
    }
    if (i.isOpen) i.progress = Math.min(i.progress, OPEN_PROGRESS_CAP);

    // coverage = distinct humans doing actual work on OPEN work (reporter excluded)
    const workers = new Set([i.owner, ...i.helpers.filter((h) => h.open).map((h) => h.accountId)].filter(Boolean));
    i.workers = [...workers];
  }

  // ---------- dependencies (issue level) ----------
  const depMap = new Map(); // "blocker>waiter" -> dep
  const ignoredLinks = new Map(); // id -> type name
  const inferredDirection = new Set();
  for (const i of issues.values()) {
    for (const l of i.rawLinks) {
      if (!DEP_LINK_RE.test(l.type?.name ?? '')) { ignoredLinks.set(l.id, l.type?.name ?? '?'); continue; }
      const otherKey = (l.outwardIssue ?? l.inwardIssue)?.key;
      if (!otherKey) continue;
      const [source, target] = l.outwardIssue ? [i.key, otherKey] : [otherKey, i.key];
      const { role, inferred } = outwardSourceRole(l.type);
      if (inferred) inferredDirection.add(l.id);
      const [blockerRaw, waiterRaw] = role === 'blocker' ? [source, target] : [target, source];
      const blockerKey = workKeyOf(blockerRaw);
      const waiterKey = workKeyOf(waiterRaw);
      if (blockerKey === waiterKey) continue; // a sub-task blocking its own parent
      const id = `${blockerKey}>${waiterKey}`;
      let d = depMap.get(id);
      if (!d) {
        d = { id, blockerKey, waiterKey, linkIds: new Set(), viaSubtask: new Set(), linkTypes: new Set() };
        depMap.set(id, d);
      }
      d.linkIds.add(l.id);
      d.linkTypes.add(l.type.name);
      if (blockerRaw !== blockerKey) d.viaSubtask.add(blockerRaw);
      if (waiterRaw !== waiterKey) d.viaSubtask.add(waiterRaw);
    }
  }

  const dependencies = [...depMap.values()].map((d) => {
    const b = issues.get(d.blockerKey);
    const w = issues.get(d.waiterKey);
    let inactiveReason = null;
    if (!b || !w) inactiveReason = 'linked issue not in result set';
    else if (b.isDone) inactiveReason = 'blocker is Done';
    else if (w.isDone) inactiveReason = 'waiting issue is Done';
    return {
      ...d,
      linkIds: [...d.linkIds].sort(),
      viaSubtask: [...d.viaSubtask].sort(),
      linkTypes: [...d.linkTypes],
      active: !inactiveReason,
      inactiveReason,
    };
  });
  const activeDeps = dependencies.filter((d) => d.active);

  // A blocker is "itself blocked" if it is waiting on another open dependency.
  const waitingOn = new Map();
  for (const d of activeDeps) {
    if (!waitingOn.has(d.waiterKey)) waitingOn.set(d.waiterKey, []);
    waitingOn.get(d.waiterKey).push(d.blockerKey);
  }
  for (const i of issues.values()) {
    const upstream = waitingOn.get(i.key) ?? [];
    i.waitingOnKeys = upstream;
    i.blocked = i.statusBlocked || upstream.length > 0;
    i.blockedReason = i.statusBlocked
      ? `status "${i.status}"`
      : upstream.length ? `waiting on ${upstream.join(', ')}` : null;
    delete i.rawLinks;
  }

  // ---------- people & teams ----------
  const roleSets = new Map();
  const role = (id) => {
    if (!roleSets.has(id)) roleSets.set(id, { owns: [], helps: [], leads: [], reports: [], history: [] });
    return roleSets.get(id);
  };
  // Scope: open work. Done work is kept only as history ("who has worked near this").
  for (const i of issues.values()) {
    if (i.kind === 'epic') continue;
    if (i.isDone) { if (i.owner) role(i.owner).history.push(i.key); continue; }
    if (i.kind === 'work') {
      if (i.owner) role(i.owner).owns.push(i.key);
      for (const h of i.helpers) if (h.open) role(h.accountId).helps.push(h.viaKey);
      if (i.lead) role(i.lead).leads.push(i.key);
      if (i.reporterIsHuman) role(i.reporter).reports.push(i.key);
    }
  }

  const people = [];
  for (const [accountId, roles] of roleSets) {
    if (excluded.has(accountId)) continue;
    const u = directory.get(accountId) ?? { displayName: accountId };
    let team, teamSource;
    const group = (u.groups?.items ?? []).map((g) => g.name).find((n) => !DEFAULT_GROUP_RE.test(n));
    if (u.team) { team = u.team; teamSource = 'team field'; }
    else if (group) { team = group; teamSource = 'Jira group'; }
    else {
      const counts = {};
      for (const k of [...roles.owns, ...roles.helps, ...roles.history, ...roles.reports]) {
        const p = issues.get(k).project;
        counts[p] = (counts[p] ?? 0) + 1;
      }
      team = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'Unknown';
      teamSource = 'project key';
    }
    people.push({
      accountId,
      displayName: u.displayName,
      firstName: (u.displayName ?? '').split(' ')[0],
      team,
      teamSource,
      roles,
      doesWork: roles.owns.length + roles.helps.length > 0,
    });
  }
  people.sort((a, b) => a.team.localeCompare(b.team) || a.displayName.localeCompare(b.displayName));
  const personById = new Map(people.map((p) => [p.accountId, p]));

  // ---------- person edges: waiter --waits on--> blocker, collapsed ----------
  const edgeMap = new Map();
  const unpersoned = []; // active deps where one end has no human owner
  for (const d of activeDeps) {
    const b = issues.get(d.blockerKey);
    const w = issues.get(d.waiterKey);
    if (!b.owner || !w.owner) { unpersoned.push({ ...d, missing: !b.owner ? 'blocker' : 'waiter' }); continue; }
    if (b.owner === w.owner) continue; // person waits on themselves: not a cross-person edge
    const id = `${w.owner}->${b.owner}`;
    if (!edgeMap.has(id)) edgeMap.set(id, { id, from: w.owner, to: b.owner, pairs: [] });
    edgeMap.get(id).pairs.push({
      depId: d.id,
      linkIds: d.linkIds,
      viaSubtask: d.viaSubtask,
      blockerKey: b.key,
      blockerSummary: b.summary,
      blockerStatus: b.status,
      blockerDue: b.due,
      blockerDaysToDue: b.daysToDue,
      blockerOverdue: b.overdue,
      blockerStale: b.stale,
      blockerDaysSinceUpdate: b.daysSinceUpdate,
      blockerBlocked: b.blocked,
      blockerStatusBlocked: b.statusBlocked,
      blockerBlockedReason: b.blockedReason,
      blockerEpic: b.epicName,
      waiterKey: w.key,
      waiterSummary: w.summary,
      waiterEpic: w.epicName,
    });
  }
  const edges = [...edgeMap.values()].map((e) => {
    e.pairs.sort((a, b) => a.blockerKey.localeCompare(b.blockerKey) || a.waiterKey.localeCompare(b.waiterKey));
    return {
      ...e,
      fromTeam: personById.get(e.from)?.team,
      toTeam: personById.get(e.to)?.team,
      weight: e.pairs.length,
      red: e.pairs.some((p) => p.blockerOverdue || p.blockerStatusBlocked || (RED_ON_UPSTREAM_WAIT && p.blockerBlocked)),
    };
  });

  // ---------- collaboration: people who work on the same task (undirected) ----------
  // Who counts: the assignee and sub-task assignees. Reporter never counts.
  // current = the task is open and both people are still on it (assignee or OPEN sub-task);
  // otherwise it is past collaboration (Done task, or a Done sub-task).
  const collabMap = new Map();
  for (const i of issues.values()) {
    if (i.kind !== 'work') continue;
    const people = new Map(); // accountId -> {role, viaKeys:[], open}
    const add = (id, role, via, open) => {
      if (!id || !personById.has(id)) return;
      const cur = people.get(id) ?? { role, viaKeys: [], open: false };
      if (role === 'assignee') cur.role = 'assignee';
      if (via) cur.viaKeys.push(via);
      cur.open = cur.open || open;
      people.set(id, cur);
    };
    add(i.owner, 'assignee', null, i.isOpen);
    for (const h of i.helpers) add(h.accountId, 'sub-task', h.viaKey, i.isOpen && h.open);
    const ids = [...people.keys()].sort();
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const [a, b] = [ids[x], ids[y]];
      const id = `${a}~${b}`;
      if (!collabMap.has(id)) collabMap.set(id, { id, a, b, tasks: [] });
      collabMap.get(id).tasks.push({
        key: i.key,
        summary: i.summary,
        current: people.get(a).open && people.get(b).open,
        roles: { [a]: { ...people.get(a), viaKeys: [...people.get(a).viaKeys] }, [b]: { ...people.get(b), viaKeys: [...people.get(b).viaKeys] } },
      });
    }
  }
  const collabEdges = [...collabMap.values()].map((c) => ({
    ...c,
    aTeam: personById.get(c.a).team,
    bTeam: personById.get(c.b).team,
    weight: c.tasks.length,
    current: c.tasks.some((t) => t.current),
    keys: [...new Set(c.tasks.flatMap((t) => [t.key, ...Object.values(t.roles).flatMap((r) => r.viaKeys)]))],
  }));

  // ---------- knowledge: who has worked on which work item ----------
  // One record per (person, work item, how). Sub-task work is credited to the parent work
  // item, so a search on WEB-3 finds Leo's sub-task WEB-5. Epics are themes, not work.
  //   assignee       current assignee (open or Done); when = last update / resolution
  //   sub-task       assignee of a sub-task, current or past, who isn't the parent's assignee
  //   past assignee  assignee before an assignee change in the changelog; when = change date
  // current = they are on it now (open work, open sub-task). when for current work is the
  // issue's last update, an approximation of "last worked on".
  // Never counted: reporter, bots/apps, deactivated accounts, "from unassigned" changes.
  const knowledgeMap = new Map();
  const changelogReport = { issuesWithHistory: 0, assigneeChanges: 0, recorded: 0, ignored: { fromUnassigned: 0, excludedAccount: 0, stillOnIt: 0, nonAssigneeItems: 0 } };
  const isHumanId = (id) => !!id && directory.has(id) && !excluded.has(id);
  const lastTouch = (i) => (i.isDone ? i.resolved ?? i.updated : i.updated);
  const addKnowledge = (person, issueKey, how, when, via = null, current = false) => {
    if (!isHumanId(person) || !when) return false;
    const id = `${person}|${issueKey}|${how}`;
    const cur = knowledgeMap.get(id);
    if (!cur) knowledgeMap.set(id, { person, issueKey, how, when, current, via: via ? [via] : [] });
    else {
      if (parseTs(when) > parseTs(cur.when)) cur.when = when;
      if (via && !cur.via.includes(via)) cur.via.push(via);
      cur.current = cur.current || current;
    }
    return true;
  };
  for (const i of issues.values()) {
    if (i.kind === 'epic') continue;
    const isSub = i.kind === 'subtask';
    const workKey = workKeyOf(i.key);
    const work = issues.get(workKey);
    if (!isSub) {
      if (i.owner) addKnowledge(i.owner, i.key, 'assignee', lastTouch(i), null, i.isOpen);
    } else if (i.owner && i.owner !== work.owner) {
      addKnowledge(i.owner, workKey, 'sub-task', lastTouch(i), i.key, i.isOpen && work.isOpen);
    }
    if (i.rawChangelog.length) changelogReport.issuesWithHistory++;
    for (const h of i.rawChangelog) {
      for (const item of h.items ?? []) {
        if ((item.fieldId ?? item.field) !== 'assignee') { changelogReport.ignored.nonAssigneeItems++; continue; }
        changelogReport.assigneeChanges++;
        const from = item.from;
        if (!from) { changelogReport.ignored.fromUnassigned++; continue; }
        if (!isHumanId(from)) { changelogReport.ignored.excludedAccount++; continue; }
        // Still on it: their current role already records them (assignee or sub-task owner).
        if (from === i.owner || (isSub && from === work.owner)) { changelogReport.ignored.stillOnIt++; continue; }
        if (addKnowledge(from, workKey, isSub ? 'sub-task' : 'past assignee', h.created, isSub ? i.key : null)) changelogReport.recorded++;
      }
    }
    delete i.rawChangelog;
  }
  const knowledge = [...knowledgeMap.values()]
    .map((k) => ({ ...k, daysAgo: Math.max(0, Math.floor((nowMs - parseTs(k.when)) / DAY)) }))
    .sort((a, b) => a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }) || a.daysAgo - b.daysAgo);

  // ---------- data quality ----------
  const all = [...issues.values()];
  const workItems = all.filter((i) => i.kind !== 'epic');
  const openWork = workItems.filter((i) => i.isOpen && i.kind === 'work');
  const assignedOpen = openWork.filter((i) => i.owner);
  const uniqueDepLinkIds = new Set(dependencies.flatMap((d) => d.linkIds));
  const quality = {
    issuesFetched: all.length,
    byKind: {
      epic: all.filter((i) => i.kind === 'epic').length,
      work: all.filter((i) => i.kind === 'work').length,
      subtask: all.filter((i) => i.kind === 'subtask').length,
    },
    openWorkItems: openWork.length,
    doneHistory: workItems.filter((i) => i.isDone).map((i) => i.key),
    pctOpenAssigned: openWork.length ? Math.round((assignedOpen.length / openWork.length) * 100) : 100,
    unassignedOpen: openWork.filter((i) => !i.owner).map((i) => ({
      key: i.key,
      why: i.ownerExcluded ? `assignee excluded (${excluded.get(i.ownerExcluded).reason})` : 'no assignee',
    })),
    dependencyLinks: uniqueDepLinkIds.size,
    dependencyPairsAfterRollup: dependencies.length,
    activeDependencies: activeDeps.length,
    resolvedDependencies: dependencies.filter((d) => !d.active).map((d) => ({ id: d.id, why: d.inactiveReason })),
    collapsedDuplicates: dependencies.filter((d) => d.linkIds.length > 1).map((d) => ({ id: d.id, linkIds: d.linkIds })),
    rolledUpFromSubtasks: dependencies.filter((d) => d.viaSubtask.length).map((d) => ({ id: d.id, via: d.viaSubtask })),
    nonDependencyLinksIgnored: [...ignoredLinks].map(([id, type]) => ({ id, type })),
    directionInferred: [...inferredDirection],
    withSubtaskHelpers: workItems.filter((i) => i.helpers.length).map((i) => i.key),
    openWithTwoPlus: openWork.filter((i) => i.workers.length >= 2).map((i) => i.key),
    pctOpenWithTwoPlus: openWork.length ? Math.round((openWork.filter((i) => i.workers.length >= 2).length / openWork.length) * 100) : 0,
    collaborationPairs: collabEdges.length,
    blockersWithNoAssignee: unpersoned
      .filter((d) => d.missing === 'blocker')
      .map((d) => ({ blockerKey: d.blockerKey, waiterKey: d.waiterKey })),
    waitersWithNoAssignee: unpersoned
      .filter((d) => d.missing === 'waiter')
      .map((d) => ({ blockerKey: d.blockerKey, waiterKey: d.waiterKey })),
    excludedAccounts: [...excluded.values()],
    teamSources: Object.fromEntries(people.map((p) => [p.displayName, `${p.team} (${p.teamSource})`])),
    stale: workItems.filter((i) => i.stale).map((i) => ({ key: i.key, days: i.daysSinceUpdate })),
    knowledge: {
      records: knowledge.length,
      byHow: Object.fromEntries(['assignee', 'sub-task', 'past assignee'].map((h) => [h, knowledge.filter((k) => k.how === h).length])),
      oldestDaysAgo: knowledge.reduce((m, k) => Math.max(m, k.daysAgo), 0),
      withComponent: workItems.filter((i) => i.components.length).length,
      withLabel: workItems.filter((i) => i.labels.length).length,
      openWithSomeoneElse: openWork.filter((i) => knowledge.some((k) => k.issueKey === i.key && k.person !== i.owner)).map((i) => i.key),
      changelog: changelogReport,
    },
  };

  return {
    now: new Date(nowMs).toISOString(),
    issues: Object.fromEntries(issues),
    people,
    edges,
    collabEdges,
    knowledge,
    dependencies,
    quality,
  };
}
