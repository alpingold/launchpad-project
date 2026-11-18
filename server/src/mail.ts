/**
 * Sending email, behind one small interface, so the rest of the server never knows how.
 *
 * - RecordedMail keeps what it was given. Tests read it; in development it also prints each email's
 *   link to the console, so signing in works without sending anything.
 * - SES sends through Amazon SES v2 from sign-in@boilergames.party, signed with the server's own AWS
 *   role, so no mail password is stored anywhere. Used only when MAIL=ses. It is deliberately small:
 *   nobody can try it until the server's role may send (BUILD-PLAN Step 16).
 */
export interface Message {
  readonly to: string;
  readonly subject: string;
  /** Plain text. */
  readonly text: string;
}

export interface Mail {
  /** Resolves once the email is handed over; rejects if it couldn't be. */
  send(message: Message): Promise<void>;
}

export class RecordedMail implements Mail {
  readonly sent: Message[] = [];

  /** `print`: also print each email's links to the console (development). Never the address. */
  constructor(private readonly print = false) {}

  send(message: Message): Promise<void> {
    this.sent.push(message);
    if (this.print) for (const link of message.text.match(/https?:\/\/\S+/g) ?? []) console.log(`Email (not sent, development): ${message.subject}: ${link}`);
    return Promise.resolve();
  }
}

/** The address sign-in emails come from. Step 16 lets the server's role send from it and nothing else. */
export const SIGN_IN_FROM = "BoilerGames <sign-in@boilergames.party>";

/**
 * The mail sender the settings ask for. MAIL=ses sends through SES, in AWS_REGION (us-east-2 unless
 * set: the SDK doesn't find the Region by itself on a server). Without MAIL, emails are recorded and
 * their links printed, which only makes sense on a developer's computer, so production refuses it.
 *
 * The SES package is loaded here, at start, so a release that can't load it fails its health check
 * and is rolled back, rather than failing at the first sign-in.
 */
export async function mailFrom(env: Readonly<Record<string, string | undefined>>): Promise<Mail> {
  const kind = env["MAIL"] ?? "";
  if (kind === "ses") return sesMail(env["AWS_REGION"] || "us-east-2");
  if (kind !== "") throw new Error(`MAIL must be "ses" or unset, not "${kind}"`);
  if (env["NODE_ENV"] === "production") throw new Error("MAIL=ses must be set in production: without it no sign-in email would be sent");
  return new RecordedMail(true);
}

async function sesMail(region: string): Promise<Mail> {
  const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
  const client = new SESv2Client({ region });
  return {
    async send(message) {
      try {
        await client.send(
          new SendEmailCommand({
            FromEmailAddress: SIGN_IN_FROM,
            Destination: { ToAddresses: [message.to] },
            Content: { Simple: { Subject: { Data: message.subject, Charset: "UTF-8" }, Body: { Text: { Data: message.text, Charset: "UTF-8" } } } },
          }),
        );
      } catch (error) {
        // Only the kind of error: SES's own message can contain the recipient's address, and this
        // ends up in the log.
        throw new Error(`SES didn't take the email (${(error as Error).name})`);
      }
    },
  };
}
