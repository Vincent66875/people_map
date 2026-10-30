import { useCallback, useMemo, useState } from 'react';
import mock from './data/jiraMockLarge.js';
import { adapt } from './analysis/adapter.js';
import { analyzeAll, analyzePerson, buildIndex, downstreamUnblock, nearbyPeople, worksWith } from './analysis/coverage.js';
import { collabSentences, teamLines, themeLines, ticketLines, ZOOMS } from './analysis/sentences.js';
import { PersonGraph } from './components/PersonGraph.jsx';
import { Ranking } from './components/Ranking.jsx';
import { PersonDetail } from './components/PersonDetail.jsx';
import { KeyList, Num } from './components/Evidence.jsx';
import './styles.css';

const ZOOM_LABEL = { ticket: 'Ticket', theme: 'Theme', team: 'Team' };
const LAYERS = [['both', 'Both'], ['waits', 'Waits on'], ['works', 'Works with']];

export default function App({ data = mock, initialSelected = null, initialAbsent = [] }) {
  const model = useMemo(() => adapt({ users: data.users, searchResponse: data.searchResponse, now: data.fetchedAt }), [data]);
  const ix = useMemo(() => buildIndex(model), [model]);
  const baseline = useMemo(() => analyzeAll(ix), [ix]);
  const baselineScores = useMemo(() => new Map([...baseline.byId].map(([id, r]) => [id, r.score])), [baseline]);

  const [selectedId, setSelectedId] = useState(initialSelected);
  const [absent, setAbsent] = useState(() => new Set(initialAbsent));
  const [zoom, setZoom] = useState('ticket');
  const [layer, setLayer] = useState('both');

  const current = useMemo(() => analyzeAll(ix, absent), [ix, absent]);
  const scores = useMemo(() => new Map([...current.byId].map(([id, r]) => [id, r.score])), [current]);

  const personById = ix.personById;
  const nameOf = useCallback((id) => personById.get(id)?.firstName ?? 'unassigned', [personById]);
  const teamOf = useCallback((id) => personById.get(id)?.team ?? '', [personById]);
  const graphPeople = useMemo(() => model.people.filter((p) => p.doesWork || p.roles.leads.length), [model]);

  const toggleOut = useCallback((id) => {
    setAbsent((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selected = selectedId ? personById.get(selectedId) : null;
  const detail = useMemo(() => {
    if (!selectedId) return null;
    const others = new Set([...absent].filter((x) => x !== selectedId));
    return {
      analysis: analyzePerson(ix, selectedId, others),
      unblock: downstreamUnblock(ix, selectedId),
      nearby: nearbyPeople(ix, selectedId, others),
      worksWith: worksWith(ix, selectedId),
      othersOut: [...others],
    };
  }, [ix, selectedId, absent]);

  const lines = useMemo(() => {
    if (zoom === 'theme') return themeLines(model.edges);
    if (zoom === 'team') return teamLines(model.edges, nameOf, absent, model.collabEdges);
    return ticketLines(model.edges);
  }, [zoom, model.edges, model.collabEdges, nameOf, absent]);

  const staleCount = useCallback((id) => {
    const keys = ix.openWork.filter((i) => i.owner === id && i.stale).map((i) => i.key);
    return { count: keys.length, keys };
  }, [ix]);

  const q = model.quality;
  const allKeys = Object.keys(model.issues);
  const openKeys = ix.openWork.map((i) => i.key);
  const assignedKeys = ix.openWork.filter((i) => i.owner).map((i) => i.key);
  const depKeys = [...new Set(model.dependencies.flatMap((d) => [d.blockerKey, d.waiterKey]))];
  const projectKeys = [...new Set(Object.values(model.issues).map((i) => i.project))].sort();
  const projectName = data.site?.projectName ?? 'Payments Launch';
  const initials = projectName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="cr-app">
      <header className="cr-topbar">
        <span className="cr-topbar__logo" aria-hidden="true">◆</span>
        <span className="cr-topbar__product">Jira</span>
        <nav className="cr-topbar__nav" aria-label="Product">
          <span>Your work</span><span className="is-active">Projects</span><span>Filters</span><span>Dashboards</span>
        </nav>
        <span className="cr-topbar__search" aria-hidden="true">Search</span>
      </header>

      <div className="cr-shell">
        <aside className="cr-side" aria-label="Project">
          <div className="cr-side__project">
            <span className="cr-side__avatar" aria-hidden="true">{initials}</span>
            <div><strong>{projectName}</strong><span className="cr-muted">Software project</span></div>
          </div>
          <nav aria-label="Project views">
            <ul>
              <li>Timeline</li>
              <li>Backlog</li>
              <li>Board</li>
              <li>Reports</li>
              <li className="cr-side__group">Apps</li>
              <li className="is-active" aria-current="page">Coverage risk</li>
            </ul>
          </nav>
        </aside>

        <main className="cr-main">
          <p className="cr-crumbs">Projects / {projectName} / Apps</p>
          <h1>Coverage risk</h1>
          <p className="cr-lede">How much of the team’s work depends on one person, and what stops if they’re out.</p>

          <p className="cr-prov">
            Built from <Num n={q.issuesFetched} keys={allKeys} issues={model.issues} label="Jira issues" /> Jira issues with no manual input
            {' · '}<Num n={`${q.pctOpenAssigned}%`} keys={assignedKeys} issues={model.issues} label={`of ${openKeys.length} open work items assigned`} /> of open work assigned
            {' · '}<Num n={q.dependencyLinks} keys={depKeys} issues={model.issues} label="dependency links" /> dependency links
            {' · '}<Num n={q.openWithTwoPlus.length} keys={q.openWithTwoPlus} issues={model.issues} label="open tasks with 2+ people" /> open tasks with 2+ people
            <span className="cr-muted"> · read-only · scope: open issues in {projectKeys.join(', ')} · as of {model.now.slice(0, 10)}</span>
          </p>

          <DataGaps q={q} issues={model.issues} />

          <section className="cr-card cr-hero" aria-labelledby="cr-graph-h">
            <div className="cr-hero__head">
              <div>
                <h2 id="cr-graph-h">Who waits on whom, and who works together</h2>
                <p className="cr-muted">Select a person to see what depends on them. Arrows point from the person waiting to the person they wait on. Green joins people on the same task.</p>
              </div>
              <div className="cr-controls">
              <div className="cr-seg" role="radiogroup" aria-label="Show">
                {LAYERS.map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={layer === k} className={layer === k ? 'is-on' : ''} onClick={() => setLayer(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="cr-seg" role="radiogroup" aria-label="Zoom level for dependency labels">
                {ZOOMS.map((z) => (
                  <button key={z} type="button" role="radio" aria-checked={zoom === z} className={zoom === z ? 'is-on' : ''} onClick={() => setZoom(z)}>
                    {ZOOM_LABEL[z]}
                  </button>
                ))}
              </div>
              </div>
            </div>

            <PersonGraph
              people={graphPeople}
              edges={model.edges}
              collabEdges={model.collabEdges}
              layer={layer}
              baselineScores={baselineScores}
              scores={scores}
              absent={absent}
              impact={current.absentImpact}
              zoom={zoom}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
              nameOf={nameOf}
            />

            <div className="cr-lines">
              <h3>{ZOOM_LABEL[zoom]} view of the same dependencies</h3>
              <ul>
                {lines.map((l) => {
                  const broken = l.edgeIds.some((id) => current.absentImpact.brokenEdgeIds.has(id));
                  const touches = selectedId && l.edgeIds.some((id) => id.split('->').includes(selectedId));
                  return (
                    <li key={l.id} className={`${broken ? 'is-broken' : ''}${touches ? ' is-selected' : ''}`}>
                      {l.text} <KeyList keys={l.keys} issues={model.issues} sep=" " />
                    </li>
                  );
                })}
              </ul>
              {layer !== 'waits' && (
                <>
                  <h3 className="cr-lines__h">Working together</h3>
                  <ul>
                    {model.collabEdges.flatMap((c) =>
                      collabSentences(c, nameOf).map((t, n) => {
                        const carried = current.absentImpact.carriedCollabIds.has(c.id);
                        const touches = selectedId && (c.a === selectedId || c.b === selectedId);
                        return (
                          <li key={`${c.id}:${n}`} className={`${carried ? 'is-carried' : ''}${touches ? ' is-selected' : ''}${c.current ? '' : ' is-past'}`}>
                            {t}{carried ? ` Continues while ${nameOf(absent.has(c.a) ? c.a : c.b)} is out.` : ''} <KeyList keys={[c.tasks[n].key, ...Object.values(c.tasks[n].roles).flatMap((r) => r.viaKeys)]} issues={model.issues} sep=" " />
                          </li>
                        );
                      }),
                    )}
                    {model.collabEdges.length === 0 && <li className="cr-muted">No tasks have more than one person on them.</li>}
                  </ul>
                </>
              )}
            </div>
          </section>

          <div className="cr-split">
            <Ranking
              ranking={current.ranking}
              baselineScores={baselineScores}
              absentPeople={[...absent]}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggleOut={toggleOut}
              nameOf={nameOf}
              teamOf={teamOf}
              issues={model.issues}
              staleCount={staleCount}
            />
            <PersonDetail
              person={selected}
              analysis={detail?.analysis}
              unblock={detail?.unblock}
              nearby={detail?.nearby}
              worksWith={detail?.worksWith ?? []}
              continuing={current.absentImpact.continuing}
              isOut={!!selectedId && absent.has(selectedId)}
              othersOut={detail?.othersOut ?? []}
              onToggleOut={toggleOut}
              issues={model.issues}
              nameOf={nameOf}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function DataGaps({ q, issues }) {
  const gaps = q.unassignedOpen.length + q.blockersWithNoAssignee.length + q.excludedAccounts.length;
  return (
    <details className="cr-gaps">
      <summary>Data quality · {gaps} gap{gaps === 1 ? '' : 's'} found</summary>
      <dl>
        <dt>Issues</dt>
        <dd>{q.issuesFetched} fetched: {q.byKind.work} work items, {q.byKind.subtask} sub-tasks, {q.byKind.epic} epics (used as themes). {q.openWorkItems} open work items in scope; Done kept as history only.</dd>
        <dt>Open work with no assignee</dt>
        <dd>{q.unassignedOpen.length ? q.unassignedOpen.map((u) => <span key={u.key} className="cr-gap"><KeyList keys={[u.key]} issues={issues} /> {u.why}</span>) : 'none'}</dd>
        <dt>Blockers with no assignee</dt>
        <dd>{q.blockersWithNoAssignee.length ? q.blockersWithNoAssignee.map((b) => <span key={b.blockerKey} className="cr-gap"><KeyList keys={[b.blockerKey, b.waiterKey]} issues={issues} sep=" blocks " /> — nobody’s absence can stall this, and nobody is on it</span>) : 'none'}</dd>
        <dt>Dependency links</dt>
        <dd>
          {q.dependencyLinks} link records → {q.dependencyPairsAfterRollup} ticket pairs after sub-task rollup and de-duplication → {q.activeDependencies} open.
          {q.resolvedDependencies.length > 0 && ` Resolved: ${q.resolvedDependencies.map((d) => `${d.id.replace('>', ' blocks ')} (${d.why})`).join('; ')}.`}
          {q.nonDependencyLinksIgnored.length > 0 && ` Ignored ${q.nonDependencyLinksIgnored.length} non-dependency link${q.nonDependencyLinksIgnored.length === 1 ? '' : 's'} (${[...new Set(q.nonDependencyLinksIgnored.map((l) => l.type))].join(', ')}).`}
        </dd>
        <dt>Work with sub-task helpers</dt>
        <dd>{q.withSubtaskHelpers.length ? <KeyList keys={q.withSubtaskHelpers} issues={issues} sep=", " /> : 'none'}</dd>
        <dt>Open work with 2+ people</dt>
        <dd>{q.pctOpenWithTwoPlus}% ({q.openWithTwoPlus.length} of {q.openWorkItems}){q.openWithTwoPlus.length > 0 && <>: <KeyList keys={q.openWithTwoPlus} issues={issues} sep=", " /></>}. Collaboration only shows where teams use sub-tasks; Jira has one assignee per issue.</dd>
        <dt>Accounts excluded</dt>
        <dd>{q.excludedAccounts.map((a) => `${a.displayName} (${a.reason})`).join(', ') || 'none'}</dd>
        <dt>Team source</dt>
        <dd>{Object.entries(q.teamSources).map(([n, t]) => `${n}: ${t}`).join(' · ')}</dd>
      </dl>
    </details>
  );
}
