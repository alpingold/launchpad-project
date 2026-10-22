import { useState } from 'react';

// Uploading a game file (plan §57): one .html file you wrote, or made with an AI of your own
// (the prompt on /kit). Choose the file or paste it, and say it's yours to share. The site
// checks it in the background with no AI, so no key is needed. Used on /create (a new game)
// and on a game's own page (its next version).

/**
 * @param {{ info: { enabled: boolean, maxUploadBytes: number }, newVersion?: boolean, disabled?: boolean,
 *   onUpload: (source: string) => Promise<{ ok: boolean, message?: string, problems?: unknown[] }> }} props
 *   onUpload: sends the file; the page moves on when it was accepted
 */
export default function UploadForm({ info, newVersion = false, disabled = false, onUpload }) {
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState(null);
  const [mine, setMine] = useState(false);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const bytes = new Blob([source]).size;
  const tooBig = bytes > info.maxUploadBytes;
  const off = disabled || busy || !info.enabled;

  async function choose(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setProblems([]);
    if (file.size > info.maxUploadBytes) {
      setSource('');
      setFileName(null);
      return setError(`That file is ${kb(file.size)}; a game file can be up to ${kb(info.maxUploadBytes)}.`);
    }
    setSource(await file.text());
    setFileName(file.name);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setProblems([]);
    const res = await onUpload(source);
    setBusy(false);
    if (res.ok) return;
    setError(res.message ?? 'Something went wrong. Please try again.');
    setProblems(Array.isArray(res.problems) ? res.problems : []);
  }

  return (
    <form className="admin-form upload-form" onSubmit={handleSubmit}>
      <label>
        {newVersion ? 'The new game file' : 'Your game file'} (.html)
        <input type="file" accept=".html,.htm,text/html" onChange={choose} disabled={off} />
      </label>
      <details className="upload-paste">
        <summary>Or paste it</summary>
        <label>
          The whole file
          <textarea
            value={fileName ? '' : source}
            onChange={(e) => {
              setFileName(null);
              setSource(e.target.value);
            }}
            rows={6}
            spellCheck={false}
            placeholder={'<script type="application/json" id="game-info">…'}
            disabled={off}
          />
        </label>
      </details>
      {fileName && <p className="muted small">{`${fileName}, ${kb(bytes)}`}</p>}
      <label className="create-check">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={off} />
        <span>I made this game, or I'm allowed to share it. (Once it's public, others can remix it, unless you turn that off.)</span>
      </label>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{typeof p === 'string' ? p : p.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="create-submit">
        <button type="submit" className="primary-button" disabled={off || !mine || source.trim() === '' || tooBig}>
          {busy ? 'Uploading…' : newVersion ? 'Upload it as a new version' : 'Upload and check it'}
        </button>
        <span className="muted small">{tooBig ? `Too big: up to ${kb(info.maxUploadBytes)}` : 'No API key needed'}</span>
      </div>
    </form>
  );
}

const kb = (bytes) => `${Math.ceil(bytes / 1024)} KB`;
