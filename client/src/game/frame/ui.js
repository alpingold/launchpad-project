// party.ui: ready-made pieces for frame games (plan §13, F2): "the kit as a library".
//
// Like sdk.js, this runs INSIDE the game's sandboxed iframe, put in as text before the SDK.
// It only defines a factory; the SDK calls it with its own `party` and exposes the result
// as `party.ui`. Each helper draws into an element the game gives it, styled by base.css,
// and is plain DOM/canvas code: no libraries.
//
//   party.ui.el(tag, props, ...children)        build elements; children are TEXT, never HTML
//   party.ui.joystick(el, { onChange(x, y) })   thumb stick, -1..1 each (arrow keys/WASD too)
//   party.ui.gamepad(el, { dpad, buttons, onChange(state) })   hold buttons: left/right/jump…
//   party.ui.timer(el, { endsAt, onDone })      a bar counting down to a server time
//   party.ui.scoreboard(el, { title, me })      .update([{ id, name, score, color }])
//   party.ui.drawPad(el, { colors })            .strokes(), .clear(), .undo(), .setEnabled()
//   party.ui.drawing(el, strokes)               shows strokes from a drawPad
//   party.ui.countdown(el, { endsAt, onGo })    a big 3, 2, 1, GO! over everything
//
// Every helper takes an element or a CSS selector, and returns an object to control it.

