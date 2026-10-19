import { useState } from 'react';
import Markdown from '../Markdown.jsx';
import { formatTime } from './text.js';

/**
 * A design (or a change's plan) waiting for you: read it, then Build it, ask the AI for a new
 * draft, or edit it yourself. Earlier drafts are kept below.
 */
export function DesignEditor({ version: v, isPlan, busy, info, canDiscard, onRedesign, onSaveDesign, onBuild, onDiscard, banner = true }) {
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.design);
  const what = isPlan ? 'plan' : 'design';
  const feedbackLength = feedback.trim().length;

  return (
    <div className="gen-design-editor">
      {banner && (
        <p className="banner" role="status">
          {v.status === 'failed'
            ? `The build failed. Change the ${what} and build again, or just build again.`
            : `Read the ${what}. Nothing is built until you press Build it.`}
        </p>
      )}
      {v.drafts.length > 0 && v.drafts.at(-1).feedback && (
        <p className="muted small">
          This draft was written after: <q>{v.drafts.at(-1).feedback}</q>
        </p>
      )}
      {editing ? (
        <label className="admin-form">
          Edit the {what} (Markdown)
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(30, draft.split('\n').length + 2)} maxLength={info.maxDesignLength} />
        </label>
      ) : (
        <div className="card gen-design-text" aria-label={`The ${what}`}>
          <Markdown text={v.design} headingOffset={3} />
        </div>
      )}
      <div className="gen-actions">
        {editing ? (
          <>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={async () => {
                if (await onSaveDesign(draft)) setEditing(false);
              }}
            >
              Save my edit
            </button>
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary-button" disabled={busy || !info.enabled} onClick={onBuild}>
              {v.status === 'failed' ? 'Build it again' : 'Build it'}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(true)}>
              Edit it myself
            </button>
            {canDiscard && (
              <button type="button" className="secondary-button danger-button" disabled={busy} onClick={onDiscard}>
                Discard v{v.version}
              </button>
            )}
          </>
        )}
      </div>
      {!editing && (
        <form
          className="admin-form gen-change"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onRedesign(feedback)) setFeedback('');
          }}
        >
          <label>
            Ask the AI for a new draft
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              maxLength={info.maxIdeaLength}
              placeholder={isPlan ? 'e.g. Keep the old levels; only add the new one at the end.' : 'e.g. Make it 2 rounds, and let the phones pick a colour.'}
              disabled={!info.enabled}
            />
          </label>
          <button type="submit" className="secondary-button" disabled={busy || !info.enabled || feedbackLength < info.minFeedbackLength}>
            Write a new draft
          </button>
        </form>
      )}
      {v.drafts.length > 1 && (
        <details className="gen-drafts">
          <summary>Earlier drafts ({v.drafts.length - 1})</summary>
          <ol>
            {v.drafts.slice(0, -1).map((d, i) => (
              <li key={i}>
                <p className="muted small">
                  {d.by === 'admin' ? 'Your edit' : 'By the AI'}
                  {d.feedback && (
                    <>
                      , after: <q>{d.feedback}</q>
                    </>
                  )}{' '}
                  · {formatTime(d.at)}
                </p>
                <Markdown text={d.text} headingOffset={4} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
