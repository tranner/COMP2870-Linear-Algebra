/*
 * RevealAnnotate: Apple Pencil annotation for reveal.js slides.
 *
 * - Only the pencil (pointerType "pen") draws; fingers keep navigating.
 * - Slides with class `.write` (e.g. `### Matrices {.write}`) get a light
 *   square grid; the toolbar can insert blank grid slides after any slide.
 * - The toolbar starts folded to one small pen button in the corner.
 * - Works with other pens too (Android, Windows, Wacom): their eraser end or
 *   side button erases while held, and a "draw with touch" toggle covers
 *   basic rubber-tip styluses, which look like fingers to the browser.
 * - Toolbar: colours, pen widths, highlighter, stroke eraser, undo/redo,
 *   clear slide, add/delete blank slide, clear everything.
 * - Scribble over existing ink to erase it.
 * - Ink and inserted slides are kept in localStorage, per deck.
 * - Add `?annotate-debug` to the URL for a live readout of pencil data.
 *
 * Strokes are stored in slide coordinates (the reveal canvas, 1050 x 700 here)
 * so they scale with the presentation.
 */
window.RevealAnnotate = function () {
  "use strict";

  const DEFAULTS = {
    gridSize: 50,
    gridColor: "rgba(26, 26, 26, 0.05)",
    gridBackground: "#FBF8F0",
    colors: ["auto", "#004C77", "#793600", "#00543D", "#782E57"],
    autoLight: "#1A1A1A",
    autoDark: "#FBF8F0",
    widths: [2, 3.5, 6],
    highlighterColor: "#F5C400",
    highlighterWidth: 22,
    eraserRadius: 6,
    scribbleReversals: 4,
    scribbleRatio: 3,
    scribbleCoverage: 0.6,
    palmDelay: 400,
    mouse: false,
    toolbarPosition: "top",
  };

  const ICONS = {
    pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    highlighter: '<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
    clear: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    add: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  };

  let deck, cfg, W, H;
  let canvas, ctx, live, liveCtx, grid, toolbar, debugBox;
  const debug = /[?&]annotate-debug\b/.test(window.location.search);
  const storageKey = "annotate:" + window.location.pathname;
  // iPadOS reports itself as a Mac but has a touch screen
  const appleTouch = /iPad|iPhone|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

  // persistent state
  let ink = {}; // slide key -> [stroke]
  let blanks = {}; // original slide key -> [blank slide key] in order
  let blankCounter = 0;

  // session state
  const history = {}; // slide key -> { undo: [], redo: [] }
  let tool = "pen"; // pen | highlighter | eraser
  let colorIndex = 0;
  let widthIndex = 1;
  let active = null; // the gesture in progress
  let lastPenUp = 0;
  let lastPenSeen = 0; // any pen activity, including hover
  let touchDraws = false; // "draw with touch" mode (off by default)
  let expanded = false;
  let saveTimer = null;

  // ---------------------------------------------------------------- storage

  function load() {
    try {
      const data = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
      ink = data.ink || {};
      blanks = data.blanks || {};
      blankCounter = data.blankCounter || 0;
    } catch (e) {
      ink = {};
      blanks = {};
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        const clean = {};
        for (const key in ink) {
          if (ink[key].length) clean[key] = ink[key].map(packStroke);
        }
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ ink: clean, blanks: blanks, blankCounter: blankCounter })
        );
      } catch (e) {
        // private browsing or storage full: keep working without saving
      }
    }, 400);
  }

  function packStroke(s) {
    return { c: s.c, w: s.w, h: s.h, p: s.p.map((v) => Math.round(v * 100) / 100) };
  }

  // ------------------------------------------------------------- slide keys

  function isLeaf(section) {
    return !section.querySelector(":scope > section");
  }

  // Give every authored slide a stable key before blank slides are added.
  function assignKeys() {
    const sections = deck.getRevealElement().querySelectorAll(".slides section");
    let i = 0;
    sections.forEach(function (section) {
      if (!isLeaf(section)) return;
      section.dataset.annotateKey = section.id || "s" + i;
      i++;
    });
  }

  function keyOf(section) {
    return section ? section.dataset.annotateKey : null;
  }

  function strokesFor(key) {
    if (!ink[key]) ink[key] = [];
    return ink[key];
  }

  function historyFor(key) {
    if (!history[key]) history[key] = { undo: [], redo: [] };
    return history[key];
  }

  // ------------------------------------------------------------ grid slides

  // The grid is a layer exactly the size of the slide (where ink can go),
  // shown on `.write`/`.grid-slide` slides.
  function setGridStyle() {
    const root = document.documentElement.style;
    root.setProperty("--annotate-grid-size", cfg.gridSize + "px");
    root.setProperty("--annotate-grid-color", cfg.gridColor);
    root.setProperty("--annotate-grid-background", cfg.gridBackground);
  }

  function isGridSlide(slide) {
    return !!slide && (slide.classList.contains("write") || slide.classList.contains("grid-slide"));
  }

  function showGrid() {
    if (grid) grid.hidden = !isGridSlide(deck.getCurrentSlide());
  }

  function makeBlank(key) {
    const section = document.createElement("section");
    section.id = key;
    section.className = "slide grid-slide annotate-blank";
    section.dataset.annotateKey = key;
    section.setAttribute("aria-label", "Blank writing slide");
    return section;
  }

  function originalOf(section) {
    return section.dataset.annotateAfter || keyOf(section);
  }

  function findSlide(key) {
    return deck
      .getRevealElement()
      .querySelector('.slides section[data-annotate-key="' + CSS.escape(key) + '"]');
  }

  // re-create saved blank slides, in order, after the slide they follow
  function restoreBlanks() {
    for (const original in blanks) {
      const anchor = findSlide(original);
      if (!anchor) {
        delete blanks[original];
        continue;
      }
      let prev = anchor;
      blanks[original].forEach(function (key) {
        const section = makeBlank(key);
        section.dataset.annotateAfter = original;
        prev.after(section);
        prev = section;
      });
    }
  }

  function addBlank() {
    const current = deck.getCurrentSlide();
    if (!current) return;
    const original = originalOf(current);
    const list = blanks[original] || (blanks[original] = []);
    blankCounter += 1;
    const key = original + "--blank-" + blankCounter;
    const section = makeBlank(key);
    section.dataset.annotateAfter = original;

    // straight after the current slide (which may itself be a blank)
    const at = current.classList.contains("annotate-blank") ? list.indexOf(keyOf(current)) + 1 : 0;
    list.splice(at, 0, key);
    current.after(section);

    deck.sync();
    const idx = deck.getIndices(section);
    deck.slide(idx.h, idx.v);
    save();
  }

  function removeBlank() {
    const current = deck.getCurrentSlide();
    if (!current || !current.classList.contains("annotate-blank")) return;
    const key = keyOf(current);
    const original = current.dataset.annotateAfter;
    const list = blanks[original] || [];
    list.splice(list.indexOf(key), 1);
    if (!list.length) delete blanks[original];
    delete ink[key];
    delete history[key];

    const prev = current.previousElementSibling || findSlide(original);
    current.remove();
    deck.sync();
    if (prev) {
      const idx = deck.getIndices(prev);
      deck.slide(idx.h, idx.v);
    }
    save();
  }

  function resetDeck() {
    const current = deck.getCurrentSlide();
    if (current && current.classList.contains("annotate-blank")) {
      const idx = deck.getIndices(findSlide(current.dataset.annotateAfter));
      deck.slide(idx.h, idx.v);
    }
    deck
      .getRevealElement()
      .querySelectorAll(".slides section.annotate-blank")
      .forEach((s) => s.remove());
    ink = {};
    blanks = {};
    for (const k in history) delete history[k];
    deck.sync();
    save();
    redraw();
    refreshToolbar();
  }

  // ----------------------------------------------------------------- canvas

  function createCanvases() {
    const slides = deck.getRevealElement().querySelector(".slides");
    grid = document.createElement("div");
    grid.className = "annotate-grid";
    grid.hidden = true;
    slides.prepend(grid);
    canvas = document.createElement("canvas");
    canvas.className = "annotate-canvas";
    live = document.createElement("canvas");
    live.className = "annotate-canvas";
    slides.appendChild(canvas);
    slides.appendChild(live);
    ctx = canvas.getContext("2d");
    liveCtx = live.getContext("2d");
    resize();
  }

  function resize() {
    const size = deck.getComputedSlideSize();
    W = size.width;
    H = size.height;
    [grid, canvas, live].forEach(function (c) {
      c.style.width = W + "px";
      c.style.height = H + "px";
    });
    // backing store at the on-screen resolution
    const rect = canvas.getBoundingClientRect();
    const k = Math.max(1, (rect.width / W || 1) * (window.devicePixelRatio || 1));
    [canvas, live].forEach(function (c) {
      c.width = Math.round(W * k);
      c.height = Math.round(H * k);
      c.getContext("2d").setTransform(k, 0, 0, k, 0, 0);
    });
    redraw();
  }

  function toSlide(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * W) / rect.width,
      y: ((e.clientY - rect.top) * H) / rect.height,
    };
  }

  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const key = keyOf(deck.getCurrentSlide());
    if (key && ink[key]) ink[key].forEach((s) => drawStroke(ctx, s));
  }

  function pressureWidth(base, p) {
    return base * (0.3 + 1.4 * Math.min(1, Math.max(0, p)));
  }

  // points are stored flat: x, y, pressure, x, y, pressure, ...
  function drawStroke(c, s) {
    const p = s.p;
    const n = p.length / 3;
    if (!n) return;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = s.c;
    c.fillStyle = s.c;

    if (n === 1) {
      c.globalAlpha = s.h ? 0.35 : 1;
      c.beginPath();
      c.arc(p[0], p[1], (s.h ? s.w : pressureWidth(s.w, p[2])) / 2, 0, 2 * Math.PI);
      c.fill();
      c.restore();
      return;
    }

    if (s.h) {
      // one path so overlapping parts don't darken
      c.globalAlpha = 0.35;
      c.lineWidth = s.w;
      c.beginPath();
      c.moveTo(p[0], p[1]);
      for (let i = 1; i < n - 1; i++) {
        const mx = (p[3 * i] + p[3 * i + 3]) / 2;
        const my = (p[3 * i + 1] + p[3 * i + 4]) / 2;
        c.quadraticCurveTo(p[3 * i], p[3 * i + 1], mx, my);
      }
      c.lineTo(p[3 * n - 3], p[3 * n - 2]);
      c.stroke();
      c.restore();
      return;
    }

    // pen: midpoint quadratic segments, each with its own pressure width
    let sx = p[0];
    let sy = p[1];
    for (let i = 1; i < n; i++) {
      const cx = p[3 * i - 3];
      const cy = p[3 * i - 2];
      const last = i === n - 1;
      const ex = last ? p[3 * i] : (cx + p[3 * i]) / 2;
      const ey = last ? p[3 * i + 1] : (cy + p[3 * i + 1]) / 2;
      c.lineWidth = pressureWidth(s.w, (p[3 * i - 1] + p[3 * i + 2]) / 2);
      c.beginPath();
      c.moveTo(sx, sy);
      if (i === 1) c.lineTo(ex, ey);
      else c.quadraticCurveTo(cx, cy, ex, ey);
      c.stroke();
      sx = ex;
      sy = ey;
    }
    c.restore();
  }

  // --------------------------------------------------------------- geometry

  function bounds(s) {
    if (s.box) return s.box;
    const p = s.p;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      x0 = Math.min(x0, p[i]);
      x1 = Math.max(x1, p[i]);
      y0 = Math.min(y0, p[i + 1]);
      y1 = Math.max(y1, p[i + 1]);
    }
    s.box = { x0, y0, x1, y1 };
    return s.box;
  }

  function boxesNear(a, b, pad) {
    return !(a.x1 + pad < b.x0 || b.x1 + pad < a.x0 || a.y1 + pad < b.y0 || b.y1 + pad < a.y0);
  }

  function pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
      pointSegDist(ax, ay, cx, cy, dx, dy),
      pointSegDist(bx, by, cx, cy, dx, dy),
      pointSegDist(cx, cy, ax, ay, bx, by),
      pointSegDist(dx, dy, ax, ay, bx, by)
    );
  }

  // does the polyline q (flat x, y, pressure) come within `reach` of stroke s?
  function touches(q, qBox, s, reach) {
    const pad = reach + s.w;
    if (!boxesNear(qBox, bounds(s), pad)) return false;
    const p = s.p;
    const n = p.length / 3;
    const m = q.length / 3;
    const tol = reach + s.w / 2;
    for (let j = 0; j < m; j++) {
      const qx0 = q[3 * j], qy0 = q[3 * j + 1];
      const qx1 = j + 1 < m ? q[3 * j + 3] : qx0;
      const qy1 = j + 1 < m ? q[3 * j + 4] : qy0;
      for (let i = 0; i < n; i++) {
        const px0 = p[3 * i], py0 = p[3 * i + 1];
        const px1 = i + 1 < n ? p[3 * i + 3] : px0;
        const py1 = i + 1 < n ? p[3 * i + 4] : py0;
        if (segSegDist(qx0, qy0, qx1, qy1, px0, py0, px1, py1) <= tol) return true;
      }
    }
    return false;
  }

  // most of stroke s lies inside the box (so writing next to ink doesn't erase it)
  function covered(s, box) {
    const p = s.p;
    const pad = s.w;
    let inside = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] >= box.x0 - pad && p[i] <= box.x1 + pad && p[i + 1] >= box.y0 - pad && p[i + 1] <= box.y1 + pad) {
        inside++;
      }
    }
    return inside / (p.length / 3) >= cfg.scribbleCoverage;
  }

  // zig-zag test: many back-and-forths along the main axis, and a long path
  // for its size
  function scribbleMetrics(s) {
    const p = s.p;
    const n = p.length / 3;
    const box = bounds(s);
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    const diag = Math.hypot(w, h) || 1;
    const axis = w >= h ? 0 : 1;
    const hysteresis = Math.max(3, 0.1 * Math.max(w, h));

    let length = 0;
    let reversals = 0;
    let dir = 0;
    let turn = p[axis]; // coordinate at the last turning point
    for (let i = 1; i < n; i++) {
      length += Math.hypot(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2]);
      const v = p[3 * i + axis];
      if (dir >= 0 && v < turn - hysteresis) {
        if (dir > 0) reversals++;
        dir = -1;
      } else if (dir <= 0 && v > turn + hysteresis) {
        if (dir < 0) reversals++;
        dir = 1;
      }
      if ((dir > 0 && v > turn) || (dir < 0 && v < turn)) turn = v;
    }
    return { n, reversals, ratio: length / diag, length };
  }

  // ---------------------------------------------------------------- history

  function commit(key, added, removed) {
    if (!added.length && !removed.length) return;
    const hist = historyFor(key);
    hist.undo.push({ added, removed });
    hist.redo.length = 0;
    save();
    refreshToolbar();
  }

  function applyAction(key, add, remove) {
    const strokes = strokesFor(key);
    remove.forEach(function (s) {
      const i = strokes.indexOf(s);
      if (i >= 0) strokes.splice(i, 1);
    });
    add.forEach((s) => strokes.push(s));
  }

  function undo() {
    const key = keyOf(deck.getCurrentSlide());
    const hist = historyFor(key);
    const action = hist.undo.pop();
    if (!action) return;
    applyAction(key, action.removed, action.added);
    hist.redo.push(action);
    save();
    redraw();
    refreshToolbar();
  }

  function redo() {
    const key = keyOf(deck.getCurrentSlide());
    const hist = historyFor(key);
    const action = hist.redo.pop();
    if (!action) return;
    applyAction(key, action.added, action.removed);
    hist.undo.push(action);
    save();
    redraw();
    refreshToolbar();
  }

  function clearSlide() {
    const key = keyOf(deck.getCurrentSlide());
    const strokes = strokesFor(key).slice();
    if (!strokes.length) return;
    ink[key] = [];
    commit(key, [], strokes);
    redraw();
  }

  // ------------------------------------------------------------------ input

  // the toolbar, and anything marked data-annotate-ignore (e.g. the Vevox
  // pop-up), gets its events untouched
  function ignoredTarget(e) {
    if (!(e.target instanceof Element)) return false;
    return (toolbar && toolbar.contains(e.target)) || !!e.target.closest("[data-annotate-ignore]");
  }

  function isDrawPointer(e) {
    return (
      e.pointerType === "pen" ||
      (touchDraws && e.pointerType === "touch") ||
      (cfg.mouse && e.pointerType === "mouse")
    );
  }

  // pen eraser end (button 5, buttons bit 32) or side button (bit 2) held
  function penErasing(e) {
    return e.pointerType === "pen" && (e.buttons & 34) !== 0;
  }

  function palmGuardActive() {
    return active !== null || performance.now() - lastPenUp < cfg.palmDelay;
  }

  function currentColor() {
    const c = cfg.colors[colorIndex];
    if (c !== "auto") return c;
    const slide = deck.getCurrentSlide();
    return slide && slide.classList.contains("has-dark-background") ? cfg.autoDark : cfg.autoLight;
  }

  function samples(e) {
    if (typeof e.getCoalescedEvents === "function") {
      const list = e.getCoalescedEvents();
      if (list && list.length) return list;
    }
    return [e];
  }

  function pressureOf(e) {
    // mice report 0.5 while pressed; pens report 0 only when hovering
    return e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
  }

  function addPoint(e) {
    const pt = toSlide(e);
    const p = active.stroke.p;
    const n = p.length;
    if (n && Math.hypot(pt.x - p[n - 3], pt.y - p[n - 2]) < 0.4) return;
    // smooth pressure a little so widths don't jump
    const pr = n ? 0.6 * pressureOf(e) + 0.4 * p[n - 1] : pressureOf(e);
    p.push(pt.x, pt.y, pr);
    active.samples++;
    if (debug) showPointer(e);
  }

  function onPointerDown(e) {
    if (ignoredTarget(e)) return;
    if (e.pointerType === "pen") lastPenSeen = performance.now();
    // extra touches are palms; in touch-draw mode a new stroke may start at once
    const touchStroke = touchDraws && e.pointerType === "touch" && !active;
    if (e.pointerType === "touch" && !touchStroke && palmGuardActive()) {
      e.stopPropagation();
      return;
    }
    if (active || !isDrawPointer(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    const slide = deck.getCurrentSlide();
    if (!slide || !canvas) return;

    e.preventDefault();
    e.stopPropagation();
    // other browsers pan or select on pen drags unless told not to; Safari's
    // stylus handling (onTouch) already covers the iPad, so leave it alone
    if (e.pointerType === "pen" && !appleTouch) {
      document.documentElement.classList.add("annotate-pen-device");
    }
    document.documentElement.classList.add("annotate-drawing");

    const key = keyOf(slide);
    active = { id: e.pointerId, key, start: performance.now(), samples: 0 };
    active.erase = tool === "eraser" || penErasing(e);
    if (active.erase) {
      active.removed = [];
      active.last = toSlide(e);
      eraseAt(active.last, active.last);
      return;
    }
    const hl = tool === "highlighter";
    active.stroke = {
      c: hl ? cfg.highlighterColor : currentColor(),
      w: hl ? cfg.highlighterWidth : cfg.widths[widthIndex],
      h: hl ? 1 : 0,
      p: [],
    };
    samples(e).forEach(addPoint);
    drawLive();
  }

  function onPointerMove(e) {
    if (e.pointerType === "pen") lastPenSeen = performance.now();
    if (!active || e.pointerId !== active.id) {
      if (ignoredTarget(e)) return;
      if (e.pointerType === "touch" && palmGuardActive()) e.stopPropagation();
      if (debug && e.pointerType === "pen") showPointer(e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (active.erase) {
      samples(e).forEach(function (s) {
        const pt = toSlide(s);
        eraseAt(active.last, pt);
        active.last = pt;
      });
      return;
    }
    samples(e).forEach(addPoint);
    drawLive();
  }

  function onPointerUp(e) {
    if (!active || e.pointerId !== active.id) {
      if (ignoredTarget(e)) return;
      if (e.pointerType === "touch" && palmGuardActive()) e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    finishGesture(e.type === "pointercancel");
  }

  function drawLive() {
    liveCtx.clearRect(0, 0, W, H);
    drawStroke(liveCtx, active.stroke);
  }

  function eraseAt(from, to) {
    const seg = [from.x, from.y, 0, to.x, to.y, 0];
    const box = {
      x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y),
      x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y),
    };
    const strokes = strokesFor(active.key);
    const hit = strokes.filter((s) => touches(seg, box, s, cfg.eraserRadius));
    if (!hit.length) return;
    hit.forEach((s) => strokes.splice(strokes.indexOf(s), 1));
    active.removed.push(...hit);
    redraw();
  }

  function finishGesture(cancelled) {
    const g = active;
    active = null;
    lastPenUp = performance.now();
    document.documentElement.classList.remove("annotate-drawing");
    liveCtx.clearRect(0, 0, W, H);

    if (g.erase || !g.stroke) {
      commit(g.key, [], g.removed || []);
      return;
    }
    if (cancelled || !g.stroke.p.length) return;

    const s = g.stroke;
    const strokes = strokesFor(g.key);

    // scribble to erase
    let info = null;
    if (!s.h) {
      info = scribbleMetrics(s);
      info.duration = Math.round(lastPenUp - g.start);
      info.hz = info.duration ? Math.round((1000 * g.samples) / info.duration) : 0;
      info.scribble = info.reversals >= cfg.scribbleReversals && info.ratio >= cfg.scribbleRatio;
      if (info.scribble) {
        const box = bounds(s);
        const hit = strokes.filter((t) => touches(s.p, box, t, s.w / 2) && covered(t, box));
        info.hits = hit.length;
        if (hit.length) {
          hit.forEach((t) => strokes.splice(strokes.indexOf(t), 1));
          commit(g.key, [], hit);
          redraw();
          if (debug) showStroke(info, "erased " + hit.length);
          return;
        }
      }
    }

    strokes.push(s);
    drawStroke(ctx, s);
    commit(g.key, [s], []);
    if (debug && info) showStroke(info, "ink");
  }

  // stylus touches: stop Safari scrolling/selecting and reveal swiping;
  // finger touches while writing are palms, and in touch-draw mode all
  // touches belong to the drawing
  function onTouch(e) {
    if (ignoredTarget(e)) return;
    const stylus = Array.prototype.some.call(e.changedTouches, (t) => t.touchType === "stylus");
    if (stylus || touchDraws || palmGuardActive()) {
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function bindInput() {
    const opts = { capture: true, passive: false };
    window.addEventListener("pointerdown", onPointerDown, opts);
    window.addEventListener("pointermove", onPointerMove, opts);
    window.addEventListener("pointerup", onPointerUp, opts);
    window.addEventListener("pointercancel", onPointerUp, opts);
    ["touchstart", "touchmove", "touchend"].forEach(function (type) {
      window.addEventListener(type, onTouch, opts);
    });
    // a pen's side button would otherwise open the right-click menu
    window.addEventListener(
      "contextmenu",
      function (e) {
        if (active || performance.now() - lastPenSeen < 1000) e.preventDefault();
      },
      opts
    );
  }

  // ---------------------------------------------------------------- toolbar

  const buttons = {};

  function button(name, label, html, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "annotate-" + name;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = html;
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      onClick(b);
    });
    buttons[name] = b;
    toolbar.appendChild(b);
    return b;
  }

  function separator() {
    const s = document.createElement("span");
    s.className = "annotate-sep";
    toolbar.appendChild(s);
  }

  // first tap arms the button, second tap within 3 s runs it
  function twoTap(b, label, run) {
    if (b.classList.contains("annotate-confirm")) {
      clearTimeout(b._timer);
      b.classList.remove("annotate-confirm");
      b.innerHTML = b._html;
      run();
      return;
    }
    b._html = b.innerHTML;
    b.classList.add("annotate-confirm");
    b.textContent = label;
    b._timer = setTimeout(function () {
      b.classList.remove("annotate-confirm");
      b.innerHTML = b._html;
    }, 3000);
  }

  function widthIcon(w) {
    const r = Math.min(9, 1.5 + w);
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + r + '" fill="currentColor" stroke="none"/></svg>';
  }

  function createToolbar() {
    toolbar = document.createElement("div");
    toolbar.className = "annotate-toolbar annotate-" + (cfg.toolbarPosition === "bottom" ? "bottom" : "top");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Annotation tools");

    // keep finger taps on the toolbar away from reveal's swipe handling
    ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend"].forEach((t) =>
      toolbar.addEventListener(t, (e) => e.stopPropagation())
    );

    button("toggle", "Show or hide annotation tools", ICONS.pen, function () {
      setExpanded(!expanded);
    });

    cfg.colors.forEach(function (c, i) {
      const swatch = c === "auto" ? cfg.autoLight : c;
      button(
        "color-" + i,
        c === "auto" ? "Ink (light on dark slides)" : "Colour " + c,
        '<span class="annotate-swatch" style="background:' + swatch + '"></span>',
        function () {
          colorIndex = i;
          tool = "pen";
          refreshToolbar();
        }
      );
    });

    button("width", "Pen thickness", widthIcon(cfg.widths[widthIndex]), function () {
      widthIndex = (widthIndex + 1) % cfg.widths.length;
      tool = "pen";
      refreshToolbar();
    });
    button("highlighter", "Highlighter", ICONS.highlighter, function () {
      tool = tool === "highlighter" ? "pen" : "highlighter";
      refreshToolbar();
    });
    button("eraser", "Eraser (removes whole strokes)", ICONS.eraser, function () {
      tool = tool === "eraser" ? "pen" : "eraser";
      refreshToolbar();
    });

    button("touch", "Draw with touch, for rubber-tip styluses (turns off swiping)", ICONS.hand, function () {
      touchDraws = !touchDraws;
      document.documentElement.classList.toggle("annotate-touch-draw", touchDraws);
      toolbar.classList.toggle("annotate-touch-on", touchDraws);
      refreshToolbar();
    });

    separator();
    button("undo", "Undo", ICONS.undo, undo);
    button("redo", "Redo", ICONS.redo, redo);
    button("clear", "Clear this slide (tap twice)", ICONS.clear, (b) => twoTap(b, "Clear?", clearSlide));

    separator();
    button("add", "New blank slide after this one", ICONS.add, addBlank);
    button("remove", "Delete this blank slide (tap twice)", ICONS.remove, (b) =>
      twoTap(b, "Delete?", removeBlank)
    );
    button("reset", "Remove all ink and blank slides in this deck (tap twice)", ICONS.reset, (b) =>
      twoTap(b, "Clear all?", resetDeck)
    );

    document.body.appendChild(toolbar);
  }

  function setExpanded(open) {
    expanded = open;
    toolbar.classList.toggle("annotate-collapsed", !open);
    buttons.toggle.innerHTML = open ? ICONS.close : ICONS.pen;
    buttons.toggle.setAttribute("aria-expanded", String(open));
  }

  function refreshToolbar() {
    if (!toolbar) return;
    cfg.colors.forEach(function (c, i) {
      buttons["color-" + i].setAttribute("aria-pressed", String(tool === "pen" && colorIndex === i));
    });
    buttons.width.innerHTML = widthIcon(cfg.widths[widthIndex]);
    buttons.highlighter.setAttribute("aria-pressed", String(tool === "highlighter"));
    buttons.eraser.setAttribute("aria-pressed", String(tool === "eraser"));
    buttons.touch.setAttribute("aria-pressed", String(touchDraws));

    const slide = deck.getCurrentSlide();
    const key = keyOf(slide);
    const hist = key ? historyFor(key) : { undo: [], redo: [] };
    buttons.undo.disabled = !hist.undo.length;
    buttons.redo.disabled = !hist.redo.length;
    buttons.remove.hidden = !(slide && slide.classList.contains("annotate-blank"));
  }

  // ------------------------------------------------------------------ debug

  function showPointer(e) {
    if (!debugBox) return;
    debugBox.dataset.pointer =
      "type " + e.pointerType +
      "  pressure " + e.pressure.toFixed(2) +
      "\ntilt " + e.tiltX + "," + e.tiltY +
      (e.altitudeAngle !== undefined ? "  alt " + e.altitudeAngle.toFixed(2) : "") +
      "  size " + Math.round(e.width) + "x" + Math.round(e.height);
    renderDebug();
  }

  function showStroke(info, verdict) {
    if (!debugBox) return;
    debugBox.dataset.stroke =
      "points " + info.n + "  " + info.duration + " ms  " + info.hz + " samples/s" +
      "\nreversals " + info.reversals + "  length/diag " + info.ratio.toFixed(1) +
      "\nscribble " + info.scribble + (info.hits !== undefined ? "  hits " + info.hits : "") +
      "  -> " + verdict;
    renderDebug();
    console.log("annotate stroke", info, verdict);
  }

  function renderDebug() {
    debugBox.textContent = [debugBox.dataset.pointer, debugBox.dataset.stroke].filter(Boolean).join("\n\n");
  }

  function logTouchPointer(e) {
    if (e.pointerType !== "pen") showPointer(e);
  }

  // ------------------------------------------------------------------- init

  return {
    id: "annotate",

    init: function (reveal) {
      deck = reveal;
      cfg = Object.assign({}, DEFAULTS, deck.getConfig().annotate || {});
      setGridStyle();
      // the PDF keeps the grid but gets no ink or tools
      if (/print-pdf/gi.test(window.location.search)) return;

      // before reveal lays out the deck: stable keys and saved blank slides
      assignKeys();
      load();
      restoreBlanks();

      deck.on("ready", function () {
        createCanvases();
        createToolbar();
        bindInput();
        if (debug) {
          debugBox = document.createElement("div");
          debugBox.className = "annotate-debug";
          debugBox.textContent = "annotate debug: touch the screen with the pencil";
          document.body.appendChild(debugBox);
          window.addEventListener("pointerdown", logTouchPointer, true);
        }
        setExpanded(false);
        showGrid();
        refreshToolbar();
        redraw();
      });

      deck.on("slidechanged", function () {
        if (active) finishGesture(true);
        showGrid();
        refreshToolbar();
        redraw();
      });

      deck.on("resize", resize);
      window.addEventListener("resize", () => canvas && resize());
    },
  };
};
