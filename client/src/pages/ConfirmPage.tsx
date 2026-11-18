// /sign-in/confirm#<token>: the page the emailed link opens. Opening it does nothing: Purdue's mail
// is scanned by a service that opens every link, and that must not sign anyone in or use the link
// up. Only pressing the button sends the token. The token is after the #, so the browser never
// sends it to the server in the address, and it never reaches a log or a Referer header.
import { useState } from "react";
import { post, type Me } from "../account/account-api.js";

export function ConfirmPage({ hash = typeof location === "undefined" ? "" : location.hash }: { hash?: string }) {
  const token = hash.replace(/^#/, "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(): Promise<void> {
    setBusy(true);
    const reply = await post<{ account: Me }>("/api/sign-in/confirm", { token });
    if (!reply.ok) {
      setBusy(false);
      return setError(reply.error);
    }
    // The token is used up; take it out of the address and the history all the same.
    history.replaceState(null, "", "/sign-in/confirm");
    location.assign(reply.value.account.displayName === null ? "/sign-in/name" : "/");
  }

  if (token === "") {
    return (
      <main className="page">
        <h1>Sign in</h1>
        <p>This page needs the link from your sign-in email. Open the link from the email itself.</p>
        <p>
          <a href="/sign-in">Ask for a sign-in link</a>
        </p>
      </main>
    );
  }
  return (
    <main className="page">
      <h1>Sign in to BoilerGames</h1>
      <p>Press the button to finish signing in on this device.</p>
      {error === null ? (
        <button type="button" className="page-button" disabled={busy} onClick={() => void confirm()}>
          Sign in
        </button>
      ) : (
        <>
          <p className="page-notice" role="alert">
            {error}
          </p>
          <p>
            <a href="/sign-in">Ask for a new sign-in link</a>
          </p>
        </>
      )}
    </main>
  );
}
