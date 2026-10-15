// THE BROWSER PLAYTEST (plan §13i, F4): plays a frame game for a while in a headless
// Chromium, with simulated phones, and reports what went wrong.
//
//   Node (this file)                         Chromium: one page per screen
//   ───────────────                          ──────────────────────────────
//   the server's own FrameRelay  ◀──binding── harness page ◀─postMessage─ game iframe
//   (checks sizes, targets,      ──evaluate─▶ harness page ──postMessage─▶ (sandbox + CSP,
//    results, like in a room)                                               exactly as on the site)
//
// Each screen gets the same document the site builds (client/src/game/frame/template.js),
// in an iframe with the same sandbox. Nothing here talks to a real server or the internet:
// every request is answered from this machine or refused, and recorded.
//
// What it finds:
//  - errors the game throws (with the line in the game file), and errors the SDK caught
//  - the browser's CSP violation reports: the game TRIED to load or connect to something
//  - requests that got past the CSP (they're refused here, and reported)
//  - the frame loading another page (a link, location = …)
//  - a big screen that stops ticking (an endless loop), a blank screen, phones that never
//    hear from the big screen, messages the server would refuse, bad results in party.end
// While it plays: bots tap buttons, drag and hold (joysticks, drawing pads), type in text
// boxes and press keys. One phone reloads and the big screen reloads (with its last
// party.save), as happens at real parties.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FrameRelay } from '../../../server/src/games/FrameRelay.js';
import { parseClientMessage } from '../../../server/src/protocol/validate.js';
import { ERRORS } from '../../../server/src/protocol/errors.js';
import { config } from '../../../server/src/config.js';
import { frameDocumentFrom } from '../../../client/src/game/frame/template.js';

const ORIGIN = 'http://boilergames.test'; // never resolved: every request is answered by route()
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FRAME_DIR = path.join(REPO, 'client/src/game/frame');
const ASSETS_DIR = path.join(REPO, 'client/public/game-assets');

const HOST_VIEWPORT = { width: 1280, height: 720 };
const PHONE_VIEWPORT = { width: 390, height: 780 };
const HOST_MESSAGE_MAX_BYTES = 120 * 1024; // as GameFrame.jsx
const RATE_PER_SEC = config.RATE_LIMIT_PER_SEC;
const RATE_BURST = config.RATE_LIMIT_BURST;
const HANG_MS = 5000; // the big screen ticks every second; 5 s of silence means it's stuck
const LOAD_TIMEOUT_MS = 8000;
const FIRST_WORD_MS = 6000; // phones should hear from the big screen by then

/** The page around each game iframe: what GameFrame.jsx does, minus React and the socket. */
const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>harness</title>
<style>html, body { margin: 0; height: 100%; } iframe { border: 0; display: block; width: 100%; height: 100%; }</style>
</head><body><script>
  let frame = null;
  window.addEventListener('message', (e) => {
    if (frame && e.source === frame.contentWindow) window.__harness('fromGame', e.data);
  });
  window.__start = (srcdoc) => {
    frame = document.createElement('iframe');
    frame.title = 'Game';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = srcdoc;
    let loads = 0;
    frame.addEventListener('load', () => { if (++loads > 1) window.__harness('navigated', null); });
    document.body.append(frame);
  };
  window.__toGame = (msg) => frame && frame.contentWindow.postMessage(msg, '*');