window.__partyUi = function createPartyUi(party) {
  'use strict';

  /** An element from an element or a selector. */
  function mount(target, name) {
    const node = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(node instanceof Element)) throw new Error(`party.ui.${name}: no element ${JSON.stringify(String(target))}`);
    return node;
  }

  /**
   * Builds an element. props: class, style (object), on<Event> handlers, other attributes.
   * Children are elements or text; text is always text (a player's name can't become HTML).
   */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const ARROWS = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };

  // ---- Joystick -----------------------------------------------------------------------
  /**
   * A thumb stick. onChange(x, y) gets -1..1 each (length ≤ 1; y is down), rounded, at most
   * every `every` ms and only when it really moved, plus once on release (0, 0).
   * The stick starts where the thumb lands (players don't look at their phone), and a small
   * dead zone in the middle keeps a resting thumb from drifting.
   */
  function joystick(target, { onChange = () => {}, color, every = 80, keys = true, label = 'Joystick: drag to steer' } = {}) {
    const root = mount(target, 'joystick');
    const knob = el('div', { class: 'pu-knob' });
    const base = el('div', { class: 'pu-stick-base' }, knob);
    const pad = el('div', { class: 'pu-joystick', role: 'application', 'aria-label': label }, base);
    const DEAD = 0.15; // of the reach
    if (color) knob.style.background = color;
    root.append(pad);

    let value = { x: 0, y: 0 };
    let sent = { x: 0, y: 0 };
    let sentAt = 0;
    let dragging = null;
    let enabled = true;

    function send(force) {
      const atRest = value.x === 0 && value.y === 0;
      const moved = Math.abs(value.x - sent.x) > 0.04 || Math.abs(value.y - sent.y) > 0.04 || (atRest && (sent.x !== 0 || sent.y !== 0));
      if (!moved || (!force && Date.now() - sentAt < every)) return;
      sent = { x: round2(value.x), y: round2(value.y) };
      sentAt = Date.now();
      onChange(sent.x, sent.y);
    }
    const flusher = setInterval(() => send(false), every); // the last move of a quick flick

    function set(x, y, force) {
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      knob.style.transform = `translate(${x * 100}%, ${y * 100}%)`; // the knob follows the thumb, up to the ring
      // The dead zone: nothing near the middle, then the full range from its edge out.
      const l = Math.min(len, 1);
      const scale = l <= DEAD ? 0 : (l - DEAD) / (1 - DEAD) / l;
      value = { x: x * scale, y: y * scale };
      send(force);
    }
    let centre = null; // where the thumb landed, in page pixels
    function moveBase(x, y) {
      const rect = pad.getBoundingClientRect();
      base.style.left = `${x - rect.left}px`;
      base.style.top = `${y - rect.top}px`;
    }
    function fromPointer(event) {
      const reach = base.getBoundingClientRect().width / 2;
      set((event.clientX - centre.x) / reach, (event.clientY - centre.y) / reach, false);
    }
    pad.addEventListener('pointerdown', (event) => {
      if (!enabled) return;
      dragging = event.pointerId;
      pad.setPointerCapture(event.pointerId);
      // The stick starts here, but its ring stays inside the pad.
      const rect = pad.getBoundingClientRect();
      const r = base.getBoundingClientRect().width / 2;
      centre = {
        x: Math.min(Math.max(event.clientX, rect.left + r), rect.right - r),
        y: Math.min(Math.max(event.clientY, rect.top + r), rect.bottom - r),
      };
      moveBase(centre.x, centre.y);
      fromPointer(event);
    });
    pad.addEventListener('pointermove', (event) => {
      if (event.pointerId === dragging) fromPointer(event);
    });
    const release = (event) => {
      if (event.pointerId !== dragging) return;
      dragging = null;
      base.style.left = '';
      base.style.top = ''; // back to the middle
      set(0, 0, true);
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);

    const held = new Set();
    function fromKeys() {
      let x = 0;
      let y = 0;
      for (const dir of held) {
        if (dir === 'left') x -= 1;
        if (dir === 'right') x += 1;
        if (dir === 'up') y -= 1;
        if (dir === 'down') y += 1;
      }
      set(x, y, true);
    }
    function onKey(event) {
      const dir = ARROWS[event.key];
      if (!keys || !dir || !enabled) return;
      event.preventDefault();
      if (event.type === 'keydown' && !held.has(dir)) held.add(dir);
      else if (event.type === 'keyup') held.delete(dir);
      else return;
      fromKeys();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return {
      get value() {
        return { ...value };
      },
      setColor(c) {
        knob.style.background = c;
      },
      setEnabled(on) {
        enabled = Boolean(on);
        pad.classList.toggle('pu-off', !enabled);
        if (!enabled) {
          dragging = null;
          held.clear();
          set(0, 0, true);
        }
      },
      destroy() {
        clearInterval(flusher);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        pad.remove();
      },
    };
  }

  // ---- Gamepad: buttons you hold ---------------------------------------------------------
  /**
   * Arrow buttons and action buttons that count while held (several at once, multi-touch).
   * A finger can slide from one button to another without lifting (◀ to ▶): the one under it
   * counts, as on a real controller. Sliding off into a gap keeps the last one held.
   *   dpad: 'horizontal' (◀ ▶), 'full' (◀ ▶ ▲ ▼) or 'none'
   *   buttons: [{ id: 'jump', label: 'Jump', key: ' ' }]  (key: also works on a keyboard)
   * onChange(state, id) gets every control's state, e.g. { left: false, right: true, jump: false },
   * whenever one changes.
   */
  function gamepad(target, { dpad = 'horizontal', buttons = [], onChange = () => {}, keys = true } = {}) {
    const root = mount(target, 'gamepad');
    const state = {};
    const controls = [];
    const dirs = dpad === 'full' ? ['up', 'left', 'right', 'down'] : dpad === 'horizontal' ? ['left', 'right'] : [];
    const ARROW_TEXT = { left: '◀', right: '▶', up: '▲', down: '▼' };
    const FULL_SPOT = { up: '1 / 2', left: '2 / 1', right: '2 / 3', down: '3 / 2' }; // grid row / column

    let enabled = true;
    function press(id, down) {
      if (state[id] === down || (down && !enabled)) return;
      state[id] = down;
      const control = controls.find((c) => c.id === id);
      control?.node.classList.toggle('pu-down', down);
      onChange({ ...state }, id);
    }
    function holdButton(id, text, aria, cls) {
      const node = el('button', { class: `pu-hold ${cls ?? ''}`, 'aria-label': aria, type: 'button' }, text);
      state[id] = false;
      controls.push({ id, node, fingers: new Set() });
      return node;
    }

    const pad = el('div', { class: `pu-dpad ${dpad === 'horizontal' ? 'pu-horizontal' : ''}` });
    for (const dir of dirs) {
      const node = holdButton(dir, ARROW_TEXT[dir], dir[0].toUpperCase() + dir.slice(1), 'secondary');
      if (dpad === 'full') node.style.gridArea = `${FULL_SPOT[dir]}`;
      pad.append(node);
    }
    const actions = el('div', { class: 'pu-pad-buttons' });
    const keyFor = {};
    buttons.forEach((b, i) => {
      actions.append(holdButton(b.id, b.label ?? b.id, b.label ?? b.id));
      keyFor[b.key ?? (i === 0 ? ' ' : ['x', 'c', 'v'][i - 1])] = b.id;
    });
    const gp = el('div', { class: 'pu-gamepad' }, dirs.length ? pad : null, actions);
    root.append(gp);

    // Fingers are followed by the whole pad, not one button, so they can slide between buttons.
    const fingerOn = new Map(); // pointerId → the control it holds
    const controlAt = (x, y) => controls.find((c) => c.node === document.elementFromPoint(x, y)?.closest('.pu-hold')) ?? null;
    function hold(pointerId, control) {
      const was = fingerOn.get(pointerId) ?? null;
      if (was === control) return;
      if (was) {
        was.fingers.delete(pointerId);
        if (was.fingers.size === 0) press(was.id, false);
      }
      if (control) {
        fingerOn.set(pointerId, control);
        control.fingers.add(pointerId);
        press(control.id, true);
      } else fingerOn.delete(pointerId);
    }
    gp.addEventListener('pointerdown', (event) => {
      const control = controlAt(event.clientX, event.clientY);
      if (!control) return;
      event.preventDefault();
      gp.setPointerCapture(event.pointerId); // keep getting this finger's moves, wherever it goes
      hold(event.pointerId, control);
    });
    gp.addEventListener('pointermove', (event) => {
      if (fingerOn.has(event.pointerId)) hold(event.pointerId, controlAt(event.clientX, event.clientY) ?? fingerOn.get(event.pointerId));
    });
    const lift = (event) => hold(event.pointerId, null);
    gp.addEventListener('pointerup', lift);
    gp.addEventListener('pointercancel', lift);
    gp.addEventListener('contextmenu', (event) => event.preventDefault()); // long press on phones

    function onKey(event) {
      if (!keys) return;
      const dir = ARROWS[event.key];
      const id = dir && dirs.includes(dir) ? dir : keyFor[event.key] ?? keyFor[event.key.toLowerCase()];
      if (!id) return;
      event.preventDefault();
      if (event.repeat) return;
      press(id, event.type === 'keydown');
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return {
      get state() {
        return { ...state };
      },
      setEnabled(on) {
        enabled = Boolean(on);
        for (const c of controls) c.node.disabled = !enabled;
        if (!enabled) for (const id of Object.keys(state)) press(id, false);
      },
      destroy() {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        root.replaceChildren();
      },
    };
  }

  // ---- Timer -----------------------------------------------------------------------------
  /** A bar and seconds counting down to `endsAt` (SERVER time: party.now() + ms). */
  function timer(target, { endsAt, onDone, label = 'Time left' } = {}) {
    const root = mount(target, 'timer');
    const fill = el('div', { class: 'pu-timer-fill' });
    const seconds = el('span', { class: 'pu-timer-seconds' });
    const node = el('div', { class: 'pu-timer', role: 'timer', 'aria-label': label }, el('div', { class: 'pu-timer-track' }, fill), seconds);
    root.append(node);
    let end = endsAt;
    let total = Math.max(1, end - party.now());
    let done = false;
    let frame = 0;
    function tick() {
      const left = Math.max(0, end - party.now());
      fill.style.width = `${(left / total) * 100}%`;
      seconds.textContent = String(Math.ceil(left / 1000));
      node.classList.toggle('pu-low', left < 5000);
      if (left === 0 && !done) {
        done = true;
        onDone?.();
      }
      if (left > 0) frame = requestAnimationFrame(tick);
    }
    tick();
    return {
      set(newEndsAt) {
        cancelAnimationFrame(frame);
        end = newEndsAt;
        total = Math.max(1, end - party.now());
        done = false;
        tick();
      },
      stop() {
        cancelAnimationFrame(frame);
      },
      destroy() {
        cancelAnimationFrame(frame);
        node.remove();
      },
    };
  }

  // ---- Text input ------------------------------------------------------------------------
  /**
   * A box for typing an answer on a phone, with a Send button (plan §21). It avoids the usual
   * phone traps: text big enough that iPhones don't zoom in, Enter sends, the keyboard's key says
   * "send", the box scrolls into view above the keyboard, a character counter, and empty
   * answers are ignored.
   *   textInput(target, { placeholder, maxLength = 80, button = 'Send', multiline = false,
   *                       clearOnSubmit = true, lockOnSubmit = false, onSubmit(text) })
   * lockOnSubmit: after sending, the box locks with the text still in it and the button says
   * "Sent ✓", until the game draws its next screen (or calls setEnabled(true)). For a box that
   * another box follows (prompt 1 of 2, then 2 of 2): on a slow phone the next prompt takes a
   * moment to arrive, and without the lock an answer typed into the old box would be lost.
   * Returns { value, clear(), focus(), setEnabled(on), destroy() }.
   */
  function textInput(target, { placeholder = '', maxLength = 80, button = 'Send', multiline = false, clearOnSubmit = true, lockOnSubmit = false, onSubmit = () => {}, label = 'Your answer' } = {}) {
    const root = mount(target, 'textInput');
    const box = el(multiline ? 'textarea' : 'input', {
      class: 'pu-text',
      placeholder,
      maxlength: maxLength,
      'aria-label': label,
      autocomplete: 'off',
      autocapitalize: 'sentences',
      spellcheck: 'true',
      enterkeyhint: 'send',
      rows: multiline ? 3 : null,
    });
    const count = el('span', { class: 'pu-count', 'aria-hidden': 'true' }, `0/${maxLength}`);
    // Not a <form>: the game's sandbox blocks form submission, so Enter and Send are handled here.
    const send = el('button', { class: 'big', type: 'button' }, button);
    const wrap = el('div', { class: 'pu-text-form' }, box, el('div', { class: 'pu-text-row' }, count, send));
    root.append(wrap);
    let enabled = true;
    function submit() {
      const text = box.value.trim();
      if (!enabled || !text) return;
      onSubmit(text);
      if (lockOnSubmit) {
        setEnabled(false);
        send.textContent = 'Sent ✓';
        return; // the text stays, so the player sees what they sent
      }
      if (clearOnSubmit) {
        box.value = '';
        count.textContent = `0/${maxLength}`;
      }
    }
    box.addEventListener('input', () => (count.textContent = `${box.value.length}/${maxLength}`));
    box.addEventListener('focus', () => setTimeout(() => wrap.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)); // after the keyboard opens
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    send.addEventListener('click', submit);
    function setEnabled(on) {
      enabled = Boolean(on);
      box.disabled = !enabled;
      send.disabled = !enabled;
      if (enabled) send.textContent = button;
    }
    return {
      get value() {
        return box.value;
      },
      clear() {
        box.value = '';
        count.textContent = `0/${maxLength}`;
      },
      focus: () => box.focus(),
      setEnabled,
      destroy: () => wrap.remove(),
    };
  }

  // ---- Sound ------------------------------------------------------------------------------
  /**
   * Short sounds made in code (no files, plan §21): sound('win'). Names: tap, blip, tick, pop,
   * coin, go, buzz, win, lose. Or your own: sound({ notes: [440, 660], ms: 120, type: 'square' }).
   * Phones play once the player has tapped the game; the big screen may play from the start.
   * Returns false if sound isn't available here (it never throws).
   */
  const SOUNDS = {
    tap: { notes: [600], ms: 40, type: 'triangle' },
    blip: { notes: [880], ms: 80, type: 'sine' },
    tick: { notes: [1200], ms: 30, type: 'square', volume: 0.15 },
    pop: { notes: [300], slide: 900, ms: 90, type: 'sine' },
    coin: { notes: [988, 1319], ms: 90, type: 'square', volume: 0.2 },
    go: { notes: [660, 990], ms: 140, type: 'triangle' },
    buzz: { notes: [140], ms: 300, type: 'sawtooth', volume: 0.25 },
    win: { notes: [523, 659, 784, 1047], ms: 120, type: 'triangle' },
    lose: { notes: [400], slide: 160, ms: 450, type: 'sawtooth', volume: 0.2 },
  };
  let audio = null;
  function context() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio ??= new Ctx();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  }
  // Browsers only start sound after a tap or key inside the game: wake it on the first one.
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => context(), { capture: true, passive: true });
  function sound(what) {
    try {
      const spec = typeof what === 'string' ? SOUNDS[what] : what;
      const ctx = spec && context();
      if (!ctx) return false;
      const { notes = [440], ms = 100, type = 'sine', volume = 0.3, slide } = spec;
      let at = ctx.currentTime;
      for (const freq of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, at);
        if (slide) osc.frequency.exponentialRampToValueAtTime(slide, at + ms / 1000);
        gain.gain.setValueAtTime(Math.min(1, volume), at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + ms / 1000); // a soft end, no click
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + ms / 1000 + 0.02);
        at += ms / 1000;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ---- Drawing --------------------------------------------------------------------------
  // Drawings are strokes on a 1000 × 750 sheet: [[color, [x, y, x, y, ...]], ...], whole numbers.
  const PAPER_W = 1000;
  const PAPER_H = 750;
  const MAX_POINTS = 1500; // ≈ 15 KB as JSON: fits in one message
  const INK = {
    black: '#1a1a1a', white: '#ffffff', gray: '#8a8a8a', red: '#e53935', orange: '#fb8c00', yellow: '#fdd835',
    green: '#43a047', blue: '#1e88e5', purple: '#8e24aa', pink: '#ec407a', brown: '#6d4c41',
  };

  function paintStrokes(canvas, strokes) {
    const g = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 225;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform((w * dpr) / PAPER_W, 0, 0, (h * dpr) / PAPER_H, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, PAPER_W, PAPER_H);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 12;
    for (const [color, pts] of strokes) {
      if (!Array.isArray(pts) || pts.length < 2) continue;
      g.strokeStyle = INK[color] ?? INK.black;
      g.fillStyle = g.strokeStyle;
      if (pts.length === 2) {
        g.beginPath();
        g.arc(pts[0], pts[1], 6, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.stroke();
    }
  }

  /** Shows a drawing (strokes from a drawPad). Returns { show(strokes) }. */
  function drawing(target, strokes = [], { label = 'A drawing' } = {}) {
    const root = mount(target, 'drawing');
    const canvas = el('canvas', { class: 'pu-paper', role: 'img', 'aria-label': label });
    root.append(canvas);
    let current = strokes;
    const show = (s) => {
      current = Array.isArray(s) ? s : [];
      paintStrokes(canvas, current);
    };
    show(strokes);
    new ResizeObserver(() => paintStrokes(canvas, current)).observe(canvas);
    return { show, destroy: () => canvas.remove() };
  }

  /** A pad to draw on with a finger, with colours, undo and clear. */
  function drawPad(target, { colors = ['black', 'red', 'blue', 'green'], onChange } = {}) {
    const root = mount(target, 'drawPad');
    const canvas = el('canvas', { class: 'pu-paper', role: 'img', 'aria-label': 'Drawing pad' });
    let color = colors[0];
    let strokes = [];
    let current = null;
    let enabled = true;

    const swatches = colors.map((c) =>
      el('button', {
        class: `pu-swatch ${c === color ? 'pu-chosen' : ''}`,
        type: 'button',
        'aria-label': c,
        style: { background: INK[c] ?? c },
        onClick: () => {
          color = c;
          for (const s of swatches) s.classList.toggle('pu-chosen', s.getAttribute('aria-label') === c);
        },
      }),
    );
    const undo = el('button', { class: 'secondary', type: 'button', onClick: () => change(strokes.slice(0, -1)) }, 'Undo');
    const clear = el('button', { class: 'secondary', type: 'button', onClick: () => change([]) }, 'Clear');
    root.append(canvas, el('div', { class: 'pu-drawpad-tools' }, swatches, undo, clear));

    const points = () => strokes.reduce((n, [, pts]) => n + pts.length / 2, 0);
    function change(next) {
      strokes = next;
      paintStrokes(canvas, strokes);
      onChange?.(strokes);
    }
    function at(event) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((event.clientX - rect.left) / rect.width) * PAPER_W);
      const y = Math.round(((event.clientY - rect.top) / rect.height) * PAPER_H);
      return [Math.max(0, Math.min(PAPER_W, x)), Math.max(0, Math.min(PAPER_H, y))];
    }
    canvas.addEventListener('pointerdown', (event) => {
      if (!enabled || points() >= MAX_POINTS) return;
      canvas.setPointerCapture(event.pointerId);
      current = [color, at(event)];
      strokes = [...strokes, current];
      paintStrokes(canvas, strokes);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!current || points() >= MAX_POINTS) return;
      const [x, y] = at(event);
      const pts = current[1];
      if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) < 8) return; // skip tiny moves
      pts.push(x, y);
      paintStrokes(canvas, strokes);
    });
    const end = () => {
      if (!current) return;
      current = null;
      onChange?.(strokes);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    new ResizeObserver(() => paintStrokes(canvas, strokes)).observe(canvas);
    paintStrokes(canvas, strokes);

    return {
      strokes: () => strokes.map(([c, pts]) => [c, [...pts]]),
      clear: () => change([]),
      undo: () => change(strokes.slice(0, -1)),
      setEnabled(on) {
        enabled = Boolean(on);
        for (const b of [...swatches, undo, clear]) b.disabled = !enabled;
      },
      destroy: () => root.replaceChildren(),
    };
  }


  // ---- Countdown --------------------------------------------------------------------------
  /**
   * A big "3, 2, 1, GO!" over the element (or the whole page), counting down to `endsAt`
   * (SERVER time: party.now() + ms). It shows GO! for `goMs`, then removes itself.
   * onGo runs once, at zero. Returns { destroy() }.
   */
  function countdown(target = document.body, { endsAt, onGo, goText = 'GO!', goMs = 800 } = {}) {
    const root = mount(target, 'countdown');
    const node = el('div', { class: 'pu-countdown', role: 'status', 'aria-live': 'assertive' });
    root.append(node);
    let frame = 0;
    let wentAt = null;
    function tick() {
      const left = endsAt - party.now();
      if (left > 0) {
        node.textContent = String(Math.ceil(left / 1000));
      } else {
        if (wentAt === null) {
          wentAt = Date.now();
          node.textContent = goText;
          node.classList.add('pu-go');
          onGo?.();
        }
        if (Date.now() - wentAt >= goMs) {
          node.remove();
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    }
    tick();
    return {
      destroy() {
        cancelAnimationFrame(frame);
        node.remove();
      },
    };
  }

  return Object.freeze({ el, joystick, gamepad, timer, textInput, drawPad, drawing, countdown, sound, INK: Object.freeze({ ...INK }) });
};
