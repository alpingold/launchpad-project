// /my/games/<id>: one of the Creator's Games. Its description, and every Version, newest first, with
// its state: a Version being checked updates by itself; a failed one lists its problems; a ready one
// can be played (Play it opens a Screen on it) and published. Each Version's code can be downloaded,
// and each after the first compared with the one before it (See what changed). Upload a new Version here.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DESCRIPTION_MAX,
  myGame,
  publishVersion,
  saveDescription,
  sourcePath,
  STAGE_NAMES,
  TAKEN_DOWN,
  titleOf,
  unpublishGame,
  uploadVersion,
  versionSource,
  type Answer,
  type Game,
  type Version,
} from "../creator/creator-api.js";
import { compareVersions, type ComparedLine, type Comparison } from "../creator/compare.js";
import { needsACreator } from "../creator/needs-a-creator.js";
import { UploadBox } from "../creator/UploadBox.js";
import { MAX_NOTE_CHARS, reviseVersion } from "../maker/maker-api.js";
import { siteConfig } from "../site-config.js";

/** How often a Version being checked is asked about. */
export const CHECKING_POLL_MS = 2_000;

export function MyGamePage({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiMaker, setAiMaker] = useState(false);
  useEffect(() => {
    siteConfig().then(
      (config) => setAiMaker(config.aiMaker),
      () => undefined,
    );
  }, []);

  const load = useCallback(async () => {
    const reply = await myGame(id);
    if (needsACreator(reply.status)) return;
    if (reply.ok) {
      setGame(reply.value.game);
      setError(null);
    } else {
      setError(reply.error);
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  // While a Version is being checked, ask again every couple of seconds; stop once all have settled.
  const checking = game?.versions.some((version) => version.state === "checking") ?? false;
  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => void load(), CHECKING_POLL_MS);
    return () => clearInterval(timer);
  }, [checking, load]);

  /** Runs a change and shows the Game it comes back with, or why it didn't happen. */
  async function change(done: Promise<Answer<{ game: Game }>>): Promise<void> {
    const reply = await done;
    if (reply.ok) {
      setGame(reply.value.game);
      setError(null);
    } else {
      setError(reply.error);
    }
  }

  if (game === null) {
    return (
      <main className="page">
        <p>
          <a href="/my/games">My Games</a>
        </p>
        {error === null ? null : (
          <p className="page-notice" role="alert">
            {error}
          </p>
        )}
      </main>
    );
  }
  return (
    <main className="page">
      <p>
        <a href="/my/games">My Games</a>
      </p>
      <h1>{titleOf(game) ?? "Untitled Game"}</h1>
      {game.publishedVersionId === null ? null : (
        <p>
          <a href={`/library/${encodeURIComponent(game.id)}`}>Its page in the Library</a>, which anyone can see and host it from.
        </p>
      )}
      {game.takenDownAt === null ? null : (
        <p className="page-notice" role="status">
          {TAKEN_DOWN} You can still upload Versions and play them yourself.
        </p>
      )}
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      <Description game={game} save={(description) => change(saveDescription(game.id, description))} />
      <section>
        <h2>Versions</h2>
        <ol className="my-versions" reversed>
          {game.versions.map((version) => (
            <VersionLine
              key={version.id}
              gameId={game.id}
              version={version}
              before={
                // A Revision is compared with the Version it changed; any other with the one before it.
                version.revisedFrom === undefined || version.revisedFrom === null
                  ? game.versions.find((other) => other.number === version.number - 1)
                  : game.versions.find((other) => other.id === version.revisedFrom)
              }
              published={version.id === game.publishedVersionId}
              mayPublish={game.takenDownAt === null}
              publish={() => void change(publishVersion(game.id, version.id))}
              unpublish={() => void change(unpublishGame(game.id))}
              aiMaker={aiMaker}
            />
          ))}
        </ol>
      </section>
      <section>
        <h2>Upload a new Version</h2>
        <UploadBox label="Upload this Version" send={(source) => uploadVersion(game.id, source)} onSent={() => void load()} />
      </section>
    </main>
  );
}

function Description({ game, save }: { game: Game; save: (description: string) => Promise<void> }) {
  const [text, setText] = useState(game.description);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    await save(text);
    setBusy(false);
  }
  return (
    <form className="page-form" onSubmit={(event) => void submit(event)}>
      <label>
        Description
        <textarea rows={3} maxLength={DESCRIPTION_MAX} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <button className="page-button page-button-small page-button-quiet" type="submit" disabled={busy || text === game.description}>
        Save the description
      </button>
    </form>
  );
}

const STATE_WORDS = { checking: "Being checked…", ready: "Ready", failed: "Failed its check" } as const;

