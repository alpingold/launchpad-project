// /sign-in: a Purdue email address in, a link out by email. No password, ever.
import { useEffect, useState, type FormEvent } from "react";
import { post } from "../account/account-api.js";
import { rememberWhereTo } from "../account/after-sign-in.js";

export function SignInPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sent here from a page that needs an account (/sign-in?next=/my/games): go back there after.
  useEffect(() => rememberWhereTo(new URLSearchParams(location.search).get("next")), []);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const reply = await post("/api/sign-in", { email });
    setBusy(false);
    if (reply.ok) {
      setSentTo(email.trim().toLowerCase());
      setError(null);
    } else {
      setError(reply.error);
    }
  }

  return (
    <main className="page page-sign-in">
      <h1>Sign in</h1>
      {sentTo === null ? (
        <form className="page-form" onSubmit={(event) => void send(event)}>
          <p>Enter your Purdue email address. We'll email you a link that signs you in: there is no password.</p>
          <label>
            Purdue email
            <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error === null ? null : (
            <p className="page-notice" role="alert">
              {error}
            </p>
          )}
          <button className="page-button" type="submit" disabled={busy}>
            Email me a link
          </button>
        </form>
      ) : (
        <>
          <p role="status">
            Check your email at <strong>{sentTo}</strong>. Open the link in it and press the button there. The link works for 15 minutes.
          </p>
          <button type="button" className="page-link" onClick={() => setSentTo(null)}>
            Use another address, or send it again
          </button>
        </>
      )}
      <p>
        <a href="/">Back to the home page</a>
      </p>
    </main>
  );
}
