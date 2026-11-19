// /my/games: the Creator's Games, each with its title, whether it is published and its newest
// Version's state; and the upload box for a new Game. Signed out, it sends you to sign in and back.
import { useEffect, useState } from "react";
import { myGames, uploadGame, type Game, type GameLine } from "../creator/creator-api.js";
import { needsACreator } from "../creator/needs-a-creator.js";
import { UploadBox } from "../creator/UploadBox.js";

const STATES = { checking: "being checked", ready: "ready", failed: "failed its check" } as const;

export function MyGamesPage() {
  const [games, setGames] = useState<readonly GameLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
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
      <section>
        <h2>Upload a new Game</h2>
        <p>
          <a href="/make">How to write a Game with any AI, or by hand</a>: the rules, a prompt to copy and the SDK's types.
        </p>
        <UploadBox label="Upload" send={uploadGame} onSent={(sent) => location.assign(`/my/games/${encodeURIComponent((sent as { game: Game }).game.id)}`)} />
      </section>
    </main>
  );
}
