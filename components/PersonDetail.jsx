import { KeyChip, KeyList, Num } from './Evidence.jsx';
import { collabTaskSentence } from '../analysis/sentences.js';

function Section({ title, count, keys, issues, empty, children }) {
  return (
    <section className="cr-sec">
      <h3>
        {title} {count != null && <Num n={count} keys={keys} issues={issues} label={title.toLowerCase()} />}
      </h3>
      {count === 0 ? <p className="cr-muted">{empty}</p> : children}
    </section>
  );
}

export function PersonDetail({ person, analysis, unblock, nearby, worksWith = [], continuing = [], isOut, othersOut, onToggleOut, issues, nameOf }) {
  if (!person) {
    return (
      <section className="cr-card cr-detail cr-detail--empty" aria-labelledby="cr-detail-h">
        <h2 id="cr-detail-h">Person detail</h2>
        <p className="cr-muted">Select a person in the graph or the ranking to see what depends on them, with the tickets behind every number.</p>
      </section>
    );
  }
  const a = analysis;
  const name = person.firstName;
  return (
    <section className={`cr-card cr-detail${isOut ? ' is-out' : ''}`} aria-labelledby="cr-detail-h" aria-live="polite">
      <header className="cr-detail__head">
        <div>
          <h2 id="cr-detail-h">{person.displayName}</h2>
          <p className="cr-muted">{person.team} <span title="Where the team name comes from">({person.teamSource})</span></p>
        </div>
        <button type="button" className={`cr-toggle${isOut ? ' is-on' : ''}`} aria-pressed={isOut} onClick={() => onToggleOut(person.accountId)}>
          <span className="cr-toggle__track" aria-hidden="true"><span className="cr-toggle__thumb" /></span>
          {isOut ? `${name} is out` : `Mark ${name} out`}
        </button>
      </header>

      <p className="cr-headline">
        {unblock.count > 0 ? (
          <>
            <Num n={unblock.count} keys={[...unblock.tasks.map((t) => t.key), ...unblock.blockerKeys]} issues={issues} label="downstream unblock count" className="cr-num--big" />
            <span> {unblock.sentence.replace(/^\d+ /, '')}</span>
          </>
        ) : (
          <span>{unblock.sentence}</span>
        )}
      </p>
      {unblock.tasks.length > 0 && (
        <ul className="cr-list cr-list--tight">
          {unblock.tasks.map((t) => (
            <li key={t.key}>
              <KeyChip k={t.key} issues={issues} /> {t.summary} <span className="cr-muted">({t.ownerName}) waits on</span> <KeyList keys={t.on} issues={issues} sep=", " />
              {t.alsoWaitsOn.length > 0 && (
                <span className="cr-muted"> · also waits on {t.alsoWaitsOn.map((x) => `${x.who}`).join(', ')} (<KeyList keys={t.alsoWaitsOn.map((x) => x.key)} issues={issues} sep=", " />)</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {unblock.further.length > 0 && (
        <p className="cr-muted">Further down the chain: <KeyList keys={unblock.further} issues={issues} sep=", " /></p>
      )}

      <div className="cr-scorebox">
        <div className="cr-scorebox__total">
          <span className="cr-muted">{isOut ? `Coverage risk while ${name} is out` : `Coverage risk if ${name} is out${othersOut.length ? ` (with ${othersOut.map(nameOf).join(', ')} already out)` : ''}`}</span>
          <strong>{a.score}</strong>
        </div>
        <table className="cr-scorebox__table">
          <tbody>
            {a.components.map((c) => (
              <tr key={c.rule} className={c.count ? '' : 'is-zero'}>
                <td className="cr-tnum">{c.count} × {c.each}</td>
                <td className="cr-tnum">= {c.points}</td>
                <td>{c.label}</td>
                <td>{c.keys.length ? <KeyList keys={c.keys} issues={issues} sep=" " /> : <span className="cr-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section title="Open tasks that would have no owner" count={a.orphaned.length} keys={a.orphaned.map((o) => o.key)} issues={issues} empty={`Every open task ${name} works on has someone else on it too.`}>
        <ul className="cr-list">
          {a.orphaned.map((o) => (
            <li key={o.key} className={o.scored ? '' : 'is-unscored'}>
              <KeyChip k={o.key} issues={issues} /> {o.summary}
              <span className="cr-muted"> · {o.role === 'owner' ? 'assignee' : 'sub-task'}</span>
              {o.trouble && <span className="cr-pill cr-pill--red">{o.troubleWhy}</span>}
              {o.scored
                ? <span className="cr-muted"> · blocks <KeyList keys={o.dependents} issues={issues} sep=", " /></span>
                : <span className="cr-muted"> · not scored: nothing waits on it</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="People left waiting" count={a.waiting.length} keys={[...new Set(a.waiting.flatMap((w) => w.keys))]} issues={issues} empty="No one would be left waiting.">
        <ul className="cr-list">
          {a.waiting.map((w) => (
            <li key={w.accountId}>
              <strong>{nameOf(w.accountId)}</strong>
              <span className="cr-chain" aria-label={`chain: ${w.people.join(' blocks ')}`}> {w.people.join(' → ')}</span>
              <span className="cr-muted"> via </span>
              <KeyList keys={w.keys} issues={issues} sep=" → " />
            </li>
          ))}
        </ul>
        <p className="cr-muted cr-small">Arrows read “blocks”: the first person’s ticket blocks the next.</p>
      </Section>

      {isOut && (
        <Section title={`Keeps going without ${name}`} count={continuing.filter((t) => t.out.includes(person.accountId)).length} keys={continuing.filter((t) => t.out.includes(person.accountId)).map((t) => t.key)} issues={issues} empty={`None of ${name}'s open work has anyone else on it.`}>
          <ul className="cr-list">
            {continuing.filter((t) => t.out.includes(person.accountId)).map((t) => (
              <li key={t.key} className="is-carried"><KeyChip k={t.key} issues={issues} /> {t.summary} <span className="cr-muted">· {t.by.map(nameOf).join(', ')} still on it</span></li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Works with" count={worksWith.length} keys={[...new Set(worksWith.flatMap((c) => c.keys))]} issues={issues} empty={`${name} has no tasks shared with anyone else in Jira (assignee and sub-tasks).`}>
        <ul className="cr-list">
          {worksWith.map((c) => (
            <li key={c.id} className={c.current ? '' : 'is-past'}>
              <strong>{nameOf(c.other)}</strong> <span className="cr-muted">· {c.current ? 'now' : 'before'}{c.aTeam !== c.bTeam ? ` · across ${c.aTeam} and ${c.bTeam}` : ''}</span>
              <ul className="cr-list cr-list--tight">
                {c.tasks.map((t) => <li key={t.key}>{collabTaskSentence(c, t, nameOf)}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Team pairs only ${name} connects`} count={a.bridges.length} keys={[...new Set(a.bridges.flatMap((b) => b.keys))]} issues={issues} empty="No team pair depends on this person alone.">
        <ul className="cr-list">
          {a.bridges.map((b) => (
            <li key={b.other}>{b.teams[0]} ↔ {b.teams[1]} <span className="cr-muted">· {name} is the only {b.teams[0]} person on these links:</span> <KeyList keys={b.keys} issues={issues} sep=" " /></li>
          ))}
        </ul>
      </Section>

      <Section title="Tasks whose lead would change" count={a.leadChanges.length} keys={a.leadChanges.map((l) => l.key)} issues={issues} empty="No task would change lead.">
        <ul className="cr-list">
          {a.leadChanges.map((l) => (
            <li key={l.key}><KeyChip k={l.key} issues={issues} /> {l.summary} <span className="cr-muted">· {l.why}</span></li>
          ))}
        </ul>
      </Section>

      <Section title="Stale items they own" count={a.stale.length} keys={a.stale.map((s) => s.key)} issues={issues} empty="Nothing stale.">
        <p className="cr-muted cr-small">Flag only. Not part of the score.</p>
        <ul className="cr-list">
          {a.stale.map((s) => (
            <li key={s.key}><KeyChip k={s.key} issues={issues} /> {s.summary} <span className="cr-pill">no update in {s.days} days</span></li>
          ))}
        </ul>
      </Section>

      <section className="cr-sec">
        <h3>Who else has worked near this</h3>
        <p className="cr-muted cr-small">Candidates found in Jira activity, not a recommendation. Up to 3.</p>
        {nearby.length === 0 ? (
          <p className="cr-muted">No one else shows up near this work in Jira.</p>
        ) : (
          <ul className="cr-list">
            {nearby.map((c) => (
              <li key={c.accountId}><strong>{c.name}</strong> <span className="cr-muted">· {c.reason}</span> <KeyList keys={c.keys} issues={issues} sep=" " /></li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
