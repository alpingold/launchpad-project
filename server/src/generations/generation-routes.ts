/**
 * A Creator's Generations (BUILD-PLAN Step 33): start one from an idea, list theirs, see one with
 * its Track (every step and the problems each found), edit its Concept, ask for a new draft with a
 * note, approve it, cancel it. Each Creator sees only their own.
 *
 * With the AI maker off (no model, key secret or Playtest), every route refuses: the pages say the
 * maker isn't available yet.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Account } from "../db/accounts.js";
import type { Database } from "../db/database.js";
import { generationById, generationsOf, stepsOf, type Generation, type Step } from "../db/generations.js";
import { MAKER_OFF } from "./key-routes.js";
import { MAX_IDEA_CHARS, MAX_MODEL_CALLS, MAX_REQUEST_CHARS } from "./numbers.js";
import type { Pipeline } from "./pipeline.js";

export const GENERATIONS_PATH = "/api/my/generations";
/** Where a Creator asks the AI for a change to a Version of their Game: a Revision. */
export const REVISIONS_PATH = "/api/my/games/:id/revisions";
/** The most of an account's Generations listed. */
const MAX_LISTED = 50;

export interface GenerationRoutesOptions {
  readonly database: Database;
  /** Null when the AI maker is off. */
  readonly pipeline: Pipeline | null;
  readonly signedIn: (request: Request, response: Response) => Account | undefined;
}

/** A Generation as its Creator sees it: never the key, never the code (the Game's page shows that once it is made). */
export interface GenerationView {
  readonly id: string;
  /** A Generation (from an idea) or a Revision (a change to a Game). */
  readonly kind: Generation["kind"];
  readonly state: Generation["state"];
  /** The idea, or a Revision's request. */
  readonly idea: string;
  readonly concept: unknown;
  readonly reason: string | null;
  /** While GenAI Studio is busy or down: why, and until when (seconds since 1970). */
  readonly waiting: Generation["waiting"];
  /** 0 while the AI works on it; its place in the line from 1 while it waits; null otherwise. */
  readonly place: number | null;
  readonly builds: number;
  readonly modelCalls: number;
  /** How many more calls the AI may make for it (MAX_MODEL_CALLS in all): a redraft uses some. */
  readonly callsLeft: number;
  readonly gameId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Its Track: every step, with what each found. Only when one Generation is asked for. */
  readonly steps?: readonly Step[];
}

const ideaBody = z.object({ idea: z.string().max(MAX_IDEA_CHARS * 2) });
const noteBody = z.object({ note: z.string().trim().min(1).max(MAX_REQUEST_CHARS), concept: z.unknown().optional() });
const conceptBody = z.object({ concept: z.unknown() });
const approveBody = z.object({ concept: z.unknown().optional() });
const revisionBody = z.object({ versionId: z.string().max(100), request: z.string().max(MAX_REQUEST_CHARS * 2) });

/** A refusal; a Concept's problems are in its text as well as listed, so a page can show them as they come. */
function refused(response: Response, refusal: { readonly status: number; readonly error: string; readonly problems?: readonly string[] }): void {
  if (refusal.problems === undefined) return void response.status(refusal.status).json({ error: refusal.error });
  response.status(refusal.status).json({ error: `${refusal.error} ${refusal.problems.join(" ")}`, problems: refusal.problems });
}

