// /sign-in/name: a new account picks its display name, the name other people will see. Its email
// address is never shown to anyone else.
import { useEffect, useState, type FormEvent } from "react";
import { post, whoIsSignedIn, type Me } from "../account/account-api.js";

export function NamePage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void whoIsSignedIn().then((found) => {
      setMe(found);
      if (found?.displayName != null) setName(found.displayName);
    });
  }, []);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const reply = await post("/api/me/display-name", { displayName: name });
    setBusy(false);
    if (reply.ok) return location.assign("/");
    setError(reply.error);
  }

  if (me === undefined) return <main className="page" />;
  if (me === null) {
    return (
      <main className="page">
        <h1>Pick a display name</h1>
        <p>
          You're not signed in. <a href="/sign-in">Sign in</a> first.
        </p>
      </main>
    );
  }
  return (
    <main className="page">
      <h1>Pick a display name</h1>
      <form className="page-form" onSubmit={(event) => void save(event)}>
        <p>This is the name other people see on the Games you make. Your email address is never shown to anyone.</p>
        <label>
          Display name
          <input autoComplete="nickname" required minLength={2} maxLength={30} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {error === null ? null : (
          <p className="page-notice" role="alert">
            {error}
          </p>
        )}
        <button className="page-button" type="submit" disabled={busy}>
          Save
        </button>
      </form>
    </main>
  );
}
