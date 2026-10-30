// Larger mock Jira Cloud REST data: 4 teams of 3–4 people (+ a reporter-only PM).
// Same shapes as jiraMock.js (users/search with groups, /search with issuelinks).
// jiraMock.js stays the small TEST fixture; this one is the default DEMO data.
//
// What this fixture is built to show:
//   - covered blocker:           DES-2 (Mia) has open sub-task DES-4 (Ana) -> Mia alone out stalls nothing
//                                mark Ana out too -> DES-2 stalls, chain Mia → Ken → Ravi/Leo → Priya
//   - long chain:                DES-2 → WEB-2 → WEB-3 → WEB-8
//   - team pairs through 2 people: Frontend→Design (Mia, Theo), Frontend→API (Sofia, Grace)
//   - sole team link:            API↔Platform only through Omar and Lena
//   - cross-team collaboration:  Priya has sub-task DES-8 on Theo's DES-7
//   - no shared work:            Frontend↔API, API↔Platform
//   - isolated work:             Ivan (API-8) shares no task with anyone
//   - within-team chain:         Sam waits on Nora (OPS-5 → OPS-7)
// Kept edge cases: unassigned blocker (OPS-3), deactivated assignee (OPS-4), bot reporter,
// cycle via sub-task (API-4 ↔ OPS-2 through API-5), "Dependency" link type (WEB-4 → DES-5),
// duplicate after rollup (DES-2 and DES-4 both block WEB-2), resolved link (DES-6 Done),
// Relates link ignored (WEB-3 ~ DES-2), team from field / Jira group / project key.
// Knowledge history: components + labels on issues, Done work back to mid-2025 (two items older
// than 12 months: DES-12, OPS-9), changelog assignee changes incl. a deactivated past assignee
// (OPS-2 ← Dan), a from-unassigned change and a status-only change (API-7), a sub-task (WEB-5).

export const FETCHED_AT = '2026-10-27T09:00:00.000-04:00';

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
const frontendGroup = { groups: { size: 2, items: [{ name: 'jira-software-users' }, { name: 'Frontend' }] } };

export const users = [
  // Design (team field)
  u('5f1a-mia', 'Mia Chen', { team: 'Design' }),
  u('5f1a-ana', 'Ana Ruiz', { team: 'Design' }),
  u('5f1a-theo', 'Theo Grant', { team: 'Design' }),
  // Frontend (team field + Jira group fallback)
  u('5f1a-ken', 'Ken Watanabe', { team: 'Frontend' }),
  u('5f1a-ravi', 'Ravi Patel', frontendGroup),
  u('5f1a-priya', 'Priya Nair', { team: 'Frontend' }),
  u('5f1a-leo', 'Leo Martin', frontendGroup),
  // API (project-key fallback for two of them)
  u('5f1a-sofia', 'Sofia Alvarez'),
  u('5f1a-omar', 'Omar Haddad'),
  u('5f1a-grace', 'Grace Kim', { team: 'API' }),
  u('5f1a-ivan', 'Ivan Petrov', { team: 'API' }),
  // Platform
  u('5f1a-lena', 'Lena Kowalski', { team: 'Platform' }),
  u('5f1a-sam', 'Sam Osei', { team: 'Platform' }),
  u('5f1a-nora', 'Nora Berg', { team: 'Platform' }),
  // Others
  u('5f1a-jo', 'Jo Okafor', { team: 'Product' }), // reporter only
  u('5f1a-dan', 'Dan Ross', { team: 'Platform', active: false }), // deactivated
  u('557058:auto', 'Automation for Jira', { accountType: 'app', groups: { size: 0, items: [] } }),
];

const byId = Object.fromEntries(users.map((x) => [x.accountId, x]));
const ref = (id) => (id == null ? null : { accountId: id, displayName: byId[id].displayName, active: byId[id].active, accountType: byId[id].accountType });

