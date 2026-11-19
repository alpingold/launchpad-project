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
  return send<T>("POST", path, body);
}

export async function put<T>(path: string, body: unknown): Promise<Answer<T>> {
  return send<T>("PUT", path, body);
}

export async function del<T>(path: string, body: unknown = {}): Promise<Answer<T>> {
  return send<T>("DELETE", path, body);
}

async function send<T>(method: string, path: string, body: unknown): Promise<Answer<T>> {
  try {
    return await answer<T>(await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

const UNREACHABLE = "The site can't be reached. Check the connection and try again.";

/** A read, with the reply's status too: a page that needs an account tells "signed out" (401) apart. */
export async function get<T>(path: string): Promise<Answer<T> & { readonly status: number }> {
  try {
    const response = await fetch(path);
    return { ...(await answer<T>(response)), status: response.status };
  } catch {
    return { ok: false, error: UNREACHABLE, status: 0 };
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
