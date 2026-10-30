import { useEffect, useId, useRef, useState } from 'react';
import { browseUrl } from '../config.js';

// A ticket key, linked to Jira, with summary + status on hover.
export function KeyChip({ k, issues }) {
  const i = issues[k];
  const title = i ? `${i.summary} · ${i.status}${i.overdue ? ' · overdue' : ''}${i.stale ? ` · no update in ${i.daysSinceUpdate}d` : ''}` : k;
  return (
    <a className="cr-key" href={browseUrl(k)} target="_blank" rel="noreferrer" title={title}>
      {k}
    </a>
  );
}

export function KeyList({ keys, issues, sep }) {
  return (
    <span className="cr-keys">
      {keys.map((k, n) => (
        <span key={`${k}-${n}`}>
          {n > 0 && sep ? <span className="cr-sep">{sep}</span> : null}
          <KeyChip k={k} issues={issues} />
        </span>
      ))}
    </span>
  );
}

// A number that opens the ticket keys that produced it.
export function Num({ n, keys = [], issues, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!keys.length) return <span className={`cr-num cr-num--plain ${className}`}>{n}</span>;
  return (
    <span className={`cr-num ${className}`} ref={ref}>
      <button
        type="button"
        className="cr-num__btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${n}${label ? ` ${label}` : ''}: show ${keys.length} ticket${keys.length === 1 ? '' : 's'}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        {n}
      </button>
      {open && (
        <span className="cr-pop" id={id} role="dialog" aria-label={`Tickets behind ${label ?? n}`}>
          {label && <span className="cr-pop__label">{label}</span>}
          <KeyList keys={keys} issues={issues} />
        </span>
      )}
    </span>
  );
}
