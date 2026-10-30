// Mock Jira Cloud REST data.
// Shapes follow GET /rest/api/3/users/search (expand=groups) and
// GET /rest/api/3/search?fields=summary,status,assignee,reporter,project,
//   duedate,updated,issuetype,parent,issuelinks,customfield_10016
// Nothing here is app-specific: no capacity, leave, plans or risk scores.
//
// Deliberate test cases baked in:
//   - unassigned blocker:        OPS-3 blocks API-6
//   - deactivated assignee:      OPS-4 -> Dan Ross (active: false)
//   - bot reporter:              OPS-3 reported by Automation for Jira
//   - dependency cycle:          API-4 <-> OPS-2 (one side via sub-task API-5)
//   - sub-task rollup:           API-5 (sub of API-4), DES-4 (sub of DES-2)
//   - duplicate after rollup:    DES-2 blocks WEB-2 and DES-4 blocks WEB-2
//   - parallel person edges:     Ken waits on Mia twice (WEB-2, WEB-4)
//   - "Dependency" link type:    WEB-4 depends on DES-5 (reversed wording)
//   - resolved dependency:       DES-6 (Done) blocks WEB-7
//   - non-dependency link:       WEB-3 relates to DES-2
//   - team fallbacks:            team field / Jira group / project key
//   - collaboration:             current (WEB-3 Ravi+Ken, API-2 Sofia+Omar), past (DES-2 Mia+Ravi via Done DES-3)

export const FETCHED_AT = '2026-10-27T09:00:00.000-04:00';

// ---------- users ----------
const u = (accountId, displayName, extra = {}) => ({
  self: `https://example.atlassian.net/rest/api/3/user?accountId=${accountId}`,
  accountId,
  accountType: 'atlassian',
  displayName,
  active: true,
  timeZone: 'America/New_York',
  groups: { size: 1, items: [{ name: 'jira-software-users' }] },
  ...extra,
});

export const users = [
  u('5f1a-mia', 'Mia Chen', { team: 'Design' }),
  u('5f1a-ken', 'Ken Watanabe', { team: 'Frontend' }),
  u('5f1a-ravi', 'Ravi Patel', {
    // no team field -> falls back to a Jira group
    groups: { size: 2, items: [{ name: 'jira-software-users' }, { name: 'Frontend' }] },
  }),
  u('5f1a-sofia', 'Sofia Alvarez'), // no team, no group -> project key
  u('5f1a-omar', 'Omar Haddad'), // no team, no group -> project key
  u('5f1a-lena', 'Lena Kowalski', { team: 'Platform' }),
  u('5f1a-jo', 'Jo Okafor', { team: 'Product' }), // reporter only
  u('5f1a-dan', 'Dan Ross', { team: 'Platform', active: false }), // deactivated
  u('557058:auto', 'Automation for Jira', { accountType: 'app', groups: { size: 0, items: [] } }),
];

const byId = Object.fromEntries(users.map((x) => [x.accountId, x]));
const ref = (id) =>
  id == null
    ? null
    : {
        accountId: id,
        displayName: byId[id].displayName,
        active: byId[id].active,
        accountType: byId[id].accountType,
      };

