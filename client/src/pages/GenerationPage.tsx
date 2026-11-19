// /my/generations/<id>: one Generation. Its Track: where it is, whether it waits on the AI, on the
// Creator, or failed and why, and each step with the problems it found. While the AI works, the page
// asks again every few seconds; otherwise not. In review, the Concept to read, change, send back for
// a new draft with a note, or approve.
import { useEffect, useState, type FormEvent } from "react";
import { needsACreator } from "../creator/needs-a-creator.js";
import {
  approve,
  cancelGeneration,
  editConcept,
  generation as fetchGeneration,
  MAX_NOTE_CHARS,
  redraft,
  working,
  type Concept,
  type Generation,
  type Step,
} from "../maker/maker-api.js";

/** How often the page asks again while the AI works. */
const POLL_MS = 3_000;

const KINDS: Readonly<Record<Step["kind"], string>> = {
  concept: "Drafting the Concept",
  build: "Writing the Game",
  typeFix: "Fixing the Game's code",
  playtest: "Checking the Game",
};

const OUTCOMES: Readonly<Record<string, string>> = {
  valid: "a usable Concept",
  invalid: "not usable",
  answered: "written",
  noCode: "the answer had no code",
  passed: "passed",
  problems: "found problems",
  checkFailed: "the check itself failed",
  interrupted: "cut short",
  rateLimited: "GenAI Studio was busy",
  unavailable: "GenAI Studio couldn't be reached",
  keyRejected: "GenAI Studio refused the key",
};

const at = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** One line on where it is, and who it waits on. */
function whereItIs(generation: Generation): string {
  const line = generation.place !== null && generation.place > 0 ? ` It is number ${generation.place} in the line.` : "";
  const waiting =
    generation.waiting === null ? "" : ` GenAI Studio is ${generation.waiting.why === "rateLimited" ? "busy" : "not answering"}: the AI tries again at ${at(generation.waiting.until)}.`;
  switch (generation.state) {
    case "concept":
      return `Waiting on the AI: it is drafting the Concept.${line}${waiting}`;
    case "review":
      return "Waiting on you: read the Concept, change it if you like, and approve it.";
    case "build":
      return `Waiting on the AI: it is writing the Game (Build ${generation.builds}).${line}${waiting}`;
    case "playtest":
      return `Waiting on the site: it is checking the Game (Build ${generation.builds}).${line}`;
    case "ready":
      return "Ready: the Game passed its check.";
    case "failed":
      return `Failed. ${generation.reason ?? ""}`;
    case "cancelled":
      return `Cancelled. ${generation.reason ?? ""}`;
  }
}

export function GenerationPage({ id }: { id: string }) {
  const [shown, setShown] = useState<Generation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(): Promise<void> {
      const reply = await fetchGeneration(id);
      if (stopped || needsACreator(reply.status)) return;
      if (!reply.ok) return setError(reply.error);
      setShown(reply.value);
      if (working(reply.value.state)) timer = setTimeout(() => void load(), POLL_MS);
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Asked again when a change sets the Generation working again (approve, redraft).
  }, [id, shown?.state !== undefined && working(shown.state)]);

  async function act(action: () => ReturnType<typeof approve>, done: string): Promise<void> {
    setBusy(true);
    const reply = await action();
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    setError(null);
    setSaid(done);
    setShown(reply.value);
  }

  if (shown === null) {
    return (
      <main className="page">
        <p>
          <a href="/my/games">My Games</a>
        </p>
        {error === null ? <p>Loading…</p> : <p role="alert">{error}</p>}
      </main>
    );
  }
  const over = shown.state === "ready" || shown.state === "failed" || shown.state === "cancelled";
  return (
    <main className="page generation">
      <p>
        <a href="/my/games">My Games</a>
      </p>
      <h1>{shown.kind === "revision" ? `A change to ${shown.concept?.title ?? "your Game"}` : (shown.concept?.title ?? "A new Game")}</h1>
      <p className="generation-where" role="status" data-state={shown.state}>
        {whereItIs(shown)}
      </p>
      {shown.state === "ready" && shown.gameId !== null ? (
        <p>
          <a href={`/my/games/${encodeURIComponent(shown.gameId)}`}>Go to the Game</a>
          {shown.kind === "revision" ? ": its new Version isn't published. Play it, and publish it when you like." : ": play it, and publish it when you like."}
        </p>
      ) : null}
      {error === null ? null : (
        <p className="page-notice" role="alert">
          {error}
        </p>
      )}
      {said === null ? null : <p className="page-quiet">{said}</p>}
      <section>
        <h2>{shown.kind === "revision" ? "What you asked for" : "Your idea"}</h2>
        <p className="generation-idea">{shown.idea}</p>
      </section>
      {shown.state === "review" && shown.concept !== null ? (
        <ConceptReview
          key={shown.updatedAt}
          concept={shown.concept}
          busy={busy}
          onSave={(concept) => void act(() => editConcept(id, concept), "Your changes are saved.")}
          onApprove={(concept) => void act(() => approve(id, concept), "Approved: the AI writes the Game now.")}
          onRedraft={(note) => void act(() => redraft(id, note), "Sent back: the AI drafts it again.")}
        />
      ) : null}
      {over ? null : (
        <p>
          <button type="button" className="page-button page-button-quiet" disabled={busy} onClick={() => void act(() => cancelGeneration(id), "Cancelled.")}>
            Cancel this Generation
          </button>
        </p>
      )}
      <Track steps={shown.steps ?? []} />
    </main>
  );
}