</script></body></html>`;

/** Runs in every frame before its own scripts; in the game's frame it reports CSP violations. */
const INIT_SCRIPT = `(() => {
  if (window === window.top) return;
  document.addEventListener('securitypolicyviolation', (e) => {
    try {
      window.__report('csp', { directive: e.effectiveDirective, blocked: e.blockedURI, line: e.lineNumber, sample: e.sample });
    } catch {}
  });
})();`;

/**
 * One simulated screen: the big screen or a phone, each its own browser page.
 * @typedef {Object} Screen
 * @property {string} key                  'host' or the player's id
 * @property {'host' | 'player'} role
 * @property {string | null} me            the player's id (null on the big screen)
 * @property {string} label                'big screen' or 'phone 2', for findings
 * @property {import('playwright-core').Page} page
 * @property {boolean} ready               the SDK has loaded and got its 'init'
 * @property {object[]} queue              messages for the game, held until it's ready
 * @property {boolean} connected           false while this phone "reloads"
 * @property {unknown} restored            the big screen's last save, given back after a reload
 * @property {number | null} heardAt       when this phone first heard from the big screen
 * @property {number | null} loadedAt
 * @property {number} tokens               the rate limit's token bucket, as GameFrame.jsx
 * @property {number} refilledAt
 */

/**
 * @typedef {Object} PlaytestFinding
 * @property {string} rule     csp | error | network | navigation | hang | blank | silent | refused | results | load
 * @property {string} message
 * @property {string} [screen] where it happened: 'big screen', 'phone 2', or several ('big screen, phone 1')
 * @property {number} [line]   in the game file
 * @property {string} [code]   that line
 * @property {number} [count]  how many times it happened (repeats are merged)
 */

/**
 * @param {string} source  the game file (already known to have valid game info)
 * @param {Object} [opts]
 * @param {number} [opts.players]   simulated phones (default 3, kept within the game's limits)
 * @param {number} [opts.seconds]   how long to play (default 20)
 * @param {number} [opts.seed]      for the bots' choices
 * @param {{ minPlayers: number, maxPlayers: number }} [opts.limits]
 * @param {boolean} [opts.headed]   show the browser windows (for watching locally)
 * @param {(text: string) => void} [opts.onStep]
 * @param {() => Promise<import('playwright-core').Browser>} [opts.launch]  tests may pass their own
 * @returns {Promise<{ problems: PlaytestFinding[], warnings: PlaytestFinding[], summary: import('../../../server/src/games/frameGame.js').PlaytestSummary, screenshots: { host?: Buffer, phone?: Buffer } }>}
 */
export async function playtest(source, opts = {}) {
  const seconds = opts.seconds ?? 20;
  const limits = opts.limits ?? { minPlayers: 1, maxPlayers: 12 };
  const playerCount = Math.min(limits.maxPlayers, Math.max(limits.minPlayers, opts.players ?? 3));
  const onStep = opts.onStep ?? (() => {});
  const random = mulberry32(opts.seed ?? 1);

  const findings = new Findings();
  const parts = {
    style: readFileSync(path.join(FRAME_DIR, 'base.css'), 'utf8'),
    ui: readFileSync(path.join(FRAME_DIR, 'ui.js'), 'utf8'),
    kit: readFileSync(path.join(FRAME_DIR, 'kit.js'), 'utf8'),
    sdk: readFileSync(path.join(FRAME_DIR, 'sdk.js'), 'utf8'),
  };
  const srcdoc = frameDocumentFrom(parts, source, ORIGIN);
  // Lines in the frame's document → lines in the game file.
  const marker = '\u0000GAME\u0000';
  const linesBeforeGame = frameDocumentFrom(parts, marker, ORIGIN).split(marker)[0].split('\n').length - 1;
  const sourceLines = source.split('\n');
  const gameLine = (docLine) => {
    const line = docLine - linesBeforeGame;
    return line >= 1 && line <= sourceLines.length ? { line, code: sourceLines[line - 1].trim().slice(0, 160) } : {};
  };
  const assets = readAssets();

  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p_bot${i + 1}`, name: BOT_NAMES[i] }));
  /** @type {Map<string, Screen>} 'host' and player ids */
  const screens = new Map();
  const summary = { players: playerCount, seconds, eventsFromPhones: 0, updatesToPhones: 0, saves: 0, ended: false, results: null, endedAfterSeconds: null, reloads: [] };
  /** @type {{ host?: Buffer, phone?: Buffer }} JPEGs of the big screen and the first phone */
  const shots = {};
  const startedAt = Date.now();
  let lastAlive = 0;
  let stopping = false;
  let stopWatchdog = () => {};
  let hung = false;

  const relay = new FrameRelay({
    game: { id: 'game', name: 'game', description: '', minPlayers: 1, maxPlayers: 12, source }, // only the source is used here
    players,
    deliver: (target, msg) => {
      const screen = target.to === 'host' ? screens.get('host') : screens.get(target.playerId);
      if (!screen) return;
      if (msg.type === 'game:event') toGame(screen, { type: 'event', from: msg.from, data: msg.data, clockOffset: 0 });
      else if (msg.type === 'game:message') toGame(screen, { type: 'message', data: msg.data, clockOffset: 0 });
      else if (msg.type === 'game:state') toGame(screen, { type: 'state', state: msg.state, clockOffset: 0 });
      if (target.to === 'player') {
        summary.updatesToPhones += 1;
        screen.heardAt ??= Date.now();
      }
    },
    onEnd: (results) => {
      summary.ended = true;
      summary.results = results;
      summary.endedAfterSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
    },
  });

  function toGame(screen, msg) {
    if (!screen.ready) {
      screen.queue.push(msg);
      return;
    }
    screen.page.evaluate((m) => window.__toGame(m), msg).catch(() => {});
  }

  /** A message the game posted to its page: checked as GameFrame and the server would. */
  function fromGame(screen, msg) {
    if (msg === null || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type === 'loaded') {
      const restored = screen.role === 'host' ? screen.restored : undefined;
      const init = { type: 'init', role: screen.role, me: screen.me, players: playerList(), theme: 'light', assets, restored, clockOffset: 0 };
      screen.page.evaluate((m) => window.__toGame(m), init).catch(() => {});
      screen.ready = true;
      screen.loadedAt = Date.now();
      for (const queued of screen.queue.splice(0)) toGame(screen, queued);
      if (screen.role === 'player') relay.replayState(screen.me); // a phone that (re)loaded gets its state
      if (screen.role === 'host') lastAlive = Date.now();
      return;
    }
    if (msg.type === 'alive') {
      if (screen.role === 'host') lastAlive = Date.now();
      return;
    }
    if (summary.ended) return;

    let out = null;
    if (screen.role === 'player' && msg.type === 'send') out = { type: 'game:event', data: msg.data };
    else if (screen.role === 'host' && msg.type === 'batch') out = { type: 'game:batch', items: msg.items, ...('save' in msg ? { save: msg.save } : {}) };
    else if (screen.role === 'host' && msg.type === 'end') out = { type: 'game:end', rankings: msg.results?.rankings, scores: msg.results?.scores };
    if (!out) return refuse(screen, 'refused', `The game posted a "${msg.type}" message, which isn't allowed on the ${screen.role === 'host' ? 'big screen' : 'phone'}. Use the party SDK.`);

    const json = JSON.stringify(out) ?? '';
    const limit = screen.role === 'host' ? HOST_MESSAGE_MAX_BYTES : config.GAME_EVENT_MAX_BYTES;
    if (msg.type === 'send' && msg.data === undefined) return refuse(screen, 'refused', 'party.send needs a JSON value.');
    if (Buffer.byteLength(json) > limit) return refuse(screen, 'refused', `A ${msg.type} message is too big (the limit is ${limit} bytes).`);
    if (!takeToken(screen)) {
      findings.warn({ rule: 'rate', screen: screen.label, message: `Sent more than ${RATE_PER_SEC} messages a second; the extra ones are dropped. Send only when something changes.` });
      return toGame(screen, { type: 'refused', reason: 'too many messages' });
    }
    const parsed = parseClientMessage(json);
    if (!parsed.ok) {
      const field = parsed.field ? ` (${parsed.field})` : '';
      return refuse(screen, msg.type === 'end' ? 'results' : 'refused', `The server would refuse this ${msg.type} message${field}: ${ERRORS[parsed.code] ?? parsed.code}`);
    }
    try {
      if (msg.type === 'send') {
        summary.eventsFromPhones += 1;
        relay.playerEvent(screen.me, parsed.msg.data);
      } else if (msg.type === 'batch') {
        if ('save' in parsed.msg) summary.saves += 1;
        relay.hostBatch(parsed.msg.items, parsed.msg.save);
      } else {
        relay.hostEnd({ rankings: parsed.msg.rankings, scores: parsed.msg.scores });
        onStep(`the game ended after ${summary.endedAfterSeconds} s`);
      }
    } catch (err) {
      const text = ERRORS[err.code] ?? err.message;
      refuse(screen, msg.type === 'end' ? 'results' : 'refused', `The server refused a ${msg.type === 'end' ? 'party.end' : msg.type} message: ${text}`);
    }
  }

  function refuse(screen, rule, message) {
    findings.add({ rule, screen: screen.label, message });
    toGame(screen, { type: 'refused', reason: message });
  }

  function takeToken(screen) {
    const now = Date.now();
    screen.tokens = Math.min(RATE_BURST, screen.tokens + ((now - screen.refilledAt) / 1000) * RATE_PER_SEC);
    screen.refilledAt = now;
    if (screen.tokens < 1) return false;
    screen.tokens -= 1;
    return true;
  }

  function playerList() {
    return players.map((p) => ({ id: p.id, name: p.name, connected: screens.get(p.id)?.connected !== false }));
  }

  // --- The browser ----------------------------------------------------------------------
  const browser = await (opts.launch ? opts.launch() : launchChromium(opts.headed));
  const context = await browser.newContext();
  await context.addInitScript(INIT_SCRIPT);
  await context.exposeBinding('__harness', ({ page }, kind, data) => {
    const screen = [...screens.values()].find((s) => s.page === page);
    if (!screen || stopping) return;
    if (kind === 'fromGame') fromGame(screen, data);
    else if (kind === 'navigated') {
      findings.add({ rule: 'navigation', screen: screen.label, message: 'The game loaded another page into its frame (a link, a form, or `location`). On the site this ends the game.' });
    }
  });
  await context.exposeBinding('__report', ({ page }, kind, data) => {
    const screen = [...screens.values()].find((s) => s.page === page);
    if (!screen || kind !== 'csp' || typeof data !== 'object' || data === null) return;
    const what = String(data.blocked || data.directive);
    findings.add({
      rule: 'csp',
      screen: screen.label,
      message: `Tried to use something games can't (${describeCsp(String(data.directive), what)}); the browser blocked it.`,
      ...gameLine(Number(data.line)),
    });
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/harness.html`) return route.fulfill({ contentType: 'text/html', body: HARNESS_HTML });
    if (url.startsWith(`${ORIGIN}/game-assets/`)) {
      const file = path.join(ASSETS_DIR, path.basename(new URL(url).pathname));
      return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    const screen = [...screens.values()].find((s) => s.page === route.request().frame()?.page());
    findings.add({ rule: 'network', screen: screen?.label, message: `Tried to load ${shortUrl(url)}; games have no network.` });
    return route.abort();
  });

  async function openScreen(key, role, me, label, viewport) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    /** @type {Screen} */
    const screen = { key, role, me, label, page, ready: false, queue: [], connected: true, restored: undefined, heardAt: null, loadedAt: null, tokens: RATE_BURST, refilledAt: Date.now() };
    screens.set(key, screen);
    page.on('pageerror', (error) => {
      if (stopping) return;
      const at = /about:srcdoc:(\d+):\d+/.exec(error.stack ?? '');
      findings.add({ rule: 'error', screen: screen.label, message: `The game threw: ${error.message}`, ...(at ? gameLine(Number(at[1])) : {}) });
    });
    page.on('console', async (msg) => {
      if (stopping || msg.type() !== 'error' || !msg.text().startsWith('[party]')) return;
      // The SDK caught an error in one of the game's callbacks, or dropped a message.
      let stack = '';
      try {
        stack = (await msg.args()[1]?.evaluate((e) => (e instanceof Error ? `${e.message}\n${e.stack}` : String(e)))) ?? '';
      } catch {}
      const at = /about:srcdoc:(\d+):\d+/.exec(stack);
      const message = stack ? `The game threw: ${stack.split('\n')[0]}` : msg.text().replace(/^\[party\]\s*/, '');
      findings.add({ rule: 'error', screen: screen.label, message, ...(at ? gameLine(Number(at[1])) : {}) });
    });
    await load(screen);
    return screen;
  }

  async function load(screen) {
    screen.ready = false;
    screen.queue = [];
    await screen.page.goto(`${ORIGIN}/harness.html`, { timeout: LOAD_TIMEOUT_MS });
    await withTimeout(screen.page.evaluate((doc) => window.__start(doc), srcdoc), LOAD_TIMEOUT_MS);
  }

  /** The game's frame on a screen (the harness page's only child frame). */
  const gameFrame = (screen) => screen.page.frames().find((f) => f !== screen.page.mainFrame());

  try {
    onStep(`playtest: opening the big screen and ${playerCount} phone${playerCount === 1 ? '' : 's'}`);
    await openScreen('host', 'host', null, 'big screen', HOST_VIEWPORT);
    for (const [i, p] of players.entries()) await openScreen(p.id, 'player', p.id, `phone ${i + 1}`, PHONE_VIEWPORT);

    // 1. Everyone loads.
    const loaded = await until(() => [...screens.values()].every((s) => s.ready), LOAD_TIMEOUT_MS);
    if (!loaded) {
      for (const s of screens.values()) {
        if (!s.ready) findings.add({ rule: 'load', screen: s.label, message: 'The game never started: the party SDK never loaded (is the page broken before the game\'s scripts?).' });
      }
    }

    // 2. Play: bots on every phone, with a phone reload and a big-screen reload along the way.
    const endAt = startedAt + seconds * 1000;
    const timeline = [
      { at: 0.35, run: () => reloadPhone() },
      { at: 0.5, run: () => takeShots() },
      { at: 0.6, run: () => reloadHost() },
    ];
    // The hang watchdog runs on its own timer: steps below may wait on a frozen page (other
    // pages can share its process), and must not keep it from noticing.
    const watchdog = setInterval(() => {
      if (hung || !lastAlive || !screens.get('host').ready || Date.now() - lastAlive <= HANG_MS) return;
      hung = true;
      findings.add({ rule: 'hang', screen: 'big screen', message: `The big screen stopped responding for ${HANG_MS / 1000} s (an endless loop?). On the site, the game is stopped and the big screen's tab freezes.` });
    }, 250);
    stopWatchdog = () => clearInterval(watchdog);
    const bots = [...screens.values()].filter((s) => s.role === 'player').map((s) => runBot(s));
    let checkedFirstWord = false;
    let checkedBlank = false;
    while (Date.now() < endAt && !summary.ended && !hung) {
      await sleep(200);
      const elapsed = (Date.now() - startedAt) / (seconds * 1000);
      while (timeline.length && elapsed >= timeline[0].at && !hung) await timeline.shift().run();
      if (!checkedFirstWord && Date.now() - startedAt > FIRST_WORD_MS) {
        checkedFirstWord = true;
        for (const s of screens.values()) {
          if (s.role === 'player' && !s.heardAt) {
            findings.warn({ rule: 'silent', screen: s.label, message: `Heard nothing from the big screen in the first ${FIRST_WORD_MS / 1000} s. Give every phone a party.setState right away, so it shows what to do (and gets it back after a reload).` });
          }
        }
      }
      if (!checkedBlank && Date.now() - startedAt > 4000) {
        checkedBlank = true;
        await checkBlank();
      }
    }
    if (summary.ended) await takeShots(); // the end screen (unless taken already)
    else if (!hung) await takeShots();
    stopping = true;
    await Promise.race([Promise.allSettled(bots), sleep(2000)]);
    if (!summary.ended && !hung) onStep(`playtest: still running after ${seconds} s (fine for long games)`);
  } finally {
    stopWatchdog();
    stopping = true;
    relay.dispose();
    // A hung page can't be closed politely: give it a moment, then kill the browser.
    await Promise.race([browser.close(), sleep(5000)]);
  }

  if (summary.saves === 0 && !hung) {
    findings.warn({ rule: 'save', screen: 'big screen', message: 'The game never called party.save, so a big-screen reload starts it over.' });
  }
  summary.screensLoaded = [...screens.values()].filter((s) => s.loadedAt).length;
  return { problems: findings.problems, warnings: findings.warnings, summary, screenshots: shots };

  // --- During the game --------------------------------------------------------------------

  async function reloadPhone() {
    const screen = screens.get(players.at(-1).id);
    if (!screen || summary.ended || hung) return;
    onStep(`playtest: ${screen.label} reloads`);
    screen.connected = false;
    toGame(screens.get('host'), { type: 'players', players: playerList() });
    await sleep(500);
    await load(screen).catch(() => {});
    screen.connected = true;
    await until(() => screen.ready, LOAD_TIMEOUT_MS);
    toGame(screens.get('host'), { type: 'players', players: playerList() });
    summary.reloads.push(screen.label);
  }

  async function reloadHost() {
    const host = screens.get('host');
    if (summary.ended || hung) return;
    onStep(`playtest: the big screen reloads${relay.snapshot === undefined ? ' (the game never saved, so it starts over)' : ' (with its last party.save)'}`);
    host.restored = relay.snapshot;
    await load(host).catch(() => {});
    if (!(await until(() => host.ready, LOAD_TIMEOUT_MS))) return;
    lastAlive = Date.now();
    summary.reloads.push('big screen');
  }

  async function checkBlank() {
    for (const screen of screens.values()) {
      const frame = gameFrame(screen);
      if (!frame || !screen.ready) continue;
      const drawn = await withTimeout(frame.evaluate(drawsSomething), 2000).catch(() => true);
      if (!drawn) findings.add({ rule: 'blank', screen: screen.label, message: 'The screen is blank: no text, no picture, nothing drawn on a canvas.' });
    }
  }

  async function takeShots() {
    if (shots.host || hung) return;
    onStep('playtest: taking screenshots');
    const host = screens.get('host');
    const phone = screens.get(players[0].id);
    shots.host = await withTimeout(host.page.screenshot({ type: 'jpeg', quality: 70 }), 4000).catch(() => undefined);
    shots.phone = await withTimeout(phone.page.screenshot({ type: 'jpeg', quality: 70 }), 4000).catch(() => undefined);
  }

  /** One phone's bot: every 0.25–0.6 s, does something a player might. */
  async function runBot(screen) {
    while (!stopping && !summary.ended && !hung) {
      await sleep(250 + random() * 350);
      if (stopping || !screen.ready) continue;
      const frame = gameFrame(screen);
      if (!frame) continue;
      try {
        await withTimeout(botAction(screen, frame, random()), 3000);
      } catch {
        // Elements come and go while the game plays; a missed tap is fine.
      }
    }
  }

  async function botAction(screen, frame, roll) {
    const { page } = screen;
    const box = PHONE_VIEWPORT;
    if (roll < 0.55) {
      const buttons = frame.locator('button:not([disabled]):visible, [role=button]:visible, input[type=button]:visible, input[type=submit]:visible, select:visible');
      const count = await buttons.count();
      if (count > 0) {
        const target = buttons.nth(Math.floor(random() * count));
        if ((await target.evaluate((el) => el.tagName)) === 'SELECT') {
          const options = await target.locator('option').count();
          if (options > 0) await target.selectOption({ index: Math.floor(random() * options) });
        } else await target.click({ timeout: 1000 });
        return;
      }
    }
    if (roll < 0.65) {
      const inputs = frame.locator('input[type=text]:visible, input:not([type]):visible, textarea:visible');
      const count = await inputs.count();
      if (count > 0) {
        await inputs.nth(Math.floor(random() * count)).fill(WORDS[Math.floor(random() * WORDS.length)], { timeout: 1000 });
        await page.keyboard.press('Enter');
        return;
      }
    }
    if (roll < 0.92) {
      // Press, drag and let go somewhere: joysticks, drawing pads, hold-to-move buttons.
      const x = 20 + random() * (box.width - 40);
      const y = box.height * 0.3 + random() * box.height * 0.65;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 0; i < 4; i++) {
        await page.mouse.move(x + (random() - 0.5) * 120, y + (random() - 0.5) * 120, { steps: 3 });
        await sleep(60);
      }
      await page.mouse.up();
      return;
    }
    await page.keyboard.press(KEYS[Math.floor(random() * KEYS.length)]);
  }
}

