import { usePageTitle } from '../usePageTitle.js';
import { reportHref } from '../components/report.js';

// The privacy page (plan §54): what BoilerGames keeps, why, and how to remove it, in plain
// words. It describes what the server actually stores (server/src/db/SCHEMA.md): keep the two
// in step when either changes.

export default function Privacy() {
  usePageTitle('Privacy');
  return (
    <main className="page privacy-page">
      <h1>Privacy</h1>
      <p className="muted">Last changed October 28, 2026.</p>
      <p>
        BoilerGames is a student project. It keeps as little about you as it can, never sells or shares it, and has no ads,
        no analytics and no tracking cookies. Here is everything it keeps, and why.
      </p>

      <section className="page-section" aria-labelledby="playing">
        <h2 id="playing">Playing</h2>
        <p>
          Joining a game needs no account. The name you type is only used in that room, and the room is gone when the game
          ends.
        </p>
        <p>
          When a game ends, the site notes which game it was and whether it was played to the end or stopped (and why),
          to show on its page how many times it was played, and to see which games work well. Nothing about who played,
          or anything anyone typed, is kept with it.
        </p>
        <p>
          Games are made by players, and they go public without anyone at BoilerGames checking them first. Each game runs
          walled off from the rest of the site, with no access to your account, but a game made to misbehave could still
          send what it sees (the players' names, what you type into it, and your device's internet address) to another
          website. Don't type anything private into a game, and report a game that asks for it.
        </p>
      </section>

      <section className="page-section" aria-labelledby="account">
        <h2 id="account">Your account</h2>
        <ul>
          <li>
            <strong>Your username and password.</strong> The password is stored only as a one-way scrambled form (a
            "hash"), so nobody can read it, not even the site. No email address is asked for.
          </li>
          <li>
            <strong>A login cookie</strong>, so you stay logged in (for up to 30 days). It's the only cookie the site sets,
            and pages can't read it.
          </li>
          <li>
            <strong>What you add:</strong> your bio, the games you make or upload (their ideas, designs and code), your
            votes, and bug reports.
          </li>
        </ul>
      </section>

      <section className="page-section" aria-labelledby="key">
        <h2 id="key">Your GenAI Studio key</h2>
        <p>
          Making games with AI uses Purdue GenAI Studio, with your own API key. If you save one, it is stored{' '}
          <strong>encrypted</strong>; the secret that unlocks it is a separate file on the server, never in the database
          itself, so a copy of the database alone can't reveal any key. It is used for one
          thing only: asking GenAI Studio to make and change <em>your</em> games. Nobody is ever shown it again; the site
          only shows its last four characters. You can remove it any time on your <a href="/account">account page</a>.
        </p>
        <p>
          While making your games with AI, your ideas, the designs and the code are sent to Purdue GenAI Studio. Its own
          terms cover what it does with them. A game file you upload is checked on BoilerGames' own server, with no AI; it's
          only sent to GenAI Studio if you ask the AI to review or change it.
        </p>
      </section>

      <section className="page-section" aria-labelledby="reports">
        <h2 id="reports">Bug reports</h2>
        <p>
          A bug report keeps what you wrote, the page it was about, and a short description of your device (like "iPhone,
          Safari"), to help find the bug. You can send one without an account.
        </p>
      </section>

      <section className="page-section" aria-labelledby="where">
        <h2 id="where">Where it's kept</h2>
        <p>
          On one server in the United States (Amazon Web Services). A copy of the database is made every day for safety,
          and copies older than 14 days are deleted. Saved API keys stay encrypted in those copies, and the secret that
          unlocks them is never copied with them, so the copies alone can't reveal any key. The site always uses an
          encrypted connection (HTTPS).
        </p>
      </section>

      <section className="page-section" aria-labelledby="delete">
        <h2 id="delete">Removing it</h2>
        <ul>
          <li>
            <strong>Your key:</strong> remove it on your <a href="/account">account page</a>.
          </li>
          <li>
            <strong>Everything:</strong> delete your account on your <a href="/account">account page</a>. That deletes your
            account, your games (with their votes, reports and the record of times they were played), your votes, your key
            and your logins at once. Bug reports you sent from the report form stay, without your name. Daily copies of the database still hold it until they're deleted, within 14 days.
          </li>
        </ul>
      </section>

      <section className="page-section" aria-labelledby="questions">
        <h2 id="questions">Questions</h2>
        <p>
          Anything about your data: <a href={reportHref()}>send a message</a> through the report form.
        </p>
      </section>
    </main>
  );
}
