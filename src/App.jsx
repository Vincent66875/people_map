import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildModel, provenance } from './analysis/adapter.js';
import { ranking } from './analysis/scoring.js';
import { whoHasWorkedOn, workedNear } from './analysis/search.js';
import { teamSentences } from './analysis/labels.js';
import { graphData } from './graph/graphData.js';
import PeopleGraph from './components/PeopleGraph.jsx';
import { AbsencePanel, DataQuality, Keys, PersonDetail, Ranking, SearchBox, TicketList, WorkedOnPanel, ZoomControl } from './components/Panels.jsx';

const COMPACT_BELOW = 1000; // px of app width; below this the panel overlays the map

/** True when the app frame (not the window) is narrower than `px`. */
function useCompact(ref, px) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < px));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, px]);
  return compact;
}

/**
 * Detail panel. Wide frame: docked beside the map (non-modal) so the map stays visible.
 * Narrow frame: modal overlay. Closes with ×, Esc, or a click outside.
 */
function Drawer({ open, compact, title, onClose, onBack, children }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => {
    if (!compact) return;
    const d = dialogRef.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, compact]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, title]);

  const header = (
    <header className="jtm-dialog-header">
      <div>
        {onBack && <button type="button" className="jtm-btn jtm-back" onClick={onBack}>← Back</button>}
        <h2 id="jtm-drawer-title" ref={headingRef} tabIndex={-1}>{title}</h2>
      </div>
      <button type="button" className="jtm-close" aria-label="Close panel" onClick={onClose}>×</button>
    </header>
  );

  if (compact)
    return (
      <dialog
        ref={dialogRef}
        className="jtm-dialog"
        aria-labelledby="jtm-drawer-title"
        data-testid="drawer"
        onCancel={(ev) => {
          ev.preventDefault();
          onClose();
        }}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) onClose(); // click on the backdrop
        }}
      >
        {open && header}
        {open && <div className="jtm-dialog-body">{children}</div>}
      </dialog>
    );

  if (!open) return null;
  return (
    <aside className="jtm-drawer" role="dialog" aria-modal="false" aria-labelledby="jtm-drawer-title" data-testid="drawer">
      {header}
      <div className="jtm-dialog-body">{children}</div>
    </aside>
  );
}