const CAT = {
  new: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' },
  indeterminate: { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' },
  done: { id: 3, key: 'done', name: 'Done', colorName: 'green' },
};
const S = {
  todo: { name: 'To Do', statusCategory: CAT.new },
  prog: { name: 'In Progress', statusCategory: CAT.indeterminate },
  blocked: { name: 'Blocked', statusCategory: CAT.indeterminate },
  done: { name: 'Done', statusCategory: CAT.done },
};
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
const LT = {
  Blocks: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  Dependency: { id: '10010', name: 'Dependency', inward: 'is depended on by', outward: 'depends on' },
  Relates: { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
};
// out(id, type, key): this issue --outward--> key.  inn(id, type, key): key --outward--> this issue.
// Every link is written on BOTH issues with the same id, as Jira returns it.
const out = (id, type, key) => ({ id, type: LT[type], outwardIssue: { key } });
const inn = (id, type, key) => ({ id, type: LT[type], inwardIssue: { key } });
const day = (d) => `${d}T10:00:00.000-0400`;

// ---------- components (GET /rest/api/3/project/{key}/components shape) ----------
const COMPONENT_IDS = { Tokens: 10101, Icons: 10102, Accessibility: 10103, Brand: 10104, 'Design system': 10201, Checkout: 10202, Onboarding: 10203,
  Payments: 10301, Webhooks: 10302, 'Rate limiting': 10303, Queues: 10401, Security: 10402, Databases: 10403, Observability: 10404 };
const comp = (name) => ({ self: `https://example.atlassian.net/rest/api/3/component/${COMPONENT_IDS[name]}`, id: String(COMPONENT_IDS[name]), name });
const COMPONENTS = {
  'DES-2': 'Tokens', 'DES-3': 'Tokens', 'DES-4': 'Tokens', 'DES-10': 'Tokens',
  'DES-5': 'Icons', 'DES-11': 'Icons', 'DES-7': 'Accessibility', 'DES-8': 'Accessibility',
  'DES-6': 'Brand', 'DES-9': 'Brand', 'DES-12': 'Brand',
  'WEB-2': 'Design system', 'WEB-4': 'Design system', 'WEB-12': 'Design system',
  'WEB-3': 'Checkout', 'WEB-5': 'Checkout', 'WEB-6': 'Checkout', 'WEB-8': 'Checkout', 'WEB-9': 'Checkout', 'WEB-10': 'Checkout', 'WEB-11': 'Checkout',
  'WEB-7': 'Onboarding',
  'API-2': 'Payments', 'API-3': 'Payments', 'API-6': 'Payments', 'API-8': 'Payments', 'API-10': 'Payments',
  'API-4': 'Webhooks', 'API-5': 'Webhooks', 'API-9': 'Webhooks', 'API-7': 'Rate limiting',
  'OPS-2': 'Queues', 'OPS-6': 'Queues', 'OPS-8': 'Queues', 'OPS-9': 'Queues',
  'OPS-3': 'Security', 'OPS-4': 'Databases', 'OPS-5': 'Observability', 'OPS-7': 'Observability',
};
const LABELS = {
  'WEB-3': ['checkout'], 'WEB-6': ['checkout'], 'WEB-8': ['checkout'], 'WEB-10': ['checkout'], 'API-2': ['checkout'],
  'DES-7': ['checkout', 'a11y'], 'DES-8': ['a11y'],
};

// ---------- changelog (as returned with expand=changelog) ----------
// Assignee items carry accountIds in from/to (Jira Cloud). Only these feed "past assignee".
let historyId = 60000;
const assigneeChange = (created, from, to, author = '5f1a-jo') => ({
  id: String(historyId++), author: ref(author), created: day(created),
  items: [{ field: 'assignee', fieldtype: 'jira', fieldId: 'assignee', from, fromString: from ? byId[from].displayName : null, to, toString: to ? byId[to].displayName : null }],
});
const statusChange = (created, fromName, toName, author) => ({
  id: String(historyId++), author: ref(author), created: day(created),
  items: [{ field: 'status', fieldtype: 'jira', fieldId: 'status', from: '10000', fromString: fromName, to: '3', toString: toName }],
});
const HISTORY = {
  'API-4': [assigneeChange('2026-05-04', null, '5f1a-grace'), assigneeChange('2026-08-10', '5f1a-grace', '5f1a-omar')], // Grace handed it to Omar
  'OPS-5': [assigneeChange('2026-09-20', '5f1a-sam', '5f1a-nora')],
  'DES-5': [assigneeChange('2026-07-02', '5f1a-mia', '5f1a-theo')],
  'OPS-2': [assigneeChange('2026-06-15', '5f1a-dan', '5f1a-lena')], // Dan is deactivated: must not count
  'API-7': [assigneeChange('2026-09-01', null, '5f1a-grace'), statusChange('2026-09-03', 'To Do', 'In Progress', '5f1a-grace')], // nothing to record
  'WEB-6': [assigneeChange('2026-10-01', '5f1a-priya', '5f1a-ken')],
  'WEB-5': [assigneeChange('2026-10-10', '5f1a-priya', '5f1a-leo')], // sub-task: Priya had it before Leo
  'WEB-10': [assigneeChange('2026-01-12', '5f1a-ken', '5f1a-ravi')], // Done work, still history
  'OPS-7': [assigneeChange('2026-10-05', '5f1a-sam', '5f1a-nora'), assigneeChange('2026-10-08', '5f1a-nora', '5f1a-sam')], // bounced back: Sam still on it, Nora was briefly
};

let nextId = 30000;
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
    components: COMPONENTS[key] ? [comp(COMPONENTS[key])] : [],
    labels: LABELS[key] ?? [],
    duedate: f.due ?? null,
    created: day(f.created ?? '2026-09-15'),
    updated: day(f.updated),
    resolutiondate: f.status.statusCategory.key === 'done' ? day(f.updated) : null,
    customfield_10016: f.points ?? null,
    parent: f.parent ? { key: f.parent } : undefined,
    issuelinks: f.links ?? [],
  },
  ...(HISTORY[key] ? { changelog: { startAt: 0, maxResults: HISTORY[key].length, total: HISTORY[key].length, histories: [...HISTORY[key]].reverse() } } : {}),
});

