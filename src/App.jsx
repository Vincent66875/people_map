import { useMemo, useState } from 'react';
import { buildModel, provenance } from './analysis/adapter.js';
import { ranking } from './analysis/scoring.js';
import { whoHasWorkedOn, workedNear } from './analysis/search.js';
import { teamSentences } from './analysis/labels.js';
import { graphData } from './graph/graphData.js';
import PeopleGraph from './components/PeopleGraph.jsx';
import { AbsencePanel, DataQuality, Keys, PersonDetail, Ranking, SearchBox, TicketList, WorkedOnPanel, ZoomControl } from './components/Panels.jsx';

export default function App({ fixture, initialZoom = 'ticket' }) {
  const model = useMemo(() => buildModel(fixture), [fixture]);
  const prov = provenance(model);
  const [zoom, setZoom] = useState(initialZoom);
  const [selectedId, setSelectedId] = useState(null);
  const [absent, setAbsent] = useState(() => new Set());
  const [simulating, setSimulating] = useState(false);
  const [panel, setPanel] = useState(null); // { kind: 'tickets' | 'worked', ... }

  const data = useMemo(() => graphData(model, { zoom, absent, selectedId }), [model, zoom, absent, selectedId]);
  const rank = useMemo(() => ranking(model, absent), [model, absent]);
  const teams = useMemo(() => (zoom === 'team' ? teamSentences(model, absent) : []), [model, zoom, absent]);

  const openTickets = (title, keys) => setPanel({ kind: 'tickets', title, keys });
  const search = (input) => setPanel({ kind: 'worked', result: whoHasWorkedOn(model, input, { absent }) });
  const toggleOut = (id) =>
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const select = (id) => setSelectedId((cur) => (cur === id ? null : id));
  const sel = selectedId ? data.risk.get(selectedId) : null;

  return (
    <div className="jtm">
      <main className={`jtm-main${simulating ? ' jtm-simulation' : ''}`}>
          <div className="jtm-heading">
            <div><h1>Team map</h1><p className="jtm-intro">See dependencies and coverage across your team.</p></div>
            <button type="button" className="jtm-btn jtm-sim-button" aria-pressed={simulating} onClick={() => { if (simulating) setAbsent(new Set()); setSimulating(!simulating); }}>
              {simulating ? 'Exit simulation' : 'Simulate absence'}
            </button>
          </div>
          {simulating && <p className="jtm-sim-help" role="status">Choose people in the attention list or select a person on the map to mark them out. Exit simulation to restore everyone.</p>}
          <div className="jtm-overview" aria-label="Map overview">
            <div><strong>{prov.issues.n}</strong><span> Jira issues</span></div>
            <div><strong>{prov.assignedPct.n}%</strong><span> assigned</span></div>
            <div><strong>{prov.dependencyLinks.n}</strong><span> dependency links</span></div>
          </div>
          <details className="jtm-disclosure">
            <summary>Data &amp; coverage</summary>
            <p className="jtm-provenance" data-testid="provenance">
              Built from <Keys keys={prov.issues.keys} title={`${prov.issues.n} Jira issues`} onOpen={openTickets}>{prov.issues.n} Jira issues</Keys>{' '}
              with no manual input · <Keys keys={prov.assignedPct.keys} title="Assigned open work" onOpen={openTickets}>{prov.assignedPct.n}% assigned</Keys>{' '}
              · <Keys keys={prov.dependencyLinks.keys} title="Tickets in open dependency links" onOpen={openTickets}>{prov.dependencyLinks.n} dependency links</Keys>
            </p>
            <DataQuality model={model} onOpen={openTickets} />
          </details>

          <div className="jtm-toolbar">
            <ZoomControl zoom={zoom} onZoom={setZoom} />
            <SearchBox model={model} onSearch={search} />
          </div>
          {zoom === 'team' && teams.length > 0 && (
            <ul className="jtm-team-sentences" data-testid="team-sentences">
              {teams.map((t) => (
                <li key={t.id}><Keys keys={t.keys} title={t.sentence} onOpen={openTickets} className="jtm-num jtm-plain">{t.sentence}</Keys></li>
              ))}
            </ul>
          )}

          <div className="jtm-layout">
            <div className="jtm-col-main">
              <PeopleGraph
                model={model}
                data={data}
                selectedId={selectedId}
                absent={absent}
                onSelect={setSelectedId}
                onBadge={(_edgeId, blockerKey) => search(blockerKey)}
              />
              <details className="jtm-disclosure jtm-attention" open={simulating || undefined}>
                <summary>People needing attention</summary>
                <Ranking rows={rank.rows} absent={absent} selectedId={selectedId} onSelect={select} onToggleOut={toggleOut} onOpen={openTickets} />
              </details>
            </div>
            <div className="jtm-side">
              {data.impact && (
                <AbsencePanel model={model} impact={data.impact} onToggleOut={toggleOut} onClear={() => setAbsent(new Set())} onOpen={openTickets} />
              )}
              {sel && (
                <PersonDetail
                  model={model}
                  r={sel}
                  out={absent.has(selectedId)}
                  knowledge={data.knowledge}
                  near={workedNear(model, selectedId, { absent })}
                  onClose={() => setSelectedId(null)}
                  onToggleOut={() => toggleOut(selectedId)}
                  onOpen={openTickets}
                  onSearch={search}
                />
              )}
              {panel?.kind === 'tickets' && <TicketList model={model} title={panel.title} keys={panel.keys} onClose={() => setPanel(null)} />}
              {panel?.kind === 'worked' && <WorkedOnPanel result={panel.result} onClose={() => setPanel(null)} onOpen={openTickets} />}
              {!sel && !panel && !data.impact && <p className="jtm-muted jtm-hint">Select a person, a cover badge, or search a ticket or area.</p>}
            </div>
          </div>
      </main>
    </div>
  );
}