function VersionLine({
  gameId,
  version,
  before,
  published,
  mayPublish,
  publish,
  unpublish,
  aiMaker,
}: {
  gameId: string;
  version: Version;
  /** The Version before it, which See what changed compares it with. */
  before: Version | undefined;
  published: boolean;
  mayPublish: boolean;
  publish: () => void;
  unpublish: () => void;
  /** Whether the site's AI maker is on: then a ready Version can be changed by asking it. */
  aiMaker: boolean;
}) {
  const [comparing, setComparing] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <li className="my-version" data-state={version.state} aria-label={`Version ${version.number}`}>
      <p>
        <strong>Version {version.number}</strong>
        {version.about === null ? null : <> · {version.about.title}</>} · <span>{STATE_WORDS[version.state]}</span>
        {version.madeBy === "generation" ? <span> · made by the AI</span> : null}
        {version.madeBy === "revision" ? <span> · changed by the AI</span> : null}
        {published ? <strong className="my-published"> · Published</strong> : null}
      </p>
      {version.state === "failed" && version.problems !== null ? (
        <ul className="my-problems">
          {version.problems.map((problem, at) => (
            <li key={at}>
              {STAGE_NAMES[problem.stage] ?? problem.stage}
              {problem.line === undefined ? "" : `, line ${problem.line}`}: {problem.message}
            </li>
          ))}
        </ul>
      ) : null}
      {version.state === "ready" ? (
        <p className="my-version-actions">
          <a className="page-button page-button-small" href={`/screen?play=${encodeURIComponent(version.id)}`} target="_blank" rel="noopener">
            Play it
          </a>
          {published ? (
            <button type="button" className="page-button page-button-small page-button-quiet" onClick={unpublish}>
              Unpublish
            </button>
          ) : mayPublish ? (
            <button type="button" className="page-button page-button-small page-button-quiet" onClick={publish}>
              Publish
            </button>
          ) : null}
          {aiMaker ? (
            <button type="button" className="page-button page-button-small page-button-quiet" aria-expanded={asking} onClick={() => setAsking(!asking)}>
              Ask the AI for a change
            </button>
          ) : null}
        </p>
      ) : null}
      {asking && version.state === "ready" ? <AskForAChange gameId={gameId} versionId={version.id} /> : null}
      <p className="my-version-actions">
        <a className="page-button page-button-small page-button-quiet" href={sourcePath(gameId, version.id)} download={`version-${version.number}.ts`}>
          Download the code
        </a>
        {before === undefined ? null : (
          <button type="button" className="page-button page-button-small page-button-quiet" aria-expanded={comparing} onClick={() => setComparing(!comparing)}>
            {comparing ? "Hide what changed" : "See what changed"}
          </button>
        )}
      </p>
      {comparing && before !== undefined ? <Changes gameId={gameId} older={before} newer={version} /> : null}
    </li>
  );
}

/** A Revision: the Creator says what to change, and follows it on its own page. */
function AskForAChange({ gameId, versionId }: { gameId: string; versionId: string }) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ask(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const reply = await reviseVersion(gameId, versionId, request);
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    location.assign(`/my/generations/${encodeURIComponent(reply.value.id)}`);
  }
  return (
    <form className="page-form my-ask" onSubmit={(event) => void ask(event)}>
      <label>
        What should change?
        <textarea className="prose" rows={3} maxLength={MAX_NOTE_CHARS} value={request} onChange={(event) => setRequest(event.target.value)} />
      </label>
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="page-button page-button-small" disabled={busy || request.trim() === ""}>
        {busy ? "Asking…" : "Ask for the change"}
      </button>
    </form>
  );
}

const SIGNS = { added: "+", removed: "−", same: " " } as const;
const WORDS = { added: "Added", removed: "Removed", same: "" } as const;

/**
 * What changed from one Version to the next, line by line, worked out here in the browser. Each
 * added or removed line is marked three ways: a sign, a word and a colour.
 */
function Changes({ gameId, older, newer }: { gameId: string; older: Version; newer: Version }) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([versionSource(gameId, older.id), versionSource(gameId, newer.id)])
      .then(([before, after]) => compareVersions(before, after))
      .then(
        (result) => current && setComparison(result),
        (failed: unknown) => current && setError((failed as Error).message),
      );
    return () => {
      current = false;
    };
  }, [gameId, older.id, newer.id]);

  const label = `What changed from Version ${older.number} to Version ${newer.number}`;
  return (
    <section className="my-changes" aria-label={label}>
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {comparison === null && error === null ? <p>Comparing…</p> : null}
      {comparison?.kind === "tooLong" ? (
        <p>
          Comparing these two Versions took too long. Download both and compare them yourself:{" "}
          <a href={sourcePath(gameId, older.id)} download={`version-${older.number}.ts`}>
            Version {older.number}
          </a>{" "}
          and{" "}
          <a href={sourcePath(gameId, newer.id)} download={`version-${newer.number}.ts`}>
            Version {newer.number}
          </a>
          .
        </p>
      ) : null}
      {comparison?.kind === "compared" ? (
        <>
          <p>
            {comparison.added === 0 && comparison.removed === 0
              ? `No lines changed from Version ${older.number}.`
              : `From Version ${older.number}: ${comparison.added} ${comparison.added === 1 ? "line" : "lines"} added, ${comparison.removed} removed.`}
          </p>
          {comparison.added === 0 && comparison.removed === 0 ? null : (
            <div className="my-diff">
              {comparison.lines.map((line, at) => (
                <DiffLine key={at} line={line} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function DiffLine({ line }: { line: ComparedLine }) {
  if (line.kind === "unchanged") {
    return <div className="my-diff-line" data-kind="unchanged">{`… ${line.count} unchanged ${line.count === 1 ? "line" : "lines"}`}</div>;
  }
  const number = line.kind === "removed" ? line.oldNumber : line.newNumber;
  return (
    <div className="my-diff-line" data-kind={line.kind}>
      <span className="my-diff-sign" aria-hidden="true">
        {SIGNS[line.kind]}
      </span>
      <span className="my-diff-word">{WORDS[line.kind]}</span>
      <span className="my-diff-number">{number}</span>
      <code>{line.text}</code>
    </div>
  );
}
