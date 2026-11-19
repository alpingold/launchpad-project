/**
 * A scripted model: it answers from a script, never from the internet. Every unit test uses one, and
 * the server uses one in development and the browser tests (GENAI_BASE_URL=fake, which production
 * refuses).
 *
 * A reply is either text, a failure, or a function that looks at what was asked and decides. The
 * replies are used in order; with none left, `respond` (if given) answers, or the call fails as
 * unavailable. Every call is recorded, with its key, so a test can see what was sent.
 */
import type { ChatMessage, CompleteOptions, Completion, Model, ModelFailure } from "./model.js";

export type ScriptedReply = string | { readonly failure: ModelFailure } | ((messages: readonly ChatMessage[]) => string | { readonly failure: ModelFailure });

export interface ScriptedModelOptions {
  /** Answers once the script has run out. */
  readonly respond?: (messages: readonly ChatMessage[]) => string | { readonly failure: ModelFailure };
  /** Keys the fake GenAI Studio refuses. Every other key is valid. */
  readonly rejectedKeys?: readonly string[];
  /** Makes each answer wait for this promise first: a test's way to hold a call open. */
  readonly hold?: () => Promise<void>;
  /**
   * Whether to keep every call, with its key, for a test to look at. Off for the development fake,
   * which runs for as long as a server does and has no test to read them.
   */
  readonly record?: boolean;
}

export class ScriptedModel implements Model {
  readonly calls: { readonly key: string; readonly messages: readonly ChatMessage[] }[] = [];
  readonly keyChecks: string[] = [];
  readonly #script: ScriptedReply[];
  readonly #options: ScriptedModelOptions;

  constructor(script: readonly ScriptedReply[] = [], options: ScriptedModelOptions = {}) {
    this.#script = [...script];
    this.#options = options;
  }

  /** Adds replies to the end of the script. (Not named `then`: that would make the fake look like a promise.) */
  add(...replies: ScriptedReply[]): this {
    this.#script.push(...replies);
    return this;
  }

  /** How many replies are left in the script. */
  get left(): number {
    return this.#script.length;
  }

  async complete(key: string, messages: readonly ChatMessage[], options: CompleteOptions = {}): Promise<Completion> {
    if (this.#options.record !== false) this.calls.push({ key, messages });
    await this.#options.hold?.();
    if (options.signal?.aborted === true) return { ok: false, failure: "unavailable" };
    const next = this.#script.shift() ?? this.#options.respond;
    if (next === undefined) return { ok: false, failure: "unavailable" };
    const reply = typeof next === "function" ? next(messages) : next;
    return typeof reply === "string" ? { ok: true, text: reply } : { ok: false, failure: reply.failure };
  }

  async checkKey(key: string): Promise<"valid" | ModelFailure> {
    if (this.#options.record !== false) this.keyChecks.push(key);
    return (this.#options.rejectedKeys ?? []).includes(key) ? "keyRejected" : "valid";
  }
}