const rawIssues = [
  // ---- epics (themes) ----
  issue('DES-1', { summary: 'Design system refresh', type: T.epic, status: S.prog, assignee: '5f1a-jo', updated: '2026-10-20' }),
  issue('WEB-1', { summary: 'Frontend rebuild', type: T.epic, status: S.prog, assignee: '5f1a-ken', updated: '2026-10-21' }),
  issue('API-1', { summary: 'Payments API v2', type: T.epic, status: S.prog, assignee: '5f1a-sofia', updated: '2026-10-19' }),
  issue('OPS-1', { summary: 'Infra hardening', type: T.epic, status: S.prog, assignee: '5f1a-lena', updated: '2026-10-18' }),

  // ---- Design ----
  issue('DES-2', { summary: 'Design tokens', type: T.story, status: S.prog, assignee: '5f1a-mia', due: '2026-10-30', updated: '2026-10-25', points: 5, parent: 'DES-1',
    links: [out('40001', 'Blocks', 'WEB-2'), inn('40009', 'Relates', 'WEB-3')] }),
  issue('DES-3', { summary: 'Color tokens', type: T.sub, status: S.done, assignee: '5f1a-ravi', parent: 'DES-2', updated: '2026-10-12' }),
  issue('DES-4', { summary: 'Spacing tokens', type: T.sub, status: S.prog, assignee: '5f1a-ana', parent: 'DES-2', updated: '2026-10-26',
    links: [out('40002', 'Blocks', 'WEB-2')] }),
  issue('DES-5', { summary: 'Icon set v2', type: T.story, status: S.todo, assignee: '5f1a-theo', due: '2026-11-12', updated: '2026-09-30', points: 3, parent: 'DES-1',
    links: [inn('40003', 'Dependency', 'WEB-4')] }),
  issue('DES-6', { summary: 'Onboarding illustrations', type: T.story, status: S.done, assignee: '5f1a-mia', updated: '2026-10-05', points: 2, parent: 'DES-1',
    links: [out('40004', 'Blocks', 'WEB-7')] }),
  issue('DES-7', { summary: 'Accessibility audit', type: T.story, status: S.prog, assignee: '5f1a-theo', due: '2026-11-14', updated: '2026-10-24', points: 5, parent: 'DES-1' }),
  issue('DES-8', { summary: 'Audit checkout flow', type: T.sub, status: S.prog, assignee: '5f1a-priya', parent: 'DES-7', updated: '2026-10-25' }),
  issue('DES-9', { summary: 'Brand moodboard', type: T.story, status: S.todo, assignee: '5f1a-ana', due: '2026-11-21', updated: '2026-10-22', points: 2, parent: 'DES-1' }),

  // ---- Frontend ----
  issue('WEB-2', { summary: 'Token migration', type: T.story, status: S.todo, assignee: '5f1a-ken', due: '2026-11-06', updated: '2026-10-22', points: 5, parent: 'WEB-1',
    links: [inn('40001', 'Blocks', 'DES-2'), inn('40002', 'Blocks', 'DES-4'), out('40005', 'Blocks', 'WEB-3'), inn('40020', 'Blocks', 'WEB-12')] }),
  issue('WEB-3', { summary: 'Checkout page restyle', type: T.story, status: S.todo, assignee: '5f1a-ravi', due: '2026-11-13', updated: '2026-10-20', points: 8, parent: 'WEB-1',
    links: [inn('40005', 'Blocks', 'WEB-2'), out('40009', 'Relates', 'DES-2'), out('40011', 'Blocks', 'WEB-8')] }),
  issue('WEB-5', { summary: 'Checkout a11y pass', type: T.sub, status: S.prog, assignee: '5f1a-leo', parent: 'WEB-3', updated: '2026-10-24' }),
  issue('WEB-4', { summary: 'Icon component', type: T.story, status: S.todo, assignee: '5f1a-priya', updated: '2026-10-01', points: 3, parent: 'WEB-1',
    links: [out('40003', 'Dependency', 'DES-5')] }),
  issue('WEB-6', { summary: 'Payment form', type: T.story, status: S.prog, assignee: '5f1a-ken', due: '2026-11-03', updated: '2026-10-26', points: 5, parent: 'WEB-1',
    links: [inn('40006', 'Blocks', 'API-2')] }),
  issue('WEB-7', { summary: 'Onboarding screens', type: T.story, status: S.todo, assignee: '5f1a-ravi', due: '2026-11-20', updated: '2026-10-24', points: 3, parent: 'WEB-1',
    links: [inn('40004', 'Blocks', 'DES-6')] }),
  issue('WEB-8', { summary: 'Checkout analytics', type: T.story, status: S.todo, assignee: '5f1a-priya', due: '2026-11-20', updated: '2026-10-23', points: 3, parent: 'WEB-1',
    links: [inn('40011', 'Blocks', 'WEB-3')] }),
  issue('WEB-9', { summary: 'Error banners', type: T.story, status: S.todo, assignee: '5f1a-leo', due: '2026-11-18', updated: '2026-10-23', points: 2, parent: 'WEB-1',
    links: [inn('40012', 'Blocks', 'API-7')] }),

  // ---- Payments API ----
  issue('API-2', { summary: 'Payment intents endpoint', type: T.story, status: S.prog, assignee: '5f1a-sofia', due: '2026-10-20', updated: '2026-10-23', points: 8, parent: 'API-1',
    links: [out('40006', 'Blocks', 'WEB-6')] }),
  issue('API-3', { summary: 'Idempotency keys', type: T.sub, status: S.prog, assignee: '5f1a-omar', parent: 'API-2', updated: '2026-10-25' }),
  issue('API-4', { summary: 'Webhook retries', type: T.story, status: S.blocked, assignee: '5f1a-omar', due: '2026-11-01', updated: '2026-10-10', points: 5, parent: 'API-1',
    links: [inn('40007', 'Blocks', 'OPS-2')] }),
  issue('API-5', { summary: 'Queue client config', type: T.sub, status: S.todo, assignee: '5f1a-omar', parent: 'API-4', updated: '2026-10-15',
    links: [out('40008', 'Blocks', 'OPS-2')] }),
  issue('API-6', { summary: 'Refund endpoint', type: T.story, status: S.todo, assignee: '5f1a-sofia', due: '2026-11-20', updated: '2026-10-21', points: 5, parent: 'API-1',
    links: [inn('40010', 'Blocks', 'OPS-3')] }),
  issue('API-7', { summary: 'Rate limiter', type: T.story, status: S.prog, assignee: '5f1a-grace', due: '2026-11-05', updated: '2026-10-25', points: 5, parent: 'API-1',
    links: [out('40012', 'Blocks', 'WEB-9')] }),
  issue('API-8', { summary: 'Payment metrics', type: T.story, status: S.todo, assignee: '5f1a-ivan', due: '2026-11-25', updated: '2026-10-22', points: 3, parent: 'API-1' }),

  // ---- Platform Ops ----
  issue('OPS-2', { summary: 'Queue cluster upgrade', type: T.task, status: S.prog, assignee: '5f1a-lena', due: '2026-10-29', updated: '2026-10-26', points: 8, parent: 'OPS-1',
    links: [out('40007', 'Blocks', 'API-4'), inn('40008', 'Blocks', 'API-5')] }),
  issue('OPS-6', { summary: 'Broker config', type: T.sub, status: S.prog, assignee: '5f1a-sam', parent: 'OPS-2', updated: '2026-10-26' }),
  issue('OPS-3', { summary: 'TLS cert rotation', type: T.task, status: S.todo, assignee: null, reporter: '557058:auto', due: '2026-10-25', updated: '2026-10-19', parent: 'OPS-1',
    links: [out('40010', 'Blocks', 'API-6')] }),
  issue('OPS-4', { summary: 'Staging DB migration', type: T.task, status: S.prog, assignee: '5f1a-dan', updated: '2026-09-01', points: 3, parent: 'OPS-1' }),
  issue('OPS-5', { summary: 'Observability dashboards', type: T.task, status: S.prog, assignee: '5f1a-nora', due: '2026-11-08', updated: '2026-10-24', points: 5, parent: 'OPS-1',
    links: [out('40013', 'Blocks', 'OPS-7')] }),
  issue('OPS-7', { summary: 'Alert routing', type: T.task, status: S.todo, assignee: '5f1a-sam', due: '2026-11-15', updated: '2026-10-22', points: 3, parent: 'OPS-1',
    links: [inn('40013', 'Blocks', 'OPS-5')] }),

  // ---- Done work over the past ~12 months (history only; never scored) ----
  issue('DES-10', { summary: 'Token naming spec', type: T.story, status: S.done, assignee: '5f1a-theo', created: '2026-02-20', updated: '2026-03-10', points: 2, parent: 'DES-1' }),
  issue('DES-11', { summary: 'Icon audit', type: T.story, status: S.done, assignee: '5f1a-ana', created: '2026-05-01', updated: '2026-05-20', points: 2, parent: 'DES-1' }),
  issue('DES-12', { summary: 'Old brand guidelines', type: T.story, status: S.done, assignee: '5f1a-mia', created: '2025-06-20', updated: '2025-07-15', points: 3, parent: 'DES-1' }), // > 12 months old
  issue('WEB-10', { summary: 'Checkout v1', type: T.story, status: S.done, assignee: '5f1a-ravi', created: '2026-01-05', updated: '2026-02-14', points: 8, parent: 'WEB-1' }),
  issue('WEB-11', { summary: 'Checkout v1 tests', type: T.sub, status: S.done, assignee: '5f1a-ken', parent: 'WEB-10', created: '2026-01-20', updated: '2026-02-10' }),
  issue('WEB-12', { summary: 'Design system bootstrap', type: T.story, status: S.done, assignee: '5f1a-priya', created: '2026-03-01', updated: '2026-04-02', points: 5, parent: 'WEB-1',
    links: [out('40020', 'Blocks', 'WEB-2')] }), // resolved link: still "related work" for WEB-2
  issue('API-9', { summary: 'Payments v1 webhooks', type: T.story, status: S.done, assignee: '5f1a-sofia', created: '2025-12-01', updated: '2026-01-20', points: 5, parent: 'API-1' }),
  issue('API-10', { summary: 'Refund prototype', type: T.story, status: S.done, assignee: '5f1a-grace', created: '2026-05-10', updated: '2026-06-01', points: 3, parent: 'API-1' }),
  issue('OPS-8', { summary: 'Queue cluster v1', type: T.task, status: S.done, assignee: '5f1a-nora', created: '2025-11-01', updated: '2025-12-05', points: 5, parent: 'OPS-1' }),
  issue('OPS-9', { summary: 'Legacy cron jobs', type: T.task, status: S.done, assignee: '5f1a-lena', created: '2025-08-01', updated: '2025-09-01', points: 3, parent: 'OPS-1' }), // > 12 months old
];

// Materialise nested link issues the way Jira returns them.
const byKey = Object.fromEntries(rawIssues.map((i) => [i.key, i]));
for (const i of rawIssues) {
  for (const l of i.fields.issuelinks) {
    const side = l.outwardIssue ? 'outwardIssue' : 'inwardIssue';
    const other = byKey[l[side].key];
    if (!other) throw new Error(`jiraMockLarge: ${i.key} links to missing ${l[side].key}`);
    l[side] = { id: other.id, key: other.key, self: other.self, fields: { summary: other.fields.summary, status: other.fields.status, issuetype: other.fields.issuetype } };
  }
}

export const searchResponse = { expand: 'schema,names', startAt: 0, maxResults: 100, total: rawIssues.length, issues: rawIssues };

export default { fetchedAt: FETCHED_AT, users, searchResponse, site: { projectName: 'Payments Launch' } };
