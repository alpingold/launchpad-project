// /my/genai-key: the Creator's own Purdue GenAI Studio key, which the site's AI maker uses to make
// Games for them (story 24). Save it, see whether one is saved (its last 4 characters only), delete it.
import { useEffect, useState, type FormEvent } from "react";
import { needsACreator } from "../creator/needs-a-creator.js";
import { deleteKey, keyStatus, saveKey, type KeyStatus } from "../maker/maker-api.js";
import { siteConfig } from "../site-config.js";

export function KeyPage() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [aiMaker, setAiMaker] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    void keyStatus().then((reply) => {
      if (needsACreator(reply.status)) return;
      if (reply.ok) setStatus(reply.value);
      else setError(reply.error);
    });
    siteConfig().then(
      (config) => setAiMaker(config.aiMaker),
      () => setAiMaker(false),
    );
  }, []);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setSaid(null);
    const reply = await saveKey(key);
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    setStatus(reply.value);
    setKey("");
    setError(null);
    setSaid("Saved. GenAI Studio accepted the key.");
  }

  async function remove(): Promise<void> {
    setBusy(true);
    const reply = await deleteKey();
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    setStatus(reply.value);
    setError(null);
    setSaid("Deleted. The site no longer has your key.");
  }

  return (
    <main className="page">
      <p>
        <a href="/my/games">My Games</a>
      </p>
      <h1>Your GenAI Studio key</h1>
      <p>
        The site's AI maker makes Games with Purdue's GenAI Studio, using your own key, so each Game it makes for you is asked for with your key and counts as your use of
        GenAI Studio. You get a key from GenAI Studio's own settings.
      </p>
      <p>The site keeps your key encrypted, and never shows it again once saved: only its last 4 characters. You can delete it here at any time.</p>
      {aiMaker === false ? (
        <p className="page-notice" role="status">
          The site's AI maker isn't available yet, so a key can't be saved for now.
        </p>
      ) : null}
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {said === null ? null : <p role="status">{said}</p>}
      {status === null ? null : status.saved ? (
        <section>
          <h2>Saved</h2>
          <p>Your key ending in {status.last4} is saved.</p>
          <button type="button" className="page-button page-button-quiet" disabled={busy} onClick={() => void remove()}>
            Delete my key
          </button>
        </section>
      ) : (
        <p>No key is saved.</p>
      )}
      {aiMaker === true ? (
        <form className="page-form" onSubmit={(event) => void save(event)}>
          <label>
            {status?.saved === true ? "Replace it with a new key" : "GenAI Studio key"}
            <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} />
          </label>
          <button className="page-button" type="submit" disabled={busy || key.trim() === ""}>
            {busy ? "Checking it with GenAI Studio…" : "Save the key"}
          </button>
        </form>
      ) : null}
    </main>
  );
}