export default function App({ fixture, initialZoom = 'ticket' }) {
  const rootRef = useRef(null);
  const compact = useCompact(rootRef, COMPACT_BELOW);
  const model = useMemo(() => buildModel(fixture), [fixture]);
  const prov = provenance(model);
  const [zoom, setZoom] = useState(initialZoom);
  const [selectedId, setSelectedId] = useState(null);
  const [absent, setAbsent] = useState(() => new Set());
  const [simulating, setSimulating] = useState(false);
  const [stack, setStack] = useState([]);
  const opener = useRef(null);
  const view = stack[stack.length - 1] ?? null;

  const remember = () => {
    if (!stack.length) opener.current = document.activeElement;
  };
  const open = (next) => {
    remember();
    setStack([next]);
  };
  const push = (next) => {
    remember();
    setStack((prev) => [...prev, next]);
  };
  const closeAll = useCallback(() => {
    setStack([]);
    setSelectedId(null);
    const el = opener.current;
    opener.current = null;
    if (el && el.isConnected && typeof el.focus === 'function') requestAnimationFrame(() => el.focus());
  }, []);
  const back = () => setStack((prev) => prev.slice(0, -1));

  // A person stays selected only while their details are in the panel stack.
  useEffect(() => {
    if (selectedId && !stack.some((v) => v.kind === 'person')) setSelectedId(null);
  }, [stack, selectedId]);

  // Esc closes the docked panel too (the modal one handles Esc itself).
  useEffect(() => {
    if (!view || compact) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') closeAll();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, compact, closeAll]);

  const data = useMemo(() => graphData(model, { zoom, absent, selectedId }), [model, zoom, absent, selectedId]);
  const rank = useMemo(() => ranking(model, absent), [model, absent]);
  const teams = useMemo(() => (zoom === 'team' ? teamSentences(model, absent) : []), [model, zoom, absent]);
  const openTickets = (title, keys) => push({ kind: 'tickets', title, keys });
  const search = (input) => push({ kind: 'worked', result: whoHasWorkedOn(model, input, { absent }) });
  const toggleOut = (id) =>
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectPerson = (id) => {
    if (!id) {
      setSelectedId(null);
      setStack((prev) => prev.filter((v) => v.kind !== 'person'));
      return;
    }
    remember();
    setSelectedId(id);
    setStack((prev) => (prev[prev.length - 1]?.kind === 'person' ? prev : [...prev, { kind: 'person' }]));
  };
  const sel = selectedId ? data.risk.get(selectedId) : null;

  const titles = { search: 'Find who worked on a task', tickets: view?.title, ranking: 'People & coverage', data: 'Data & coverage', key: 'Map key', impact: 'Absence impact' };
  const title =
    view?.kind === 'person' && sel ? `${sel.name}${sel.team ? ` · ${sel.team}` : ''}`
      : view?.kind === 'worked' ? (view.result.query ? `Who has worked on ${view.result.label}?` : 'Who has worked on this?')
        : titles[view?.kind] ?? 'Details';

  return (
    <div className="jtm" ref={rootRef}>
      <main className={`jtm-main jtm-board${simulating ? ' jtm-simulation' : ''}`}>
        <header className="jtm-board-header">
          <div><h1>Team map</h1><p>Recorded dependencies between people</p></div>
          <div className="jtm-board-actions">
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'search' })}>Find work</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'ranking' })}>People &amp; coverage</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'data' })}>Data &amp; coverage</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'key' })}>Map key</button>
            <button type="button" className="jtm-btn" aria-pressed={simulating} onClick={() => {
              if (simulating) { setAbsent(new Set()); setSimulating(false); }
              else { setSimulating(true); open({ kind: 'ranking' }); }
            }}>{simulating ? 'Exit simulation' : 'Simulate absence'}</button>
          </div>
        </header>
        {simulating && (
          <div className="jtm-simulation-bar" role="status">
            <span>Absence simulation · {absent.size} marked out</span>
            <button type="button" className="jtm-btn jtm-btn--small" onClick={() => open({ kind: 'ranking' })}>Choose people</button>
            {data.impact && <button type="button" className="jtm-btn jtm-btn--small" onClick={() => open({ kind: 'impact' })}>View impact</button>}
          </div>
        )}
        <div className="jtm-map-toolbar"><ZoomControl zoom={zoom} onZoom={setZoom} /><span className="jtm-muted">Select a person or a badge for details</span></div>

        <div className={`jtm-stage${view && !compact ? ' jtm-stage--drawer' : ''}`}>
          <PeopleGraph
            model={model}
            data={data}
            selectedId={selectedId}
            absent={absent}
            onSelect={selectPerson}
            onBadge={(_id, key) => open({ kind: 'worked', result: whoHasWorkedOn(model, key, { absent }) })}
            onBackground={view && !compact ? closeAll : undefined}
          />
          <Drawer open={!!view} compact={compact} title={title} onClose={closeAll} onBack={stack.length > 1 ? back : null}>
            {view?.kind === 'search' && <><p>Search for a ticket or area to find people who have worked on it.</p><SearchBox model={model} onSearch={search} /></>}
            {view?.kind === 'worked' && <WorkedOnPanel bare result={view.result} onOpen={openTickets} />}
            {view?.kind === 'tickets' && <TicketList bare model={model} title={view.title} keys={view.keys} />}
            {view?.kind === 'person' && sel && <PersonDetail bare model={model} r={sel} out={absent.has(selectedId)} knowledge={data.knowledge} near={workedNear(model, selectedId, { absent })} onToggleOut={() => toggleOut(selectedId)} onOpen={openTickets} onSearch={search} />}
            {view?.kind === 'ranking' && <><p className="jtm-muted">{simulating ? 'Mark people out; the map updates beside this panel.' : 'Select a person to see their work and connections.'}</p><Ranking rows={rank.rows} absent={absent} selectedId={selectedId} onSelect={selectPerson} onToggleOut={toggleOut} onOpen={openTickets} /></>}
            {view?.kind === 'impact' && data.impact && <AbsencePanel bare model={model} impact={data.impact} onToggleOut={toggleOut} onClear={() => { setAbsent(new Set()); closeAll(); }} onOpen={openTickets} />}
            {view?.kind === 'impact' && !data.impact && <p className="jtm-muted">No one is marked out.</p>}
            {view?.kind === 'data' && <><p data-testid="provenance">Built from <Keys keys={prov.issues.keys} title={`${prov.issues.n} Jira issues`} onOpen={openTickets}>{prov.issues.n} Jira issues</Keys> · <Keys keys={prov.assignedPct.keys} title="Assigned open work" onOpen={openTickets}>{prov.assignedPct.n}% assigned</Keys> · <Keys keys={prov.dependencyLinks.keys} title="Tickets in open dependency links" onOpen={openTickets}>{prov.dependencyLinks.n} recorded dependency links</Keys>.</p><DataQuality model={model} onOpen={openTickets} /></>}
            {view?.kind === 'key' && <><ul className="jtm-key-list"><li>Arrow points from the person waiting to the person they wait on.</li><li>Red arrow: the blocking task is blocked or overdue.</li><li>Green check: another person has worked on the blocking task.</li><li>Amber 1: only one person has worked on the blocking task.</li><li>Larger person nodes indicate higher coverage risk.</li><li>Dotted green line: someone has worked on the selected person's work.</li><li>In absence simulation, rings indicate people left waiting or people with context.</li></ul>{teams.length > 0 && <><h3>Team connections</h3><ul>{teams.map((t) => <li key={t.id}><Keys keys={t.keys} title={t.sentence} onOpen={openTickets}>{t.sentence}</Keys></li>)}</ul></>}</>}
          </Drawer>
        </div>
      </main>
    </div>
  );
}
