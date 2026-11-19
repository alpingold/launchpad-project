// /privacy: what BoilerGames keeps, where, and for how long (story 45). Every sentence here was
// checked against the code or deploy/ when it was written (BUILD-PLAN Step 23, whose report lists
// where each was checked). Change the site, and this page may have to change with it.

/** The address people write to, forwarded to the owner (the owner's decision 4 for milestone 2b). */
export const CONTACT = "hello@boilergames.party";

export function PrivacyPage() {
  return (
    <main className="page privacy">
      <p>
        <a href="/">BoilerGames</a>
      </p>
      <h1>Privacy</h1>
      <p>What BoilerGames keeps about you, where, and for how long. It says what the site's code does.</p>

      <section>
        <h2>If you have an account</h2>
        <p>To make Games you sign in with your Purdue email address: the site emails you a link, and there is no password.</p>
        <p>The site keeps your email address, the display name you pick, when your account was made, and the Games you upload with the code of every Version of them.</p>
        <p>
          If you save a Purdue GenAI Studio key, the site keeps it encrypted, with its last 4 characters and when you saved it. It never shows the key again, only those
          4 characters, and you can delete it at any time. The secret it is encrypted with is kept on the server apart from the database, so the database's copies
          can't reveal your key.
        </p>
        <p>
          If you make a Game with the site's AI maker, the site keeps each Generation: your idea, the Concept the AI drafted with your changes to it, a note asking for a new
          draft until the AI has drafted it again, the code the AI wrote, each step it took with the problems the site's check found, when each step began and ended,
          how many tries it took, and why it failed if it did. It keeps each change you ask
          the AI to make to a Game the same way, with what you asked for. They stay until your account is removed.
        </p>
        <p>Your display name is public: it is shown with every Game you publish. Your email address is never shown on the site.</p>
        <p>
          While a Game is published, anyone can see its title and description, and load the built code of each of its Versions that passed the check: your code made
          into one readable file. The file you uploaded, as you uploaded it, is shown only to you.
        </p>
        <p>
          While you are signed in, the site keeps a record of the session: when it began and when it was last used. It keeps only a scrambled form of the cookie that
          signs you in, not the cookie itself, so a copy of the database can't sign anyone in.
        </p>
        <p>A sign-in link is kept the same way, scrambled, with the address it was sent to, and deleted soon after it runs out, 15 minutes after it was sent.</p>
        <p>Signing out deletes the session. An account doesn't run out: it stays until it is removed (see the end of this page).</p>
      </section>

      <section>
        <h2>When you play</h2>
        <p>Playing needs no account.</p>
        <p>A Room, and the names its Players type, live only in the server's memory and are gone when the Room closes. Nothing about a Room or its Players is written to the database.</p>
        <p>When a Match of a published or Official game finishes, that Game's count of plays may go up by one. The count is only a number: it doesn't say who played, when or where.</p>
      </section>

      <section>
        <h2>What your browser keeps</h2>
        <p>One cookie, which keeps you signed in. It lasts 90 days from when it was last used, and goes when you sign out.</p>
        <p>The site also keeps a few things in your browser's storage, only so that a reload carries on:</p>
        <ul>
          <li>On a phone in a Room: the Room Code and a token for your Seat, so a reload puts you back in the same Seat.</li>
          <li>
            On the Screen: the Room Code, the Host's token and the Match being played, with everything the Game keeps about it (its Players' names, and what they have
            typed or drawn in it), so a reload of the Screen carries on with it.
          </li>
          <li>While you sign in: the page you came from, so you go back to it afterwards.</li>
        </ul>
        <p>Each is removed once the page finds it isn't needed: when you leave the Room, when the Room or the Match ends, when you are back from signing in, or else the next time the page is opened.</p>
        <p>No tracking and no adverts: the site's pages load nothing from anyone else's site.</p>
      </section>

      <section>
        <h2>The server's logs</h2>
        <p>
          The web server in front of the site keeps no log of ordinary requests. When a request fails, for example in the few seconds the site takes to restart, it
          logs that request, with the visitor's network address.
        </p>
        <p>
          The site's own program writes a line to its log when it starts, when something fails, and when an admin takes a Game down or lifts a takedown. None of these
          lines holds a network address, an email address, a Room Code or a Player's name.
        </p>
        <p>The server keeps its logs for about a month, five weeks at most.</p>
      </section>

      <section>
        <h2>Network addresses</h2>
        <p>
          To stop floods, the server counts how often things come from each network address: sign-in emails asked for in the last hour, sign-in links that didn't work and
          wrong Room Codes in the last minute, Rooms opened in the last minute and Rooms and connections open now, and counted plays in the last 24 hours. It counts sign-in
          emails to each email address for 15 minutes too.
        </p>
        <p>These counts are kept only in the server's memory. They are forgotten as they get old, and all of them are gone whenever the server restarts, which it does with every new release of the site.</p>
      </section>

      <section>
        <h2>Who else handles it</h2>
        <p>The site runs on a server rented from Amazon Web Services (AWS), in its Ohio region. AWS also sends the sign-in emails and keeps the database's nightly copies.</p>
        <p>The site's addresses are looked up through Cloudflare, but your visits go straight to the server, not through Cloudflare.</p>
        <p>Mail to {CONTACT} is passed on by Cloudflare to the site owner's own inbox.</p>
        <p>When you save a GenAI Studio key, the site sends it to Purdue's GenAI Studio to check that it works.</p>
        <p>
          When you use the AI maker, the site sends GenAI Studio, with your key, what the AI needs to make your Game: your idea, the Concept and any note you write about
          it, the code the AI wrote, and the problems the site's check found in it. When you ask it to change a Version of one of your Games, it also sends what you
          asked for and that Version's code, which may be code you uploaded yourself. Nothing else you write is sent to an AI.
        </p>
        <p>
          Each of those requests is made with your own key, so it counts as your own use of GenAI Studio. GenAI Studio is Purdue's own service, not part of
          BoilerGames: what it keeps of what it is sent is up to Purdue.
        </p>
      </section>

      <section>
        <h2>Games made by other people</h2>
        <p>
          Apart from the Official games, the Games in the Library are written by other people, and nobody reviews them before they are published. Before a Game can be
          published, the site plays it through, walled off on the server, to check that it works.
        </p>
        <p>
          When you play, a Game runs in the Screen's browser, walled off in a frame on a separate domain that has no network. What Players send it reaches the Room and
          nothing outside it.
        </p>
        <p>BoilerGames never asks for a password or an email address inside a Game. If a Game asks you for one, that isn't BoilerGames asking.</p>
        <p>An admin can take any Game down.</p>
      </section>

      <section>
        <h2>Backups</h2>
        <p>Every night a copy of the whole database is kept at AWS, and each copy exists for up to 60 days. So something removed from the site is gone from those copies within 60 days.</p>
        <p>
          Before the database is changed for a new release of the site, the server also keeps a copy of it, so the change can be undone if it fails. It keeps the
          three newest such copies, and an account that is removed is removed from them too.
        </p>
      </section>

      <section>
        <h2>Having your account removed</h2>
        <p>
          Until you can do it yourself, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address you sign in with. Your account, your Games, the code of every Version
          of them, their counts of plays, your GenAI Studio key and your Generations will be removed by hand. A published Game of yours leaves the Library at once.
        </p>
      </section>
    </main>
  );
}

/** The foot of every page that has room for one: the privacy page's link. */
export function SiteFoot() {
  return (
    <footer className="site-foot">
      <a href="/privacy">Privacy</a>
    </footer>
  );
}