// ---------- statuses ----------
const CAT = {
  new: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
  indeterminate: { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' },
  done: { id: 3, key: 'done', name: 'Done', colorName: 'green' },
};
const S = {
  todo: { name: 'To Do', statusCategory: CAT.new },
  prog: { name: 'In Progress', statusCategory: CAT.indeterminate },
  blocked: { name: 'Blocked', statusCategory: CAT.indeterminate },
  review: { name: 'In Review', statusCategory: CAT.indeterminate },
  done: { name: 'Done', statusCategory: CAT.done },
};

// ---------- projects / issue types ----------
const P = {
  DES: { key: 'DES', name: 'Design' },
  WEB: { key: 'WEB', name: 'Web App' },
  API: { key: 'API', name: 'Payments API' },
  OPS: { key: 'OPS', name: 'Platform Ops' },
};
const T = {
  epic: { name: 'Epic', subtask: false, hierarchyLevel: 1 },
  story: { name: 'Story', subtask: false, hierarchyLevel: 0 },
  task: { name: 'Task', subtask: false, hierarchyLevel: 0 },
  sub: { name: 'Sub-task', subtask: true, hierarchyLevel: -1 },
};

// ---------- link types (as GET /rest/api/3/issueLinkType returns them) ----------
const LT = {
  Blocks: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  Dependency: { id: '10010', name: 'Dependency', inward: 'is depended on by', outward: 'depends on' },
  Relates: { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
};

// Link stubs; materialised below so each side carries Jira's nested issue summary.
// out(linkId, type, otherKey): this issue --outward--> other
// inn(linkId, type, otherKey): other --outward--> this issue
const out = (id, type, key) => ({ id, type: LT[type], outwardIssue: { key } });
const inn = (id, type, key) => ({ id, type: LT[type], inwardIssue: { key } });

let nextId = 20000;
const issue = (key, f) => ({
  id: String(nextId++),
  key,
  self: `https://example.atlassian.net/rest/api/3/issue/${key}`,
  fields: {
    summary: f.summary,
    issuetype: f.type,
    status: f.status,
    assignee: ref(f.assignee ?? null),
    reporter: ref(f.reporter ?? '5f1a-jo'),
    project: P[key.split('-')[0]],
    duedate: f.due ?? null,
    created: f.created ?? '2026-09-15T10:00:00.000-0400',
    updated: f.updated,
    customfield_10016: f.points ?? null, // Story Points (Jira Cloud default field id)
    parent: f.parent ? { key: f.parent } : undefined,
    issuelinks: f.links ?? [],
  },
});

const rawIssues = [
  // ---- epics (themes) ----
  issue('DES-1', { summary: 'Design system refresh', type: T.epic, status: S.prog, assignee: '5f1a-jo', updated: '2026-10-20T10:00:00.000-0400' }),
  issue('WEB-1', { summary: 'Frontend rebuild', type: T.epic, status: S.prog, assignee: '5f1a-ken', updated: '2026-10-21T10:00:00.000-0400' }),
  issue('API-1', { summary: 'Payments API v2', type: T.epic, status: S.prog, assignee: '5f1a-sofia', updated: '2026-10-19T10:00:00.000-0400' }),
  issue('OPS-1', { summary: 'Infra hardening', type: T.epic, status: S.prog, assignee: '5f1a-lena', updated: '2026-10-18T10:00:00.000-0400' }),

  // ---- Design ----
  issue('DES-2', {
    summary: 'Design tokens', type: T.story, status: S.prog, assignee: '5f1a-mia',
    due: '2026-10-30', updated: '2026-10-25T14:00:00.000-0400', points: 5, parent: 'DES-1',
    links: [out('30001', 'Blocks', 'WEB-2'), inn('30009', 'Relates', 'WEB-3')],
  }),
  // Done sub-task by someone else: past collaboration (Ravi worked on Mia's DES-2), not current coverage.
  issue('DES-3', { summary: 'Color tokens', type: T.sub, status: S.done, assignee: '5f1a-ravi', parent: 'DES-2', updated: '2026-10-12T10:00:00.000-0400' }),
  issue('DES-4', {
    summary: 'Spacing tokens', type: T.sub, status: S.prog, assignee: '5f1a-mia', parent: 'DES-2',
    updated: '2026-10-26T10:00:00.000-0400',
    links: [out('30002', 'Blocks', 'WEB-2')], // duplicates DES-2 -> WEB-2 after rollup
  }),
  issue('DES-5', {
    summary: 'Icon set v2', type: T.story, status: S.todo, assignee: '5f1a-mia',
    due: '2026-11-12', updated: '2026-09-30T10:00:00.000-0400', points: 3, parent: 'DES-1', // stale
    links: [inn('30003', 'Dependency', 'WEB-4')],
  }),
  issue('DES-6', {
    summary: 'Onboarding illustrations', type: T.story, status: S.done, assignee: '5f1a-mia',
    updated: '2026-10-05T10:00:00.000-0400', points: 2, parent: 'DES-1',
    links: [out('30004', 'Blocks', 'WEB-7')], // resolved: blocker is Done
  }),

  // ---- Frontend ----
  issue('WEB-2', {
    summary: 'Token migration', type: T.story, status: S.todo, assignee: '5f1a-ken',
    due: '2026-11-06', updated: '2026-10-22T10:00:00.000-0400', points: 5, parent: 'WEB-1',
    links: [inn('30001', 'Blocks', 'DES-2'), inn('30002', 'Blocks', 'DES-4'), out('30005', 'Blocks', 'WEB-3')],
  }),
  issue('WEB-3', {
    summary: 'Checkout page restyle', type: T.story, status: S.todo, assignee: '5f1a-ravi',
    due: '2026-11-13', updated: '2026-10-20T10:00:00.000-0400', points: 8, parent: 'WEB-1',
    links: [inn('30005', 'Blocks', 'WEB-2'), out('30009', 'Relates', 'DES-2')],
  }),
  issue('WEB-5', { summary: 'Checkout a11y pass', type: T.sub, status: S.prog, assignee: '5f1a-ken', parent: 'WEB-3', updated: '2026-10-24T10:00:00.000-0400' }),
  issue('WEB-4', {
    summary: 'Icon component', type: T.story, status: S.todo, assignee: '5f1a-ken',
    updated: '2026-10-01T10:00:00.000-0400', points: 3, parent: 'WEB-1', // stale, no due date
    links: [out('30003', 'Dependency', 'DES-5')],
  }),
  issue('WEB-6', {
    summary: 'Payment form', type: T.story, status: S.prog, assignee: '5f1a-ken',
    due: '2026-11-03', updated: '2026-10-26T10:00:00.000-0400', points: 5, parent: 'WEB-1',
    links: [inn('30006', 'Blocks', 'API-2')],
  }),
  issue('WEB-7', {
    summary: 'Onboarding screens', type: T.story, status: S.todo, assignee: '5f1a-ravi',
    due: '2026-11-20', updated: '2026-10-24T10:00:00.000-0400', points: 3, parent: 'WEB-1',
    links: [inn('30004', 'Blocks', 'DES-6')],
  }),

  // ---- Payments API ----
  issue('API-2', {
    summary: 'Payment intents endpoint', type: T.story, status: S.prog, assignee: '5f1a-sofia',
    due: '2026-10-20', updated: '2026-10-23T10:00:00.000-0400', points: 8, parent: 'API-1', // overdue
    links: [out('30006', 'Blocks', 'WEB-6')],
  }),
  issue('API-3', { summary: 'Idempotency keys', type: T.sub, status: S.prog, assignee: '5f1a-omar', parent: 'API-2', updated: '2026-10-25T10:00:00.000-0400' }),
  issue('API-4', {
    summary: 'Webhook retries', type: T.story, status: S.blocked, assignee: '5f1a-omar',
    due: '2026-11-01', updated: '2026-10-10T10:00:00.000-0400', points: 5, parent: 'API-1', // stale
    links: [inn('30007', 'Blocks', 'OPS-2')],
  }),
  issue('API-5', {
    summary: 'Queue client config', type: T.sub, status: S.todo, assignee: '5f1a-omar', parent: 'API-4',
    updated: '2026-10-15T10:00:00.000-0400',
    links: [out('30008', 'Blocks', 'OPS-2')], // rolls up to API-4 -> closes the cycle
  }),
  issue('API-6', {
    summary: 'Refund endpoint', type: T.story, status: S.todo, assignee: '5f1a-sofia',
    due: '2026-11-20', updated: '2026-10-21T10:00:00.000-0400', points: 5, parent: 'API-1',
    links: [inn('30010', 'Blocks', 'OPS-3')],
  }),

  // ---- Platform Ops ----
  issue('OPS-2', {
    summary: 'Queue cluster upgrade', type: T.task, status: S.prog, assignee: '5f1a-lena',
    due: '2026-10-29', updated: '2026-10-26T10:00:00.000-0400', points: 8, parent: 'OPS-1',
    links: [out('30007', 'Blocks', 'API-4'), inn('30008', 'Blocks', 'API-5')],
  }),
  issue('OPS-3', {
    summary: 'TLS cert rotation', type: T.task, status: S.todo, assignee: null, reporter: '557058:auto',
    due: '2026-10-25', updated: '2026-10-19T10:00:00.000-0400', parent: 'OPS-1', // unassigned + overdue
    links: [out('30010', 'Blocks', 'API-6')],
  }),
  issue('OPS-4', {
    summary: 'Staging DB migration', type: T.task, status: S.prog, assignee: '5f1a-dan',
    updated: '2026-09-01T10:00:00.000-0400', points: 3, parent: 'OPS-1', // deactivated assignee, stale
  }),
];

// Materialise nested link issues the way Jira returns them.
const byKey = Object.fromEntries(rawIssues.map((i) => [i.key, i]));
for (const i of rawIssues) {
  for (const l of i.fields.issuelinks) {
    const side = l.outwardIssue ? 'outwardIssue' : 'inwardIssue';
    const other = byKey[l[side].key];
    l[side] = {
      id: other.id,
      key: other.key,
      self: other.self,
      fields: { summary: other.fields.summary, status: other.fields.status, issuetype: other.fields.issuetype },
    };
  }
}

export const searchResponse = {
  expand: 'schema,names',
  startAt: 0,
  maxResults: 100,
  total: rawIssues.length,
  issues: rawIssues,
};

export default { fetchedAt: FETCHED_AT, users, searchResponse };
