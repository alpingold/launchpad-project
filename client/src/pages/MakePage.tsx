// /make: how to write a Game for the site with any AI, or by hand (story 36). The rules the
// Playtest enforces, what it does with a file, a ready-made prompt to copy, and the SDK's types,
// from the SDK's reference text, which the site's own AI reads too (@boilergames/sdk/v1/reference).
import { useEffect, useMemo, useState } from "react";
import { fileRules, playtestSteps, promptText, SDK_TYPES as sdkTypes, type GameLimits } from "../make/rules.js";
import { siteConfig } from "../site-config.js";

export function MakePage() {
  const [limits, setLimits] = useState<GameLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    // The limits are the site's own (/api/config), so the page quotes what the Playtest enforces.
    siteConfig().then(
      (config) => setLimits(config.limits),
      () => setError("The site's limits couldn't be loaded. Reload the page to try again."),
    );
  }, []);
  const prompt = useMemo(() => (limits === null ? "" : promptText(limits, sdkTypes)), [limits]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("Copied. Paste it into your AI, and replace the line in brackets with your idea.");
    } catch {
      setCopied("It couldn't be copied here: select the text in the box and copy it yourself.");
    }
  }

  return (
    <main className="page make">
      <p>
        <a href="/my/games">My Games</a>
      </p>
      <h1>Write a Game with any AI, or by hand</h1>
      <p>
        A Game is one TypeScript file, written against the site's SDK. Ask any AI chat to write it with the prompt below, or write it yourself, then upload it on My Games. The
        Playtest checks every Version and tells you each problem it finds.
      </p>
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {limits === null ? null : (
        <>
          <section>
            <h2>The rules a file must follow</h2>
            <ul>
              {fileRules(limits).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>What the Playtest does with it</h2>
            <ol>
              {playtestSteps(limits).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <section className="make-prompt">
            <h2>A prompt to start from</h2>
            <p>The rules, the SDK's types and a place for your idea. Copy it into any AI chat.</p>
            <textarea aria-label="The prompt" readOnly value={prompt} rows={12} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="page-button" onClick={() => void copy()}>
              Copy the prompt
            </button>
            {copied === null ? null : <p role="status">{copied}</p>}
          </section>
        </>
      )}
      <section>
        <h2>The SDK's types</h2>
        <p>Everything a Game may import from @boilergames/sdk/v1, with what each part is for.</p>
        <details>
          <summary>Show the types</summary>
          <pre className="make-types">{sdkTypes}</pre>
        </details>
      </section>
    </main>
  );
}