export function generationRoutes(options: GenerationRoutesOptions): Router {
  const { database, pipeline } = options;
  const router = Router();

  /** The signed-in Creator, if the maker is on; otherwise the refusal is sent. */
  function creator(request: Request, response: Response): { readonly account: Account; readonly pipeline: Pipeline } | undefined {
    if (pipeline === null) return void response.status(503).json({ error: MAKER_OFF });
    const account = options.signedIn(request, response);
    if (account === undefined) return void response.status(401).json({ error: "Sign in first." });
    if (account.displayName === null) return void response.status(403).json({ error: "Pick a display name first." });
    return { account, pipeline };
  }

  function view(generation: Generation, maker: Pipeline, withSteps: boolean): GenerationView {
    return {
      id: generation.id,
      kind: generation.kind,
      state: generation.state,
      idea: generation.idea,
      concept: generation.concept,
      reason: generation.reason,
      waiting: generation.waiting,
      place: maker.place(generation.id) ?? null,
      builds: generation.builds,
      modelCalls: generation.modelCalls,
      callsLeft: Math.max(0, MAX_MODEL_CALLS - generation.modelCalls),
      gameId: generation.gameId,
      createdAt: generation.createdAt,
      updatedAt: generation.updatedAt,
      ...(withSteps ? { steps: stepsOf(database, generation.id) } : {}),
    };
  }

  /** The Creator's own Generation by the request's :id, or the 404 is sent. */
  function theirs(request: Request, response: Response, account: Account): Generation | undefined {
    const generation = generationById(database, String(request.params["id"]));
    if (generation?.accountId !== account.id) return void response.status(404).json({ error: "There is no such Generation." });
    return generation;
  }

  /** Sends the Generation as it now is. */
  function current(response: Response, id: string, maker: Pipeline, status = 200): void {
    const generation = generationById(database, id);
    if (generation === undefined) return void response.status(404).json({ error: "There is no such Generation." });
    response.status(status).json(view(generation, maker, true));
  }

  router.get(GENERATIONS_PATH, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    response.setHeader("Cache-Control", "no-store");
    response.json(generationsOf(database, signed.account.id).slice(0, MAX_LISTED).map((generation) => view(generation, signed.pipeline, false)));
  });

  router.post(GENERATIONS_PATH, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const body = ideaBody.safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: `Describe your idea in 1 to ${MAX_IDEA_CHARS} characters.` });
    const started = signed.pipeline.start(signed.account.id, body.data.idea);
    if (!started.ok) return void response.status(started.status).json({ error: started.error });
    current(response, started.generation.id, signed.pipeline, 201);
  });

  router.post(REVISIONS_PATH, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const body = revisionBody.safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: `Say which Version, and what to change in 1 to ${MAX_REQUEST_CHARS} characters.` });
    const revised = signed.pipeline.revise(signed.account.id, String(request.params["id"]), body.data.versionId, body.data.request);
    if (!revised.ok) return void response.status(revised.status).json({ error: revised.error });
    current(response, revised.generation.id, signed.pipeline, 201);
  });

  router.get(`${GENERATIONS_PATH}/:id`, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const generation = theirs(request, response, signed.account);
    if (generation === undefined) return;
    response.setHeader("Cache-Control", "no-store");
    response.json(view(generation, signed.pipeline, true));
  });

  router.put(`${GENERATIONS_PATH}/:id/concept`, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const generation = theirs(request, response, signed.account);
    if (generation === undefined) return;
    const body = conceptBody.safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "Send the Concept." });
    const edited = signed.pipeline.editConcept(signed.account.id, generation.id, body.data.concept);
    if (!edited.ok) return void refused(response, edited);
    current(response, generation.id, signed.pipeline);
  });

  router.post(`${GENERATIONS_PATH}/:id/redraft`, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const generation = theirs(request, response, signed.account);
    if (generation === undefined) return;
    const body = noteBody.safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: `Say what to change, in 1 to ${MAX_REQUEST_CHARS} characters.` });
    const redrafted = signed.pipeline.redraft(signed.account.id, generation.id, body.data.note, body.data.concept);
    if (!redrafted.ok) return void refused(response, redrafted);
    current(response, generation.id, signed.pipeline);
  });

  router.post(`${GENERATIONS_PATH}/:id/approve`, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const generation = theirs(request, response, signed.account);
    if (generation === undefined) return;
    const body = approveBody.safeParse(request.body);
    if (!body.success) return void response.status(400).json({ error: "That request couldn't be read." });
    const approved = signed.pipeline.approve(signed.account.id, generation.id, body.data.concept);
    if (!approved.ok) return void refused(response, approved);
    current(response, generation.id, signed.pipeline);
  });

  router.post(`${GENERATIONS_PATH}/:id/cancel`, (request, response) => {
    const signed = creator(request, response);
    if (signed === undefined) return;
    const generation = theirs(request, response, signed.account);
    if (generation === undefined) return;
    if (!signed.pipeline.cancel(signed.account.id, generation.id)) return void response.status(409).json({ error: "This Generation is already over." });
    current(response, generation.id, signed.pipeline);
  });

  return router;
}