/** Runs inside a game frame: is anything on screen? */
function drawsSomething() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  if ((document.body.innerText || '').trim().length > 0) return true;
  for (const el of document.querySelectorAll('img, svg, video, button')) if (visible(el)) return true;
  for (const canvas of document.querySelectorAll('canvas')) {
    if (!visible(canvas) || canvas.width === 0 || canvas.height === 0) continue;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return true; // WebGL: assume it draws
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 4; i < data.length; i += 4 * 97) {
        if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2] || data[i + 3] !== data[3]) return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

/** Repeated findings are merged, with a count. */
class Findings {
  constructor() {
    this.problems = [];
    this.warnings = [];
  }
  add(f) {
    this.#push(this.problems, f);
  }
  warn(f) {
    this.#push(this.warnings, f);
  }
  /** The same finding on several screens becomes one, naming them all. */
  #push(list, f) {
    const same = list.find((x) => x.rule === f.rule && x.message === f.message && x.line === f.line);
    if (!same) {
      if (list.length < 30) list.push(Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));
      return;
    }
    same.count = (same.count ?? 1) + 1;
    if (f.screen && !(same.screen ?? '').split(', ').includes(f.screen)) {
      same.screen = same.screen ? `${same.screen}, ${f.screen}` : f.screen;
    }
  }
}

