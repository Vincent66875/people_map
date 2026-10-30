import { WEIGHTS } from '../analysis/coverage.js';
import { Num } from './Evidence.jsx';

const RULES = [
  ['orphan', 'Open task with no one left doing work on it (only if something waits on it)'],
  ['orphanTrouble', '…plus, if that task is already Blocked or overdue'],
  ['waiting', 'Each distinct person left waiting, following chains to the end'],
  ['bridge', 'Each team pair connected only through this person'],
  ['leadChange', 'Each task that keeps going but changes lead'],
];

export function Formula() {
  return (
    <details className="cr-formula">
      <summary>How coverage risk is scored</summary>
      <table>
        <tbody>
          {RULES.map(([rule, text]) => (
            <tr key={rule}>
              <td className="cr-formula__pts">{rule === 'orphanTrouble' ? '+' : ''}{WEIGHTS[rule]}</td>
              <td>{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>“Covered” means 2+ people doing work (assignee or open sub-task assignee). Reporters don’t count. Stale items are flagged separately and never add to the score.</p>
    </details>
  );
}

export function Ranking({ ranking, baselineScores, absentPeople, selectedId, onSelect, onToggleOut, nameOf, teamOf, issues, staleCount }) {
  return (
    <section className="cr-card cr-ranking" aria-labelledby="cr-ranking-h">
      <h2 id="cr-ranking-h">Coverage risk ranking</h2>
      <p className="cr-muted">If this person were out{absentPeople.length ? `, on top of ${absentPeople.map(nameOf).join(', ')}` : ''}: what stops.</p>
      <Formula />

      {absentPeople.length > 0 && (
        <div className="cr-out-list" aria-live="polite">
          <span className="cr-out-list__label">Marked out</span>
          {absentPeople.map((id) => (
            <span className="cr-out-chip" key={id}>
              {nameOf(id)}
              <button type="button" onClick={() => onToggleOut(id)} aria-label={`Mark ${nameOf(id)} back in`}>back in</button>
            </span>
          ))}
        </div>
      )}

      <ol className="cr-rank" aria-live="polite">
        {ranking.map((r, n) => {
          const allKeys = [...new Set(r.components.flatMap((c) => c.keys))];
          const stale = staleCount(r.accountId);
          const delta = r.score - (baselineScores.get(r.accountId) ?? 0);
          return (
            <li key={r.accountId} className={`cr-rank__item${selectedId === r.accountId ? ' is-selected' : ''}`}>
              <span className="cr-rank__pos">{n + 1}</span>
              <div className="cr-rank__body">
                <button type="button" className="cr-rank__name" onClick={() => onSelect(r.accountId)} aria-pressed={selectedId === r.accountId}>
                  {nameOf(r.accountId)} <span className="cr-muted">· {teamOf(r.accountId)}</span>
                </button>
                <div className="cr-rank__reasons">
                  {r.reasons.map((f, i) => (
                    <span key={f.rule}>
                      {i > 0 && <span className="cr-sep"> · </span>}
                      <Num n={f.count} keys={f.keys} issues={issues} label={f.text} /> {f.text}
                    </span>
                  ))}
                  {stale.count > 0 && (
                    <span className="cr-flag" title="Flag only, not in the score">
                      <Num n={stale.count} keys={stale.keys} issues={issues} label="stale" /> stale
                    </span>
                  )}
                </div>
              </div>
              <span className="cr-rank__score">
                <Num n={r.score} keys={allKeys} issues={issues} label="coverage risk" className="cr-num--score" />
                {delta !== 0 && <span className={`cr-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>{delta > 0 ? `+${delta}` : delta}</span>}
              </span>
            </li>
          );
        })}
        {ranking.length === 0 && <li className="cr-muted">No one has coverage risk above 0.</li>}
      </ol>
    </section>
  );
}
