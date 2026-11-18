// The emails the test servers recorded (never sent): the site's test server answers /__mail.
import { SITE } from "./origins.js";

export interface SentMail {
  readonly to: string;
  readonly text: string;
}

/**
 * Every email recorded so far. This is asked from the test's own Node process, not from a browser.
 * The server listens on "localhost", which is one address: 127.0.0.1 on some machines and ::1 on
 * others (GitHub's), and Node's fetch may try only the other one. So each is tried in turn.
 */
export async function sentMail(): Promise<SentMail[]> {
  const port = new URL(SITE).port;
  let last: unknown;
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    try {
      return (await (await fetch(`http://${host}:${port}/__mail`)).json()) as SentMail[];
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
