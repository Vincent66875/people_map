import { useMemo, useRef } from 'react';
import { edgePath, layoutGraph, radiusFor } from '../analysis/layout.js';
import { collabLabel, collabSentences, edgeLabel, pairSentence } from '../analysis/sentences.js';

// Hero: people are nodes, tickets are edge labels. Arrow = "waits on",
// drawn from the waiter to the person they wait on. Green casing / green line =
// the two people work on the same task (assignee + sub-task assignees).
const pairKey = (x, y) => [x, y].sort().join('~');

export function PersonGraph({ people, edges, collabEdges = [], layer = 'both', baselineScores, scores, absent, impact, zoom, selectedId, onSelect, nameOf }) {
  const showDeps = layer !== 'works';
  const showCollab = layer !== 'waits';
  const collabByPair = useMemo(() => new Map(collabEdges.map((c) => [c.id, c])), [collabEdges]);
  const depPairs = useMemo(() => new Set(edges.map((e) => pairKey(e.from, e.to))), [edges]);
  const layout = useMemo(() => layoutGraph(people, edges, baselineScores), [people, edges, baselineScores]);
  const nodeRefs = useRef(new Map());
  const edgeIds = new Set(edges.map((e) => e.id));

  const neighbours = useMemo(() => {
    if (!selectedId) return null;
    const s = new Set([selectedId]);
    if (showDeps) for (const e of edges) if (e.from === selectedId || e.to === selectedId) { s.add(e.from); s.add(e.to); }
    if (showCollab) for (const c of collabEdges) if (c.a === selectedId || c.b === selectedId) { s.add(c.a); s.add(c.b); }
    return s;
  }, [edges, collabEdges, selectedId, showDeps, showCollab]);

  const radius = (id) => radiusFor(absent.has(id) ? baselineScores.get(id) ?? 0 : scores.get(id) ?? 0);

  const moveFocus = (id, key) => {
    const { order, pos } = layout;
    const here = pos.get(id);
    let target = null;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const col = layout.columns[here.col].members;
      target = col[here.row + (key === 'ArrowDown' ? 1 : -1)]?.accountId;
    } else {
      const step = key === 'ArrowRight' ? 1 : -1;
      for (let c = here.col + step; c >= 0 && c < layout.columns.length && !target; c += step) {
        const m = layout.columns[c].members;
        if (m.length) target = m[Math.min(here.row, m.length - 1)].accountId;
      }
    }
    if (!target) target = order[(order.indexOf(id) + (key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
    nodeRefs.current.get(target)?.focus();
  };

  return (
    <div className="cr-graph">
      <svg
        className="cr-graph__svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="group"
        aria-label="Who waits on whom and who works together. People are nodes; arrows point from the person waiting to the person they wait on; green lines join people who work on the same task."
      >
        <defs>
          {['base', 'red', 'muted', 'sel'].map((k) => (
            <marker key={k} id={`cr-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`cr-arrow cr-arrow--${k}`} />
            </marker>
          ))}
        </defs>

        {layout.columns.map((c) => (
          <g key={c.team} aria-hidden="true">
            <rect className="cr-col" x={c.x - 82} y={20} width={164} height={layout.height - 34} rx={10} />
            <text className="cr-col__label" x={c.x} y={44} textAnchor="middle">{c.team}</text>
          </g>
        ))}

        <g aria-hidden="true">
          {showCollab && collabEdges.filter((c) => layer === 'works' || !depPairs.has(c.id)).map((c) => {
            const a = layout.pos.get(c.a);
            const b = layout.pos.get(c.b);
            if (!a || !b) return null;
            const g = edgePath(a, b, radius(c.a), radius(c.b));
            g.label = g.at(0.75); // off-centre so it doesn't sit on dependency labels, which use the midpoint
            const carried = impact.carriedCollabIds?.has(c.id);
            const outEnd = absent.has(c.a) || absent.has(c.b);
            const touches = selectedId && (c.a === selectedId || c.b === selectedId);
            const faded = selectedId && !touches && !carried;
            const label = (carried ? 'continues: ' : '') + collabLabel(c, zoom);
            const w = Math.max(40, label.length * 6.1 + 12);
            return (
              <g key={c.id} className={`cr-collab${c.current ? '' : ' is-past'}${carried ? ' is-carried' : ''}${outEnd && !carried ? ' is-muted' : ''}${faded ? ' is-faded' : ''}`} data-collab={c.id}>
                <path d={g.d} className="cr-collab__line" strokeWidth={4 + Math.min(c.weight, 3) * 2} />
                {(c.current || touches || carried) && (
                  <>
                    <rect className="cr-collab__bg" x={g.label.x - w / 2} y={g.label.y - 10} width={w} height={20} rx={4} />
                    <text className="cr-collab__text" x={g.label.x} y={g.label.y + 4} textAnchor="middle">{label}</text>
                  </>
                )}
              </g>
            );
          })}
          {showDeps && edges.map((e) => {
            const a = layout.pos.get(e.from);
            const b = layout.pos.get(e.to);
            if (!a || !b) return null;
            const reverse = edgeIds.has(`${e.to}->${e.from}`);
            const g = edgePath(a, b, radius(e.from), radius(e.to), { reverse });
            const broken = impact.brokenEdgeIds.has(e.id);
            const waiterOut = absent.has(e.from);
            const touches = selectedId && (e.from === selectedId || e.to === selectedId);
            const faded = selectedId && !touches && !broken;
            const tone = broken || e.red ? 'red' : waiterOut ? 'muted' : touches ? 'sel' : 'base';
            const shared = showCollab ? collabByPair.get(pairKey(e.from, e.to)) : null;
            const carried = shared && impact.carriedCollabIds?.has(shared.id);
            const label = (broken ? 'stalls: ' : '') + edgeLabel(e, zoom, edges) + (shared ? ` · ${collabLabel(shared, 'ticket')}` : '');
            const w = Math.max(40, label.length * 6.1 + 12);
            return (
              <g key={e.id} className={`cr-edge cr-edge--${tone}${broken ? ' is-broken' : ''}${faded ? ' is-faded' : ''}${shared ? ' has-shared' : ''}`} data-edge={e.id}>
                {shared && <path d={g.d} className={`cr-collab__casing${shared.current ? '' : ' is-past'}${carried ? ' is-carried' : ''}`} strokeWidth={10 + Math.min(shared.weight, 3) * 2} />}
                <path d={g.d} className="cr-edge__line" strokeWidth={1.5 + Math.min(e.weight, 4) * 0.9} markerEnd={`url(#cr-arrow-${tone})`} />
                <rect className="cr-edge__bg" x={g.label.x - w / 2} y={g.label.y - 10} width={w} height={20} rx={4} />
                <text className="cr-edge__text" x={g.label.x} y={g.label.y + 4} textAnchor="middle">{label}</text>
              </g>
            );
          })}
        </g>

        {layout.columns.flatMap((c) =>
          c.members.map((p) => {
            const { x, y } = layout.pos.get(p.accountId);
            const out = absent.has(p.accountId);
            const score = scores.get(p.accountId);
            const r = radius(p.accountId);
            const waiting = impact.waitingIds.has(p.accountId);
            const selected = selectedId === p.accountId;
            const base = baselineScores.get(p.accountId) ?? 0;
            const delta = out || score == null ? 0 : score - base;
            const faded = neighbours && !neighbours.has(p.accountId) && !waiting && !delta;
            const label = `${p.displayName}, ${p.team}. ${out ? 'Marked out.' : `Coverage risk ${score ?? 0}${delta ? ` (${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} with current absences)` : ''}.`}${waiting ? ' Left waiting by someone who is out.' : ''}${selected ? ' Selected.' : ''}`;
            return (
              <g
                key={p.accountId}
                ref={(el) => (el ? nodeRefs.current.set(p.accountId, el) : nodeRefs.current.delete(p.accountId))}
                className={`cr-node${out ? ' is-out' : ''}${selected ? ' is-selected' : ''}${waiting ? ' is-waiting' : ''}${faded ? ' is-faded' : ''}`}
                transform={`translate(${x},${y})`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={label}
                data-person={p.firstName}
                onClick={() => onSelect(p.accountId)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(p.accountId); }
                  if (ev.key.startsWith('Arrow')) { ev.preventDefault(); moveFocus(p.accountId, ev.key); }
                }}
              >
                {waiting && <circle className="cr-node__ring" r={r + 6} />}
                <circle className="cr-node__dot" r={r} />
                <text className="cr-node__score" y={5} textAnchor="middle">{out ? 'out' : score ?? 0}</text>
                <text className="cr-node__name" y={r + 18} textAnchor="middle">{p.firstName}</text>
                {delta !== 0 && (
                  <g className={`cr-node__delta ${delta > 0 ? 'is-up' : 'is-down'}`} transform={`translate(${r * 0.75},${-r * 0.75})`}>
                    <rect x={-15} y={-10} width={30} height={18} rx={9} />
                    <text y={3} textAnchor="middle">{delta > 0 ? `+${delta}` : delta}</text>
                  </g>
                )}
              </g>
            );
          }),
        )}
      </svg>

      <ul className="cr-legend" aria-label="Legend">
        <li><span className="cr-swatch cr-swatch--base" /> waits on</li>
        <li><span className="cr-swatch cr-swatch--red" /> blocker overdue or Blocked</li>
        <li><span className="cr-swatch cr-swatch--broken" /> stalls: blocker’s person is out, no one else on it</li>
        <li><span className="cr-swatch cr-swatch--ring" /> left waiting</li>
        {showCollab && <li><span className="cr-swatch cr-swatch--collab" /> work on the same task (faded = before)</li>}
        {showCollab && showDeps && <li><span className="cr-swatch cr-swatch--cased" /> waits on and works together</li>}
        <li>node size = coverage risk · thicker line = more ticket pairs</li>
      </ul>

      <details className="cr-sr">
        <summary>Read the graph as text ({edges.reduce((n, e) => n + e.weight, 0)} dependencies, {collabEdges.reduce((n, c) => n + c.weight, 0)} shared tasks)</summary>
        <ul>
          {edges.flatMap((e) =>
            e.pairs.map((p) => (
              <li key={`${e.id}:${p.blockerKey}`}>
                {pairSentence(e, p, nameOf)}
                {impact.brokenEdgeIds.has(e.id) ? ` Stalled: ${nameOf(e.to)} is out.` : ''}
              </li>
            )),
          )}
          {collabEdges.flatMap((c) =>
            collabSentences(c, nameOf).map((t, n) => (
              <li key={`${c.id}:${n}`}>
                {t}
                {impact.carriedCollabIds?.has(c.id) ? ` Continues: ${nameOf(absent.has(c.a) ? c.b : c.a)} is still on it.` : ''}
              </li>
            )),
          )}
        </ul>
      </details>
    </div>
  );
}