/** Every step, in order, with what it found. */
function Track({ steps }: { steps: readonly Step[] }) {
  if (steps.length === 0) return null;
  return (
    <section>
      <h2>Its Track</h2>
      <ol className="generation-steps">
        {steps.map((step) => (
          <li key={step.number} aria-label={`Step ${step.number}`}>
            <span>
              {KINDS[step.kind]}: {step.outcome === null ? "under way" : (OUTCOMES[step.outcome] ?? step.outcome)}
            </span>
            {step.problems === null || step.problems.length === 0 ? null : (
              <ul className="my-problems">
                {step.problems.map((problem, n) => (
                  <li key={n}>
                    {problem.line === undefined ? "" : `Line ${problem.line}: `}
                    {problem.message}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The Concept in review, as a form: every field the Creator may change, then approve or send back. */
function ConceptReview(props: { concept: Concept; busy: boolean; onSave: (concept: Concept) => void; onApprove: (concept: Concept) => void; onRedraft: (note: string) => void }) {
  const [concept, setConcept] = useState<Concept>(props.concept);
  const [note, setNote] = useState("");
  const set = (change: Partial<Concept>) => setConcept({ ...concept, ...change });
  const setPhase = (at: number, change: Partial<Concept["phases"][number]>) => set({ phases: concept.phases.map((phase, n) => (n === at ? { ...phase, ...change } : phase)) });
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

  function sendBack(event: FormEvent): void {
    event.preventDefault();
    props.onRedraft(note);
  }

  return (
    <section className="generation-concept">
      <h2>The Concept</h2>
      <form className="page-form" onSubmit={(event) => (event.preventDefault(), props.onApprove(concept))}>
        <label>
          Title
          <input value={concept.title} onChange={(event) => set({ title: event.target.value })} />
        </label>
        <label>
          What it is
          <textarea rows={3} value={concept.pitch} onChange={(event) => set({ pitch: event.target.value })} />
        </label>
        <div className="generation-players">
          <label>
            Fewest Players
            <input type="number" min={1} max={16} value={Number.isNaN(concept.players.min) ? "" : concept.players.min} onChange={(event) => set({ players: { ...concept.players, min: number(event.target.value) } })} />
          </label>
          <label>
            Most Players
            <input type="number" min={1} max={16} value={Number.isNaN(concept.players.max) ? "" : concept.players.max} onChange={(event) => set({ players: { ...concept.players, max: number(event.target.value) } })} />
          </label>
        </div>
        {concept.phases.map((phase, at) => (
          <fieldset key={phase.id} className="generation-phase">
            <legend>
              Phase {at + 1} ({phase.id})
            </legend>
            <label>
              Name
              <input value={phase.name} onChange={(event) => setPhase(at, { name: event.target.value })} />
            </label>
            <label>
              On the Screen
              <textarea rows={2} value={phase.screen} onChange={(event) => setPhase(at, { screen: event.target.value })} />
            </label>
            <label>
              On each phone
              <textarea rows={2} value={phase.phone} onChange={(event) => setPhase(at, { phone: event.target.value })} />
            </label>
            <label>
              What ends it
              <textarea rows={2} value={phase.ends} onChange={(event) => setPhase(at, { ends: event.target.value })} />
            </label>
          </fieldset>
        ))}
        <label>
          Scoring
          <select value={concept.scoring.kind} onChange={(event) => set({ scoring: { ...concept.scoring, kind: event.target.value as Concept["scoring"]["kind"] } })}>
            <option value="none">None</option>
            <option value="points">Points</option>
            <option value="winner">A winner</option>
          </select>
        </label>
        <label>
          How scoring works
          <textarea rows={2} value={concept.scoring.how} onChange={(event) => set({ scoring: { ...concept.scoring, how: event.target.value } })} />
        </label>
        <label>
          How long a Match takes
          <input value={concept.length} onChange={(event) => set({ length: event.target.value })} />
        </label>
        <p className="page-quiet">Its Look (colours, font and corners) stays as the AI chose it.</p>
        <div className="my-version-actions">
          <button type="submit" className="page-button" disabled={props.busy}>
            Approve and make the Game
          </button>
          <button type="button" className="page-button page-button-quiet" disabled={props.busy} onClick={() => props.onSave(concept)}>
            Save my changes
          </button>
        </div>
      </form>
      <form className="page-form" onSubmit={sendBack}>
        <label>
          Or ask the AI for a new draft: what should change?
          <textarea rows={3} maxLength={MAX_NOTE_CHARS} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button type="submit" className="page-button page-button-quiet" disabled={props.busy || note.trim() === ""}>
          Ask for a new draft
        </button>
      </form>
    </section>
  );
}
