// /library/<id>: one Game's page, by its Game id (an Official game by its name), and Host this Game,
// which opens a Screen offering it.
import { useEffect, useState } from "react";
import { lookStyle } from "../kit/look-style.js";
import { aboutPlays, hostAddress, libraryEntry, madeBy, playerCount, type LibraryEntry } from "../library/library-api.js";

export function LibraryGamePage({ id }: { id: string }) {
  const [game, setGame] = useState<LibraryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void libraryEntry(id).then((reply) => {
      if (reply.ok) setGame(reply.value);
      else setError(reply.status === 404 ? "There's no such Game in the Library. It may have been unpublished." : reply.error);
    });
  }, [id]);

  return (
    <main className="page library-game">
      <p>
        <a href="/library">Library</a>
      </p>
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {game === null ? null : (
        <>
          <header className="library-game-head" style={lookStyle(game.look)}>
            <h1>{game.title}</h1>
            <p>{playerCount(game.players)}</p>
          </header>
          {game.description === "" ? null : <p className="library-game-description">{game.description}</p>}
          <p>{madeBy(game)}</p>
          <p>{aboutPlays(game.plays)}</p>
          <a className="page-button" href={hostAddress(game)}>
            Host this Game
          </a>
        </>
      )}
    </main>
  );
}
