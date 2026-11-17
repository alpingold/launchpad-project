// The front page: host a Room on this screen, or join one from a phone.
export function HomePage() {
  return (
    <main className="page page-home">
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
