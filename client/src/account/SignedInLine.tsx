// The line at the top of the home page: who is signed in, with sign out; or a way to sign in.
// An account that has no display name yet is sent to pick one.
import { useEffect, useState } from "react";
import { signOut, whoIsSignedIn, type Me } from "./account-api.js";

export function SignedInLine() {
  // undefined: not known yet (or the server couldn't be asked): nothing is shown.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    void whoIsSignedIn().then((found) => {
      if (found?.displayName === null) return location.assign("/sign-in/name");
      setMe(found);
    });
  }, []);
  if (me === undefined) return <p className="account-line" aria-hidden="true" />;
  if (me === null) {
    return (
      <p className="account-line">
        <a href="/sign-in">Sign in</a>
      </p>
    );
  }
  return (
    <p className="account-line">
      Signed in as <strong>{me.displayName}</strong>{" "}
      <button
        type="button"
        className="page-link"
        onClick={() => {
          void signOut().then((done) => {
            if (done.ok) setMe(null);
          });
        }}
      >
        Sign out
      </button>
    </p>
  );
}
