// /my/games: the Creator's Games, each with its title, whether it is published and its newest
// Version's state; and the upload box for a new Game. Signed out, it sends you to sign in and back.
import { useEffect, useState } from "react";
import { myGames, uploadGame, type Game, type GameLine } from "../creator/creator-api.js";
import { needsACreator } from "../creator/needs-a-creator.js";
import { UploadBox } from "../creator/UploadBox.js";
import { myGenerations, type Generation } from "../maker/maker-api.js";
import { siteConfig } from "../site-config.js";

/** A Generation's state, in a word or two, on My Games. */
const MADE: Readonly<Record<Generation["state"], string>> = {
  concept: "the AI is drafting its Concept",
  review: "waiting for you to approve its Concept",
  build: "the AI is writing it",
  playtest: "being checked",
  ready: "made",
  failed: "failed",
  cancelled: "cancelled",
};

const STATES = { checking: "being checked", ready: "ready", failed: "failed its check" } as const;

export function MyGamesPage() {
  const [games, setGames] = useState<readonly GameLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generations, setGenerations] = useState<readonly Generation[] | null>(null);
  useEffect(() => {
    // The AI maker's part of the page, only when it is on.
    void siteConfig().then(
      async (config) => {
        if (!config.aiMaker) return;
        const reply = await myGenerations();
        setGenerations(reply.ok ? reply.value : []);
      },
      () => undefined,
    );
    void myGames().then((reply) => {
      if (needsACreator(reply.status)) return;
      if (reply.ok) setGames(reply.value.games);
      else setError(reply.error);
    });
  }, []);

  return (
    <main className="page">
      <p>
        <a href="/">BoilerGames</a>
      </p>
      <h1>My Games</h1>
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {games === null ? null : games.length === 0 ? (
        <p>You haven't uploaded a Game yet.</p>
      ) : (
        <ul className="my-games">
          {games.map((game) => (
            <li key={game.id}>
              <a href={`/my/games/${encodeURIComponent(game.id)}`}>{game.title ?? "Untitled Game"}</a>
              <span>{game.published ? "Published" : "Not published"}</span>
              {game.latest === null ? null : (
                <span>
                  Version {game.latest.number}: {STATES[game.latest.state]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {generations === null ? null : (
        <section>
          <h2>Make a Game with the AI</h2>
          <p>
            <a href="/make/ai">Describe an idea</a>, and the site's AI makes a Game of it with your GenAI Studio key.
          </p>
          {generations.length === 0 ? null : (
            <ul className="my-games">
              {generations.map((made) => (
                <li key={made.id}>
                  <a href={`/my/generations/${encodeURIComponent(made.id)}`}>
                    {made.kind === "revision" ? `A change: ${[...made.idea].slice(0, 40).join("")}` : (made.concept?.title ?? [...made.idea].slice(0, 40).join(""))}
                  </a>
                  <span>{MADE[made.state]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section>
        <h2>Upload a new Game</h2>
        <p>
          <a href="/make">How to write a Game with any AI, or by hand</a>: the rules, a prompt to copy and the SDK's types.
        </p>
        <p>
          <a href="/my/genai-key">Your GenAI Studio key</a>, for the site's own AI maker.
        </p>
        <UploadBox label="Upload" send={uploadGame} onSent={(sent) => location.assign(`/my/games/${encodeURIComponent((sent as { game: Game }).game.id)}`)} />
      </section>
    </main>
  );
}
