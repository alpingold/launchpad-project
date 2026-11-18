// The front page: host a Room on this screen, or join one from a phone. Neither needs an account;
// the line at the top says who is signed in, for what comes later (making Games).
import { SignedInLine } from "../account/SignedInLine.js";

export function HomePage() {
  return (
    <main className="page page-home">
      <SignedInLine />
      <h1>BoilerGames</h1>
      <p>Party games on a shared screen, played from your phones.</p>
      <nav className="home-choices">
        <a className="page-button" href="/screen">
          Host a Room
        </a>
        <a className="page-button page-button-quiet" href="/play">
          Join a Room
        </a>
      </nav>
    </main>
  );
}