async function launchChromium(headed) {
  // In the sandbox image the browser lives in /app/ms-playwright (generator/Dockerfile).
  // `openshell sandbox exec` doesn't pass the image's environment on, so look for it here.
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/app/ms-playwright')) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/app/ms-playwright';
  }
  const { chromium } = await import('playwright-core');
  // /dev/shm is small (or missing) in containers: Chromium uses /tmp instead.
  // The OpenShell sandbox forbids user namespaces, which Chromium's process launcher (the
  // "zygote") and GPU process need: without them it crashes on the first page. So no
  // zygote (pages still get their own processes) and no GPU. Chromium's own sandbox is off,
  // as Playwright always does; the OpenShell sandbox is the wall around all of it.
  return chromium.launch({ headless: !headed, args: ['--disable-dev-shm-usage', '--no-zygote', '--disable-gpu'] });
}

function readAssets() {
  try {
    const manifest = JSON.parse(readFileSync(path.join(ASSETS_DIR, 'manifest.json'), 'utf8'));
    const list = Array.isArray(manifest) ? manifest : (manifest.assets ?? []);
    return Object.fromEntries(list.map((a) => [a.id, `${ORIGIN}/game-assets/${a.file}`]));
  } catch {
    return {};
  }
}

function describeCsp(directive, blocked) {
  const where = blocked === 'inline' || blocked === 'eval' ? blocked : shortUrl(blocked);
  const kinds = {
    'connect-src': 'a network connection to',
    'script-src-elem': 'a script from',
    'script-src': where === 'eval' ? 'code from text (eval) in' : 'a script from',
    'style-src-elem': 'a stylesheet from',
    'img-src': 'a picture from',
    'font-src': 'a font from',
    'media-src': 'a sound or video from',
    'frame-src': 'a frame showing',
    'worker-src': 'a worker from',
    'form-action': 'a form sending to',
  };
  return `${kinds[directive] ?? `${directive}:`} ${where}`;
}

function shortUrl(url) {
  return url.length > 80 ? `${url.slice(0, 77)}…` : url;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

function withTimeout(promise, ms) {
  return Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error('timeout')))]);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOT_NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu'];
const WORDS = ['banana', 'robot', 'purple', 'yes', 'pizza party', 'zzz'];
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter'];
