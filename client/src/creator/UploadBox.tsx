// The upload box: choose a .ts file or paste the code, and send it. The site checks it (the
// Playtest) after it arrives; this only sends it.
import { useState, type FormEvent } from "react";
import { siteConfig } from "../site-config.js";
import type { Answer } from "./creator-api.js";

export function UploadBox({ label, send, onSent }: { label: string; send: (source: string) => Promise<Answer<unknown>>; onSent: (answer: unknown) => void }) {
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chooseFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    // The largest source the site takes: the Playtest's own limit, from the site. If the site can't
    // say, the file is read, and the site refuses it when it is sent if it is too large.
    const maxBytes = await siteConfig().then(
      (config) => config.limits.maxSourceBytes,
      () => null,
    );
    if (maxBytes !== null && file.size > maxBytes) return setError(`That file is ${Math.ceil(file.size / 1024)} KB; a Game's code may be at most ${maxBytes / 1024} KB.`);
    setSource(await file.text());
    setFileName(file.name);
    setError(null);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (source.trim() === "") return setError("Choose a .ts file, or paste the Game's code.");
    setBusy(true);
    const reply = await send(source);
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    setSource("");
    setFileName(null);
    setError(null);
    onSent(reply.value);
  }

  return (
    <form className="page-form upload-box" onSubmit={(event) => void submit(event)}>
      <label>
        Choose a .ts file
        <input type="file" accept=".ts,text/plain" onChange={(event) => void chooseFile(event.target.files?.[0])} />
      </label>
      <label>
        Or paste the code
        <textarea
          rows={8}
          spellCheck={false}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setFileName(null);
          }}
        />
      </label>
      {fileName === null ? null : <p>Ready to send {fileName}.</p>}
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      <button className="page-button" type="submit" disabled={busy}>
        {label}
      </button>
    </form>
  );
}
