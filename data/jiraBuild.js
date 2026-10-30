// Small builders that produce Jira Cloud REST shapes, so mock files stay readable.
// Output matches GET /rest/api/3/users/search (expand=groups) and /rest/api/3/search.

export const SITE = 'https://example.atlassian.net';

export function makeUsers(list) {
  return list.map(([accountId, displayName, extra = {}]) => ({
    self: `${SITE}/rest/api/3/user?accountId=${accountId}`,
    accountId,
    accountType: 'atlassian',
    displayName,
    active: true,
    timeZone: 'America/New_York',
    groups: { size: 1, items: [{ name: 'jira-software-users' }] },
    ...extra,
  }));
}

const CAT = {
  new: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
  indeterminate: { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' },
  done: { id: 3, key: 'done', name: 'Done', colorName: 'green' },
};
export const S = {
  todo: { name: 'To Do', statusCategory: CAT.new },
  prog: { name: 'In Progress', statusCategory: CAT.indeterminate },
  blocked: { name: 'Blocked', statusCategory: CAT.indeterminate },
  review: { name: 'In Review', statusCategory: CAT.indeterminate },
  done: { name: 'Done', statusCategory: CAT.done },
};
export const T = {
  epic: { name: 'Epic', subtask: false, hierarchyLevel: 1 },
  story: { name: 'Story', subtask: false, hierarchyLevel: 0 },
  task: { name: 'Task', subtask: false, hierarchyLevel: 0 },
  sub: { name: 'Sub-task', subtask: true, hierarchyLevel: -1 },
};
const LT = {
  Blocks: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  Dependency: { id: '10010', name: 'Dependency', inward: 'is depended on by', outward: 'depends on' },
  Relates: { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
};
// out(id, type, key): this issue --outward--> key     inn(id, type, key): key --outward--> this issue
export const out = (id, type, key) => ({ id, type: LT[type], outwardIssue: { key } });
export const inn = (id, type, key) => ({ id, type: LT[type], inwardIssue: { key } });

// Build a search response. `projects` maps key prefix -> {key, name}.
export function makeSearch(users, projects, specs, defaultReporter) {
  const byId = Object.fromEntries(users.map((x) => [x.accountId, x]));
  const ref = (id) => (id == null ? null : { accountId: id, displayName: byId[id].displayName, active: byId[id].active, accountType: byId[id].accountType });
  let nextId = 40000;
  const issues = specs.map(([key, f]) => ({
    id: String(nextId++),
    key,
    self: `${SITE}/rest/api/3/issue/${key}`,
    fields: {
      summary: f.summary,
      issuetype: f.type,
      status: f.status,
      assignee: ref(f.assignee ?? null),
      reporter: ref(f.reporter ?? defaultReporter),
      project: projects[key.split('-')[0]],
      duedate: f.due ?? null,
      created: f.created ?? '2026-09-15T10:00:00.000-0400',
      updated: f.updated,
      customfield_10016: f.points ?? null,
      parent: f.parent ? { key: f.parent } : undefined,
      issuelinks: f.links ?? [],
    },
  }));
  // Materialise nested link issues the way Jira returns them, and check both sides exist.
  const byKey = Object.fromEntries(issues.map((i) => [i.key, i]));
  for (const i of issues) {
    for (const l of i.fields.issuelinks) {
      const side = l.outwardIssue ? 'outwardIssue' : 'inwardIssue';
      const other = byKey[l[side].key];
      if (!other) throw new Error(`mock: ${i.key} links to missing ${l[side].key}`);
      const mirror = other.fields.issuelinks.some((m) => m.id === l.id);
      if (!mirror) throw new Error(`mock: link ${l.id} on ${i.key} has no mirror on ${other.key}`);
      l[side] = { id: other.id, key: other.key, self: other.self, fields: { summary: other.fields.summary, status: other.fields.status, issuetype: other.fields.issuetype } };
    }
  }
  return { expand: 'schema,names', startAt: 0, maxResults: 100, total: issues.length, issues };
}
