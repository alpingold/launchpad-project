// /make/ai: describe an idea, and the site's AI makes a Game of it (story 24). The AI first drafts a
// Concept for the Creator to read and approve; the Generation's own page (/my/generations/<id>)
// follows it from there. With the AI maker off, or no key saved, the page says so.
import { useEffect, useState, type FormEvent } from "react";
import { needsACreator } from "../creator/needs-a-creator.js";
import { keyStatus, MAX_IDEA_CHARS, startGeneration } from "../maker/maker-api.js";
import { siteConfig } from "../site-config.js";

export function AiMakePage() {
  const [aiMaker, setAiMaker] = useState<boolean | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    siteConfig().then(
      (config) => setAiMaker(config.aiMaker),
      () => setAiMaker(false),
    );
    void keyStatus().then((reply) => {
      if (needsACreator(reply.status)) return;
      setHasKey(reply.ok && reply.value.saved && reply.value.usable !== false);
    });
  }, []);

  async function start(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const reply = await startGeneration(idea);
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    location.assign(`/my/generations/${encodeURIComponent(reply.value.id)}`);
  }

  return (
    <main className="page">
      <p>
        <a href="/my/games">My Games</a>
      </p>
      <h1>Make a Game with the AI</h1>
      <p>
        Describe the Game you want, in a few sentences. The site's AI drafts its design first (a Concept) for you to read, change and approve; then it writes the Game, and the
        site plays it through to check it works. It takes a few minutes, and uses your GenAI Studio key.
      </p>
      {aiMaker === false ? (
        <p className="page-notice" role="status">
          The site's AI maker isn't available yet.
        </p>
      ) : null}
      {aiMaker === true && hasKey === false ? (
        <p className="page-notice" role="status">
          The AI uses your own GenAI Studio key: <a href="/my/genai-key">save your key</a> first.
        </p>
      ) : null}
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {aiMaker === true && hasKey === true ? (
        <form className="page-form" onSubmit={(event) => void start(event)}>
          <label>
            Your idea
            <textarea className="prose" rows={6} maxLength={MAX_IDEA_CHARS} value={idea} onChange={(event) => setIdea(event.target.value)} />
          </label>
          <p className="page-quiet">
            {idea.length} of {MAX_IDEA_CHARS} characters
          </p>
          <button className="page-button" type="submit" disabled={busy || idea.trim() === ""}>
            {busy ? "Starting…" : "Make it"}
          </button>
        </form>
      ) : null}
    </main>
  );
}
