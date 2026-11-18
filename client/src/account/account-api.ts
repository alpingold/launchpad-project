/**
 * The pages' side of accounts: who is signed in, and the requests that sign in and out. Every
 * request that changes something is a POST with a JSON body: the server refuses anything else
 * (site.ts, onlyFromTheSite). The browser adds the Origin header and the session cookie itself.
 */

/** The signed-in account, as the server tells it to that account. */
export interface Me {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
}

/** What a request came back with: its JSON when it worked, or the server's words when it didn't. */
export type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

async function answer<T>(response: Response): Promise<Answer<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.ok) return { ok: true, value: body as T };
  const error = (body as { error?: unknown } | undefined)?.error;
  return { ok: false, error: typeof error === "string" ? error : "Something went wrong. Try again." };
}

export async function post<T>(path: string, body: unknown): Promise<Answer<T>> {
  try {
    return await answer<T>(await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  } catch {
    return { ok: false, error: "The site can't be reached. Check the connection and try again." };
  }
}

/** Who is signed in: the account, null for nobody, or undefined if the server couldn't be asked. */
export async function whoIsSignedIn(): Promise<Me | null | undefined> {
  try {
    const reply = await answer<{ account: Me | null }>(await fetch("/api/me"));
    return reply.ok ? reply.value.account : undefined;
  } catch {
    return undefined;
  }
}

export const signOut = (): Promise<Answer<unknown>> => post("/api/sign-out", {});
