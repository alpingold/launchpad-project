// /my/games/<id>: one of the Creator's Games. Its description, and every Version, newest first, with
// its state: a Version being checked updates by itself; a failed one lists its problems; a ready one
// can be played (Play it opens a Screen on it) and published. Upload a new Version here.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DESCRIPTION_MAX,
  myGame,
  publishVersion,
  saveDescription,
  STAGE_NAMES,
  TAKEN_DOWN,
  titleOf,
  unpublishGame,
  uploadVersion,
  type Answer,
  type Game,
  type Version,
} from "../creator/creator-api.js";
import { needsACreator } from "../creator/needs-a-creator.js";
import { UploadBox } from "../creator/UploadBox.js";

/** How often a Version being checked is asked about. */
export const CHECKING_POLL_MS = 2_000;

export function MyGamePage({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              version={version}
              published={version.id === game.publishedVersionId}
              mayPublish={game.takenDownAt === null}
              publish={() => void change(publishVersion(game.id, version.id))}
              unpublish={() => void change(unpublishGame(game.id))}
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
  version,
  published,
  mayPublish,
  publish,
  unpublish,
}: {
  version: Version;
  published: boolean;
  mayPublish: boolean;
  publish: () => void;
  unpublish: () => void;
}) {
  return (
    <li className="my-version" data-state={version.state} aria-label={`Version ${version.number}`}>
      <p>
        <strong>Version {version.number}</strong>
        {version.about === null ? null : <> · {version.about.title}</>} · <span>{STATE_WORDS[version.state]}</span>
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
        </p>
      ) : null}
    </li>
  );
}
