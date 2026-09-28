/*
 * RevealVevox: a Vevox poll pop-up for reveal.js slides.
 *
 * - Slides with class `.vevox` (e.g. `### Quick question {.vevox vevox-label="Matrix sizes"}`)
 *   get joining instructions (ID + QR code) and an "Open poll" button.
 * - The pop-up shows the joining instructions next to the Vevox participant
 *   app (vevox.app). The presenter page can't be embedded (Vevox forbids it),
 *   so the pop-up has a button that opens it in its own, reused tab.
 * - The pop-up's iframe is kept when closed, so reopening is instant.
 * - `v` toggles the pop-up; Esc or changing slide closes it.
 *
 * The session ID comes from, in order: `?vevox=123456789` in the URL, the ID
 * set on this device in the pop-up's settings, then the YAML config.
 */
window.RevealVevox = function () {
  "use strict";

  let deck, cfg;
  let overlay, iframe, iframeSession, settingsForm, titleEl;
  let open = false;
  const storageKey = "vevox:" + window.location.pathname;
  let memory = null; // settings when localStorage isn't available

  // ------------------------------------------------------------- settings

  function stored() {
    try {
      return JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    } catch (e) {
      return {};
    }
  }

  function store(value) {
    try {
      if (value) window.localStorage.setItem(storageKey, JSON.stringify(value));
      else window.localStorage.removeItem(storageKey);
    } catch (e) {
      // private browsing: the setting lasts until the page is reloaded
      memory = value || {};
    }
  }

  function local() {
    return memory || stored();
  }

  function cleanId(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function session() {
    const fromUrl = new URLSearchParams(window.location.search).get("vevox");
    return cleanId(fromUrl) || cleanId(local().session) || cleanId(cfg.session);
  }

  function presenter() {
    return local().presenter || cfg.presenter || cfg.presenterHome;
  }

  function joinUrl(id) {
    return "https://vevox.app/#/m/" + id;
  }

  function prettyId(id) {
    return id.replace(/(\d{3})(?=\d)/g, "$1 ");
  }

  // ------------------------------------------------------------ QR codes

  // QR code as an SVG path with a quiet zone; colours come from vevox.css
  function qrSvg(text) {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
      }
    }
    const size = n + 2 * quiet;
    return (
      '<svg class="vevox-qr" viewBox="0 0 ' + size + " " + size + '" role="img" ' +
      'aria-label="QR code for ' + text + '" shape-rendering="crispEdges">' +
      '<rect class="vevox-qr-bg" width="100%" height="100%"/>' +
      '<path class="vevox-qr-dots" d="' + d + '"/></svg>'
    );
  }

  function joinHtml(id) {
    if (!id) {
      return '<p class="vevox-missing">No Vevox session ID set yet.</p>';
    }
    return (
      '<div class="vevox-join-text">' +
      '<p class="vevox-join-label">Join at</p>' +
      '<p class="vevox-join-site">vevox.app</p>' +
      '<p class="vevox-join-label">ID</p>' +
      '<p class="vevox-join-id">' + prettyId(id) + "</p>" +
      "</div>" +
      qrSvg(joinUrl(id))
    );
  }

  // ------------------------------------------------------------ poll slides

  function labelOf(slide) {
    return (
      (slide && (slide.getAttribute("data-vevox-label") || slide.getAttribute("vevox-label"))) || ""
    );
  }

  function decorateSlides() {
    const slides = deck.getRevealElement().querySelectorAll(".slides section.vevox");
    slides.forEach(function (slide) {
      let box = slide.querySelector(":scope > .vevox-slide");
      if (!box) {
        box = document.createElement("div");
        box.className = "vevox-slide";
        box.innerHTML =
          '<div class="vevox-join"></div>' +
          '<button type="button" class="vevox-open">Open poll</button>';
        box.querySelector(".vevox-open").addEventListener("click", () => show(slide));
        slide.appendChild(box);
      }
      box.querySelector(".vevox-join").innerHTML = joinHtml(session());
    });
  }

  // ----------------------------------------------------------------- pop-up

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.className = "vevox-overlay";
    overlay.hidden = true;
    // the annotate plugin leaves events in here alone
    overlay.setAttribute("data-annotate-ignore", "");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Vevox poll");
    overlay.innerHTML =
      '<div class="vevox-panel">' +
      '<header class="vevox-header">' +
      '<h2 class="vevox-title"></h2>' +
      '<button type="button" class="vevox-settings-button" aria-expanded="false">Session ID</button>' +
      '<button type="button" class="vevox-presenter">Presenter ↗</button>' +
      '<button type="button" class="vevox-close" aria-label="Close poll">✕</button>' +
      "</header>" +
      '<form class="vevox-settings" hidden>' +
      '<label>Session ID <input name="session" inputmode="numeric" autocomplete="off" placeholder="123 456 789"></label>' +
      '<label>Presenter link <input name="presenter" type="url" autocomplete="off" placeholder="https://universityofleeds.vevox.com/#/present/…"></label>' +
      '<button type="submit">Save</button>' +
      '<button type="button" class="vevox-reset">Use default</button>' +
      '<p class="vevox-settings-note"></p>' +
      "</form>" +
      '<div class="vevox-body">' +
      '<aside class="vevox-join"></aside>' +
      '<div class="vevox-poll"></div>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    titleEl = overlay.querySelector(".vevox-title");
    settingsForm = overlay.querySelector(".vevox-settings");

    overlay.querySelector(".vevox-close").addEventListener("click", hide);
    overlay.querySelector(".vevox-presenter").addEventListener("click", function () {
      window.open(presenter(), "vevox-presenter");
    });
    overlay.querySelector(".vevox-settings-button").addEventListener("click", () =>
      toggleSettings(settingsForm.hidden)
    );
    settingsForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const id = cleanId(settingsForm.elements.session.value);
      const link = settingsForm.elements.presenter.value.trim();
      store(id || link ? { session: id, presenter: link } : null);
      toggleSettings(false);
      refresh();
    });
    overlay.querySelector(".vevox-reset").addEventListener("click", function () {
      memory = null;
      store(null);
      toggleSettings(false);
      refresh();
    });
    // clicking the dimmed area around the panel closes the pop-up
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) hide();
    });
  }

  function toggleSettings(show) {
    settingsForm.hidden = !show;
    overlay.querySelector(".vevox-settings-button").setAttribute("aria-expanded", String(show));
    if (!show) return;
    const saved = local();
    settingsForm.elements.session.value = saved.session ? prettyId(saved.session) : "";
    settingsForm.elements.presenter.value = saved.presenter || "";
    const note = [];
    if (cfg.session) note.push("Default ID " + prettyId(cleanId(cfg.session)) + ".");
    if (new URLSearchParams(window.location.search).get("vevox")) {
      note.push("The ?vevox= in the address overrides this.");
    }
    note.push("Saved on this device only.");
    settingsForm.querySelector(".vevox-settings-note").textContent = note.join(" ");
    settingsForm.elements.session.focus();
  }

  // update everything that shows the session ID
  function refresh() {
    const id = session();
    decorateSlides();
    if (!overlay) return;
    overlay.querySelector(".vevox-join").innerHTML = joinHtml(id);
    const poll = overlay.querySelector(".vevox-poll");
    if (!id) {
      if (iframe) iframe.remove();
      iframe = null;
      iframeSession = null;
      poll.innerHTML =
        '<p class="vevox-missing">Enter the Vevox session ID under “Session ID” above.</p>';
      return;
    }
    if (open && iframeSession !== id) loadPoll(id);
  }

  // the iframe is made on first open and kept, so reopening is instant
  function loadPoll(id) {
    const poll = overlay.querySelector(".vevox-poll");
    if (!iframe) {
      poll.innerHTML = "";
      iframe = document.createElement("iframe");
      iframe.title = "Vevox poll";
      iframe.setAttribute("allow", "clipboard-write");
      poll.appendChild(iframe);
    }
    iframe.src = joinUrl(id);
    iframeSession = id;
  }

  function show(slide) {
    if (!overlay) createOverlay();
    const label = labelOf(slide || deck.getCurrentSlide());
    titleEl.textContent = label ? "Poll: " + label : "Poll";
    overlay.hidden = false;
    open = true;
    refresh();
    const id = session();
    if (id && iframeSession !== id) loadPoll(id);
    if (!id) toggleSettings(true);
    else overlay.querySelector(".vevox-close").focus();
  }

  function hide() {
    if (!overlay || !open) return;
    overlay.hidden = true;
    open = false;
    toggleSettings(false);
  }

  function onKey(e) {
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      hide();
    }
  }

  // ------------------------------------------------------------------- init

  return {
    id: "vevox",

    init: function (reveal) {
      deck = reveal;
      cfg = Object.assign({ session: "", presenter: "", presenterHome: "" }, deck.getConfig().vevox || {});

      // joining instructions go on the slides before layout (also in the PDF)
      decorateSlides();
      if (/print-pdf/gi.test(window.location.search)) return;

      document.addEventListener("keydown", onKey, true);
      deck.addKeyBinding({ keyCode: 86, key: "V", description: "Open or close the Vevox poll" }, function () {
        if (open) hide();
        else show();
      });
      deck.on("slidechanged", hide);
    },
  };
};
