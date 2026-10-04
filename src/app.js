/* Doodle Alive: screens, state and wiring.
   The doodle engine (src/engine/) is only used through the names in ENGINE.md.
   Flow: snap -> the doodle appears -> the video makes itself in the background -> Share. */

// The name in the footer ("More from ...").
const MAKER_NAME = "Risheek";

const SIBLING = {
  name: "Handwriting → Font",
  url: "https://handwriting-font-converter.vercel.app",
  blurb: "Type in your own handwriting."
};

(function () {
  "use strict";

  var W = window;
  var D = document;
  var DA = W.DA || {};

  /* ---------- tiny helpers ---------- */

  function $(id) { return D.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
  function dpr() { return Math.min(W.devicePixelRatio || 1, 2); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function decor() { return DA.decor || null; }

  /* ---------- the engine must be there ---------- */

  var NEEDED = [
    "decode.fileToImageData", "sample.load",
    "cleanup.findDoodles", "cleanup.doodleAt",
    "animate.prepare", "animate.MOTIONS",
    "backgrounds.LIST", "backgrounds.thumbnail",
    "compose.createScene", "compose.startPreview", "compose.FONTS",
    "export.makeVideo", "export.makeSticker",
    "share.share", "share.save", "share.canShare", "share.platform"
  ];
  function missingParts() {
    return NEEDED.filter(function (path) {
      var o = DA;
      var keys = path.split(".");
      for (var i = 0; i < keys.length; i += 1) {
        if (o == null || o[keys[i]] == null) return true;
        o = o[keys[i]];
      }
      return false;
    });
  }
  var missing = missingParts();
  var engineOk = missing.length === 0;
  if (!engineOk && W.console) console.warn("Doodle Alive: engine parts missing:", missing.join(", "));

  /* ---------- address shortcuts (ENGINE.md section 6) ---------- */

  var Q = new URLSearchParams(location.search);
  var devScreen = Q.get("screen");
  var devT = null;
  if (Q.has("t")) {
    var tt = parseFloat(Q.get("t"));
    if (isFinite(tt)) devT = tt;
  }

  /* ---------- saved preferences (never the photo or the doodle) ---------- */

  var PREF_KEY = "doodle-alive.v1";
  var prefs = { v: 1 };
  function loadPrefs() {
    try {
      var raw = W.localStorage.getItem(PREF_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") prefs = Object.assign({ v: 1 }, o);
      }
    } catch (e) { /* nothing saved is fine */ }
  }
  function savePrefs() {
    try { W.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  /* ---------- state ---------- */

  var S = {
    screen: "landing",
    settings: null,
    imageData: null,
    result: null,
    index: 0,
    prepared: null,
    scene: null,
    preview: null,
    job: 0,
    queue: Promise.resolve(),
    picking: false,
    // the video that makes itself
    phase: "making",        // making | ready | nosupport | failed
    renderToken: 0,
    renderTimer: 0,
    rendering: Promise.resolve(),
    ctrl: null,             // AbortController of the render in progress
    videoFile: null,
    stickerFile: null,
    shareMode: "share",     // share | save
    fail: null,
    devMaking: false,
    forceShareUI: false,
    noAuto: false,
    dev: null,
    photoUrl: null,
    support: null,
    deferredPrompt: null,
    a2hsShown: false,
    progress: 0
  };

  var dbg = { screen: "landing", settings: null, scene: null, preview: null, phase: "making" };
  W.__doodleAlive = dbg;
  function syncDebug() {
    // dbg.screen is kept by updateScreenName (it knows making / done / a2hs)
    dbg.settings = (S.scene && S.scene.settings) || S.settings;
    dbg.scene = S.scene;
    dbg.preview = S.preview;
    dbg.phase = S.phase;
  }

  /* ---------- defaults and settings ---------- */

  var FALLBACK_DEFAULTS = { background: "collage", motion: "wiggle", ink: "auto", outline: "auto", text: "", font: "caveat" };

  function defaults() {
    return Object.assign({}, FALLBACK_DEFAULTS, (DA.compose && DA.compose.DEFAULTS) || {});
  }
  function listOf(which) {
    if (which === "background") return DA.backgrounds && DA.backgrounds.LIST;
    if (which === "motion") return DA.animate && DA.animate.MOTIONS;
    if (which === "font") return DA.compose && DA.compose.FONTS;
    return null;
  }
  function validId(which, id) {
    var list = listOf(which);
    if (typeof id !== "string" || !Array.isArray(list)) return false;
    return list.some(function (x) { return x.id === id; });
  }
  function textLimits() {
    var c = DA.compose || {};
    return { chars: c.TEXT_MAX_CHARS || 40, lines: c.TEXT_MAX_LINES || 2 };
  }
  function clampText(s) {
    var L = textLimits();
    var out = String(s || "").replace(/\r/g, "").split("\n").slice(0, L.lines).join("\n");
    var chars = Array.from(out);
    if (chars.length > L.chars) out = chars.slice(0, L.chars).join("");
    return out;
  }
  function initialSettings() {
    var s = defaults();
    ["background", "motion", "font"].forEach(function (k) {
      if (validId(k, prefs[k])) s[k] = prefs[k];
    });
    // address shortcuts
    if (validId("background", Q.get("bg"))) s.background = Q.get("bg");
    if (validId("motion", Q.get("motion"))) s.motion = Q.get("motion");
    if (validId("font", Q.get("font"))) s.font = Q.get("font");
    if (Q.get("ink") === "original") s.ink = "original";
    if (Q.get("outline") === "on" || Q.get("outline") === "off") s.outline = Q.get("outline");
    if (Q.has("text")) s.text = clampText(Q.get("text"));
    return s;
  }
  function bgInfo(id) {
    var list = listOf("background");
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- errors ---------- */

  function normalizeError(e) {
    if (e && typeof e === "object") {
      if (typeof e.title === "string" && e.title) {
        return { code: e.code || "unknown", title: e.title, detail: typeof e.detail === "string" ? e.detail : "" };
      }
      if (e.error && typeof e.error.title === "string") return normalizeError(e.error);
    }
    if (W.console && e) console.warn("Doodle Alive:", e);
    return { code: "unknown", title: "Hmm, that didn't work.", detail: "Give it another go. A fresh photo sometimes helps." };
  }

  /* ---------- screens ---------- */

  var SCREEN_EL = {
    landing: "screen-landing",
    working: "screen-working",
    editor: "screen-editor",
    error: "screen-error",
    broken: "screen-broken"
  };

  function showScreen(name) {
    var el = SCREEN_EL[name] || SCREEN_EL.landing;
    qsa(".screen").forEach(function (s) { s.classList.toggle("is-active", s.id === el); });
    S.screen = name;
    D.body.setAttribute("data-screen", name);
    W.scrollTo(0, 0);
    var focusEl = name === "landing" ? qsa(".headline")[0] : name === "error" ? $("errTitle") : null;
    if (focusEl) { try { focusEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    updateScreenName();
  }

  function updateScreenName() {
    var base = S.screen;
    if (base === "editor" || base === "making" || base === "done" || base === "a2hs" || base === "error-video") {
      var line = $("a2hsLine");
      if (line && !line.hidden) base = "a2hs";
      else if (S.phase === "ready") base = "done";
      else if (S.phase === "nosupport" || S.phase === "failed") base = "error-video";
      else base = S.devMaking ? "making" : "editor";
    }
    dbg.screen = base;
    D.body.setAttribute("data-screen", base);
    syncDebug();
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, ms || 3600);
  }

  function platform() {
    try { return DA.share.platform(); } catch (e) { return "desktop"; }
  }
  function isStandalone() {
    try {
      return (W.matchMedia && W.matchMedia("(display-mode: standalone)").matches) || W.navigator.standalone === true;
    } catch (e) { return false; }
  }

  /* ---------- the landing hero (a live sample, or a pretty static card) ---------- */

  var hero = { scene: null, preview: null, starting: false, failed: false };

  function stopHero() {
    if (hero.preview) { try { hero.preview.stop(); } catch (e) { /* ignore */ } hero.preview = null; }
    $("heroCard").classList.remove("is-live");
  }

  async function startHero() {
    if (!engineOk || hero.starting || hero.failed || S.screen !== "landing") return;
    hero.starting = true;
    try {
      if (!hero.scene) {
        var img = await DA.sample.load();
        var res = await DA.cleanup.findDoodles(img);
        if (!res || !res.ok) throw new Error("no sample doodle");
        var prep = await DA.animate.prepare(res.doodles[0]);
        hero.scene = await DA.compose.createScene(prep, { background: "collage", motion: "wiggle" });
      }
      if (S.screen !== "landing") return;
      if (hero.preview) stopHero();
      hero.preview = DA.compose.startPreview($("heroCanvas"), hero.scene);
      if (devT != null) hero.preview.freeze(devT);
      $("heroCard").classList.add("is-live");
    } catch (e) {
      hero.failed = true; // the static card stays
      if (W.console) console.warn("Doodle Alive: hero sample not available", e);
    } finally {
      hero.starting = false;
    }
  }
  function startHeroSoon() {
    var go = function () { startHero(); };
    if ("requestIdleCallback" in W) W.requestIdleCallback(go, { timeout: 1200 });
    else setTimeout(go, 300);
  }

  function goLanding() {
    S.job += 1;
    teardownEditor();
    releasePhotoUrl();
    showScreen("landing");
    startHeroSoon();
  }

  /* ---------- photo in ---------- */

  var workTimer = 0;
  var WORK_LINES = [
    "peeling your doodle off the paper…",
    "tidying up the paper bits…",
    "teaching it to wiggle…"
  ];

  function releasePhotoUrl() {
    if (S.photoUrl) { try { URL.revokeObjectURL(S.photoUrl); } catch (e) { /* ignore */ } S.photoUrl = null; }
  }

  function setWorking(url) {
    var img = $("workImg");
    var photo = $("workPhoto");
    photo.classList.toggle("is-paper", !url);
    img.onerror = function () { photo.classList.add("is-paper"); img.hidden = true; };
    if (url) { img.hidden = false; img.src = url; } else { img.hidden = true; img.removeAttribute("src"); }
    img.style.animation = "none";
    void img.offsetWidth;
    img.style.animation = "";
    var n = 0;
    $("workLine").textContent = WORK_LINES[0];
    clearInterval(workTimer);
    workTimer = setInterval(function () {
      n = (n + 1) % WORK_LINES.length;
      $("workLine").textContent = WORK_LINES[n];
    }, 1500);
  }
  function stopWorkingLines() { clearInterval(workTimer); }

  function ensureEngine() {
    if (engineOk) return true;
    showScreen("broken");
    return false;
  }

  function handleFile(file) {
    if (!file || !ensureEngine()) return;
    if (S.settings) S.settings.text = ""; // words belong to one doodle
    releasePhotoUrl();
    var url = null;
    try { url = URL.createObjectURL(file); S.photoUrl = url; } catch (e) { url = null; }
    handleImage(function () { return DA.decode.fileToImageData(file); }, url);
  }

  function trySample() {
    if (!ensureEngine()) return;
    if (S.settings) S.settings.text = "";
    handleImage(function () { return DA.sample.load(); }, null);
  }

  async function handleImage(getImageData, previewUrl) {
    S.job += 1;
    var job = S.job;
    teardownEditor();
    stopHero();
    setWorking(previewUrl);
    showScreen("working");
    try {
      var imageData = await getImageData();
      if (job !== S.job) return;
      var result = await DA.cleanup.findDoodles(imageData);
      if (job !== S.job) return;
      if (!result || !result.ok) {
        stopWorkingLines();
        showError(result && result.error);
        return;
      }
      S.imageData = imageData;
      S.result = result;
      S.index = 0;
      await enterEditor(job);
    } catch (e) {
      if (job === S.job) { stopWorkingLines(); showError(e); }
    }
  }

  /* ---------- error screen (photo problems) ---------- */

  function showError(err) {
    var e = normalizeError(err);
    stopWorkingLines();
    releasePhotoUrl();
    pausePreview();
    $("errTitle").textContent = e.title;
    $("errDetail").textContent = e.detail;
    $("errDetail").hidden = !e.detail;
    var art = $("errArt");
    if (decor()) art.innerHTML = DA.decor.sad();
    var btn = $("errBtn");
    var link = $("errLink");
    link.hidden = false;
    link.textContent = "Back to the start";
    var action;
    if (e.code === "no-doodle" || e.code === "too-faint") {
      btn.textContent = "Try again";
      action = function () { $("cameraInput").click(); };
    } else if (e.code === "heic" || e.code === "not-image" || e.code === "unreadable") {
      btn.textContent = "Pick another photo";
      action = function () { $("galleryInput").click(); };
    } else {
      btn.textContent = "Start over";
      link.hidden = true;
      action = goLanding;
    }
    btn.onclick = action;
    link.onclick = goLanding;
    showScreen("error");
    S.screen = "error-" + e.code;
    updateScreenName();
  }

  /* ---------- the editor ---------- */

  var controlsBuilt = false;

  function sparkleSvg() {
    return decor() ? DA.decor.sparkle(DA.decor.colors.butter) : "";
  }

  function buildControls() {
    if (controlsBuilt) return;
    controlsBuilt = true;

    // background tiles
    var row = $("bgRow");
    var list = DA.backgrounds.LIST;
    list.forEach(function (b) {
      var btn = D.createElement("button");
      btn.type = "button";
      btn.className = "bg-tile";
      btn.dataset.id = b.id;
      btn.setAttribute("aria-label", b.name);
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = '<span class="tile-thumb"></span><span class="tile-spark" aria-hidden="true">' + sparkleSvg() + "</span>";
      btn.addEventListener("click", function () { change({ background: b.id }); });
      row.appendChild(btn);
    });
    // thumbnails one by one, so the first frame isn't held up
    var i = 0;
    (function next() {
      if (i >= list.length) return;
      var b = list[i];
      var tile = row.children[i];
      i += 1;
      try {
        var c = DA.backgrounds.thumbnail(b.id, Math.round(64 * dpr()), Math.round(114 * dpr()));
        if (c && tile) {
          c.setAttribute("aria-hidden", "true");
          tile.querySelector(".tile-thumb").appendChild(c);
        }
      } catch (e) { /* the pink tile stays */ }
      setTimeout(next, 16);
    })();

    // motion chips
    var mrow = $("motionRow");
    DA.animate.MOTIONS.forEach(function (m) {
      var chip = D.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.id = m.id;
      chip.textContent = m.name;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", function () { change({ motion: m.id }); });
      mrow.appendChild(chip);
    });
    // the right-edge fade on a phone goes away once the row is scrolled to its end
    mrow.addEventListener("scroll", function () { mrow.classList.toggle("at-end", mrow.scrollLeft + mrow.clientWidth >= mrow.scrollWidth - 4); }, { passive: true });

    // font chips (inside the text sheet)
    var frow = $("fontRow");
    DA.compose.FONTS.forEach(function (f) {
      var chip = D.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.id = f.id;
      chip.textContent = f.name;
      chip.style.fontFamily = f.family;
      chip.style.fontWeight = f.id === "pacifico" ? "400" : "600";
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", function () { change({ font: f.id }); });
      frow.appendChild(chip);
    });
  }

  function syncControls() {
    var s = S.settings;
    if (!s) return;
    qsa("#bgRow .bg-tile").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.id === s.background ? "true" : "false");
    });
    qsa("#motionRow .chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.id === s.motion ? "true" : "false");
    });
    var fam = "";
    qsa("#fontRow .chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.id === s.font ? "true" : "false");
    });
    var fonts = listOf("font") || [];
    fonts.forEach(function (f) { if (f.id === s.font) fam = f.family; });
    if (fam) $("textInput").style.fontFamily = fam;
    var info = bgInfo(s.background);
    $("bgName").textContent = info ? info.name : "";
    $("btnTextLabel").textContent = s.text ? "Edit text" : "Add text";
  }

  function centerSelectedTile() {
    var row = $("bgRow");
    var tile = row.querySelector('.bg-tile[aria-pressed="true"]');
    if (!tile || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = tile.offsetLeft - (row.clientWidth - tile.offsetWidth) / 2;
  }

  /* size the story card to the biggest 9:16 that fits the stage */
  function fitStory() {
    var stage = $("stage");
    var story = $("story");
    if (!stage || !story) return;
    var pad = 12;
    var w = stage.clientWidth - pad * 2;
    var h = stage.clientHeight - pad * 2;
    if (w < 60 || h < 60) return;
    if (w * 16 / 9 < h) h = w * 16 / 9; else w = h * 9 / 16;
    story.style.width = Math.floor(w) + "px";
    story.style.height = Math.floor(h) + "px";
  }

  function startEditorPreview() {
    if (!S.scene) return;
    if (S.preview) { try { S.preview.stop(); } catch (e) { /* ignore */ } S.preview = null; }
    S.preview = DA.compose.startPreview($("storyCanvas"), S.scene);
    if (devT != null) S.preview.freeze(devT);
    syncDebug();
  }
  function pausePreview() {
    if (S.preview) { try { S.preview.stop(); } catch (e) { /* ignore */ } S.preview = null; syncDebug(); }
  }

  async function enterEditor(job) {
    var prepared = await DA.animate.prepare(S.result.doodles[S.index]);
    if (job !== S.job) return;
    var scene = await DA.compose.createScene(prepared, S.settings);
    if (job !== S.job) return;
    S.prepared = prepared;
    S.scene = scene;
    S.queue = Promise.resolve();
    stopWorkingLines();
    buildControls();
    showScreen("editor");
    releasePhotoUrl();
    fitStory();
    syncControls();
    buildMulti();
    startEditorPreview();
    centerSelectedTile();
    applyDev();
    if (!S.noAuto) scheduleRender(400);
    renderBar();
  }

  function teardownEditor() {
    S.renderToken += 1;
    abortRender();
    clearTimeout(S.renderTimer);
    pausePreview();
    S.scene = null;
    S.prepared = null;
    S.result = null;
    S.imageData = null;
    S.videoFile = null;
    S.stickerFile = null;
    S.phase = "making";
    S.devMaking = false;
    S.noAuto = false;
    closeSheet(true);
    hideA2hs();
    $("multi").hidden = true;
  }

  /* ---------- settings changes ---------- */

  function change(partial) {
    if (!S.settings || !S.scene) return Promise.resolve();
    var changed = Object.keys(partial).some(function (k) { return S.settings[k] !== partial[k]; });
    if (!changed) return Promise.resolve();
    var onlyFont = Object.keys(partial).length === 1 && "font" in partial;
    var affectsVideo = !(onlyFont && !S.settings.text);
    Object.assign(S.settings, partial);
    prefs.background = S.settings.background;
    prefs.motion = S.settings.motion;
    prefs.font = S.settings.font;
    savePrefs();
    syncControls();
    var scene = S.scene;
    S.queue = S.queue
      .then(function () { return scene.update(partial); })
      .then(function () { if (scene === S.scene) syncDebug(); })
      .catch(function (e) {
        if (W.console) console.warn("Doodle Alive: update failed", e);
        toast("That one didn't stick. Try again?");
      });
    if (affectsVideo) scheduleRender(600);
    return S.queue;
  }

  /* ---------- more than one doodle in the photo ---------- */

  function buildMulti() {
    var wrap = $("multi");
    var r = S.result;
    if (!r || !r.doodles || r.doodles.length < 2 || !S.imageData) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var photo = $("miniPhoto");
    var cv = $("miniCanvas");
    var iw = S.imageData.width;
    var ih = S.imageData.height;
    var tw = 160;
    var th = Math.max(1, Math.round(tw * ih / iw));
    cv.width = tw;
    cv.height = th;
    try {
      var tmp = D.createElement("canvas");
      tmp.width = iw;
      tmp.height = ih;
      tmp.getContext("2d").putImageData(S.imageData, 0, 0);
      cv.getContext("2d").drawImage(tmp, 0, 0, tw, th);
    } catch (e) { /* the paper stays blank */ }
    photo.style.setProperty("--ar", iw + " / " + ih);
    qsa(".mini-box", photo).forEach(function (n) { n.remove(); });
    r.doodles.slice(0, 12).forEach(function () {
      var b = D.createElement("span");
      b.className = "mini-box";
      photo.appendChild(b);
    });
    qsa(".mini-box", photo).forEach(function (b, i) {
      var box = r.doodles[i].box;
      b.style.left = (box.x / r.photo.w * 100) + "%";
      b.style.top = (box.y / r.photo.h * 100) + "%";
      b.style.width = (box.w / r.photo.w * 100) + "%";
      b.style.height = (box.h / r.photo.h * 100) + "%";
    });
    markMini();
  }
  function markMini() {
    qsa("#miniPhoto .mini-box").forEach(function (b, i) { b.classList.toggle("is-picked", i === S.index); });
  }

  function onMiniTap(ev) {
    var r = S.result;
    if (!r || S.picking) return;
    var rect = $("miniPhoto").getBoundingClientRect();
    var x = (ev.clientX - rect.left) / rect.width * r.photo.w;
    var y = (ev.clientY - rect.top) / rect.height * r.photo.h;
    var idx = -1;
    try { idx = DA.cleanup.doodleAt(r, x, y); } catch (e) { idx = -1; }
    if (idx < 0) {
      // be forgiving: the nearest doodle box that is close enough
      var best = Infinity;
      var pad = Math.max(r.photo.w, r.photo.h) * 0.04;
      r.doodles.forEach(function (d, i) {
        var b = d.box;
        if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
          var dist = Math.abs(x - (b.x + b.w / 2)) + Math.abs(y - (b.y + b.h / 2));
          if (dist < best) { best = dist; idx = i; }
        }
      });
    }
    if (idx >= 0 && idx !== S.index) pickDoodle(idx);
  }

  async function pickDoodle(i) {
    if (S.picking || !S.result || i === S.index) return;
    S.picking = true;
    var job = S.job;
    try {
      var prepared = await DA.animate.prepare(S.result.doodles[i]);
      var scene = await DA.compose.createScene(prepared, S.settings);
      if (job !== S.job) return;
      S.index = i;
      S.prepared = prepared;
      S.scene = scene;
      S.queue = Promise.resolve();
      if (S.preview) {
        S.preview.setScene(scene);
        if (devT != null) S.preview.freeze(devT);
      } else {
        startEditorPreview();
      }
      markMini();
      syncControls();
      scheduleRender(600);
    } catch (e) {
      if (W.console) console.warn(e);
      toast("That one wouldn't budge. Try another?");
    } finally {
      S.picking = false;
    }
  }

  /* ---------- the video makes itself ---------- */

  function setProgress(f) {
    f = Math.max(0, Math.min(1, +f || 0));
    S.progress = f;
    var bar = $("barMaking");
    bar.style.setProperty("--p", String(f));
    var track = $("pencilTrack");
    track.setAttribute("aria-valuenow", String(Math.round(f * 100)));
  }

  /* start (or restart) the background render after `delay` ms. Old results are dropped. */
  function abortRender() {
    if (S.ctrl) { try { S.ctrl.abort(); } catch (e) { /* ignore */ } S.ctrl = null; }
  }

  function scheduleRender(delay) {
    if (!S.scene) return;
    S.renderToken += 1;
    abortRender();
    clearTimeout(S.renderTimer);
    S.phase = "making";
    S.devMaking = false;
    S.videoFile = null;
    S.stickerFile = null;
    S.fail = null;
    setProgress(0);
    renderBar();
    var token = S.renderToken;
    S.renderTimer = setTimeout(function () { runRender(token); }, delay || 0);
  }

  function runRender(token) {
    var scene = S.scene;
    if (!scene || token !== S.renderToken) return;
    // one render at a time: wait for any earlier one to finish, then check this one is still wanted
    var p = S.rendering.then(async function () {
      if (token !== S.renderToken || scene !== S.scene) return;
      setProgress(0);
      var video = null;
      var err = null;
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      S.ctrl = ctrl;
      try {
        video = await DA.export.makeVideo(scene, {
          onProgress: function (f) { if (token === S.renderToken) setProgress(f); },
          signal: ctrl ? ctrl.signal : undefined
        });
      } catch (e) {
        if (e && e.code === "cancelled") return;
        err = normalizeError(e);
      }
      if (S.ctrl === ctrl) S.ctrl = null;
      if (token !== S.renderToken) return;
      if (video && !err) {
        S.videoFile = video;
        S.phase = "ready";
        setShareMode();
        renderBar();
        try {
          var sticker = await DA.export.makeSticker(scene);
          if (token === S.renderToken) { S.stickerFile = sticker; renderBar(); }
        } catch (e2) { /* the sticker link just stays hidden */ }
        return;
      }
      if (!err) err = { code: "video-failed", title: "The video didn't work out.", detail: "Give it another go." };
      S.fail = err;
      if (err.code === "video-unsupported") {
        S.phase = "nosupport";
        try { S.stickerFile = await DA.export.makeSticker(scene); } catch (e3) { S.stickerFile = null; }
        if (token !== S.renderToken) return;
      } else {
        S.phase = "failed";
      }
      renderBar();
    });
    S.rendering = p.catch(function () { /* never break the chain */ });
  }

  function setShareMode() {
    var can = false;
    try { can = !!DA.share.canShare(S.videoFile); } catch (e) { can = false; }
    S.shareMode = (S.forceShareUI || can) ? "share" : "save";
  }

  function shareTip() {
    if (S.shareMode === "save") return "Then post it: Instagram, New story, pick it from your gallery.";
    return "Pick Instagram, then Story.";
  }

  function renderBar() {
    var p = S.phase;
    $("barMaking").hidden = p !== "making";
    $("barDone").hidden = p !== "ready";
    $("barFail").hidden = !(p === "nosupport" || p === "failed");
    if (p === "ready") {
      var save = S.shareMode === "save";
      $("shareLabel").textContent = save ? "Save video" : "Share to your story";
      $("shareIcon").innerHTML = decor() ? DA.decor.icon(save ? "save" : "share") : "";
      $("btnSaveVideo").hidden = save;
      $("btnSaveSticker").hidden = !S.stickerFile;
      $("shareTip").textContent = shareTip();
    }
    if (p === "nosupport" || p === "failed") {
      var f = S.fail || { title: "The video didn't work out.", detail: "Give it another go." };
      $("failTitle").textContent = f.title;
      $("failDetail").textContent = f.detail;
      $("failDetail").hidden = !f.detail;
      var btn = $("btnFail");
      if (p === "nosupport" && S.stickerFile) btn.textContent = "Save doodle only";
      else if (p === "nosupport") btn.textContent = "Back to my doodle";
      else btn.textContent = "Try again";
    }
    updateScreenName();
  }

  /* ---------- sharing and saving: always called straight from a tap, with the file already made ---------- */

  function runShare(file, mode, kind) {
    var promise;
    try {
      promise = mode === "share" ? DA.share.share(file) : DA.share.save(file);
    } catch (e) {
      promise = Promise.resolve("failed");
    }
    Promise.resolve(promise).then(
      function (r) { afterShare(r, mode, kind); },
      function () { afterShare("failed", mode, kind); }
    );
  }

  function afterShare(result, mode, kind) {
    if (result === "cancelled") return;
    if (result === "failed") {
      toast(mode === "share"
        ? "Sharing didn't open. Tap Save to your phone, then post it from your gallery."
        : "That didn't save. Give it another tap.");
      return;
    }
    if (mode === "share") toast("Sent! Someone's about to smile.");
    else if (result === "saved") toast(kind === "sticker" ? "Doodle saved." : "Saved. Now post it from your gallery.");
    else toast("All set.");
    maybeShowA2hs(false);
  }

  /* ---------- add to home screen: one quiet line ---------- */

  var a2hsTimer = 0;
  function hideA2hs() {
    clearTimeout(a2hsTimer);
    var line = $("a2hsLine");
    if (line) line.hidden = true;
  }

  function maybeShowA2hs(force) {
    if (!force && (prefs.a2hsDismissed || S.a2hsShown || isStandalone())) return;
    var plat = platform();
    if (!force && plat === "desktop" && !S.deferredPrompt) return;
    S.a2hsShown = true;
    var text;
    var install = $("a2hsInstall");
    install.hidden = true;
    if (S.deferredPrompt) {
      text = "Next time it's one tap. Add Doodle Alive to your home screen.";
      install.hidden = false;
    } else if (plat === "android") {
      text = "Next time it's one tap: open the browser menu, then Add to Home screen.";
    } else {
      text = "Next time it's one tap: tap Share, then Add to Home Screen.";
    }
    $("a2hsText").textContent = text;
    setTimeout(function () {
      $("a2hsLine").hidden = false;
      updateScreenName();
      if (!force) a2hsTimer = setTimeout(function () { hideA2hs(); updateScreenName(); }, 10000);   // floats for 10 s, then goes (not counted as "dismissed")
    }, force ? 0 : 900);
  }

  function dismissA2hs() {
    prefs.a2hsDismissed = true;
    savePrefs();
    hideA2hs();
    updateScreenName();
  }

  /* ---------- the add text sheet ---------- */

  var textTimer = 0;
  var sheetOpen = false;

  function openSheet() {
    if (!S.scene) return;
    var sheet = $("textSheet");
    var back = $("sheetBackdrop");
    var input = $("textInput");
    input.value = S.settings.text || "";
    updateCount();
    back.hidden = false;
    sheet.hidden = false;
    void sheet.offsetWidth;
    back.classList.add("open");
    sheet.classList.add("open");
    sheetOpen = true;
    try { input.focus(); } catch (e) { /* ignore */ }
  }

  function flushText() {
    clearTimeout(textTimer);
    var v = clampText($("textInput").value);
    if (S.scene && v !== S.settings.text) change({ text: v });
  }

  function closeSheet(immediate) {
    if (!sheetOpen && !immediate) return;
    flushText();
    sheetOpen = false;
    var sheet = $("textSheet");
    var back = $("sheetBackdrop");
    sheet.classList.remove("open");
    back.classList.remove("open");
    var finish = function () {
      if (!sheetOpen) { sheet.hidden = true; back.hidden = true; }
    };
    if (immediate) finish(); else setTimeout(finish, 240);
    try { $("textInput").blur(); } catch (e) { /* ignore */ }
  }

  function updateCount() {
    $("textCount").textContent = Array.from($("textInput").value).length + "/" + textLimits().chars;
  }

  function onTextInput() {
    var input = $("textInput");
    var v = clampText(input.value);
    if (v !== input.value) input.value = v;
    updateCount();
    clearTimeout(textTimer);
    textTimer = setTimeout(function () { if (S.scene) change({ text: v }); }, 160);
  }

  /* keep the sheet above the on-screen keyboard */
  function wireKeyboard() {
    var vv = W.visualViewport;
    if (!vv) return;
    var upd = function () {
      var kb = Math.max(0, W.innerHeight - vv.height - vv.offsetTop);
      D.documentElement.style.setProperty("--kb", kb + "px");
    };
    vv.addEventListener("resize", upd);
    vv.addEventListener("scroll", upd);
  }

  /* ---------- address shortcut screens ---------- */

  function fakeFile(name, type) {
    try { return new File([new Uint8Array([0])], name, { type: type }); } catch (e) { return null; }
  }

  function applyDev() {
    var d = S.dev;
    S.dev = null;
    if (!d) return;
    S.noAuto = true;
    if (d === "making") {
      S.phase = "making";
      S.devMaking = true;
      setProgress(0.55);
    } else if (d === "done" || d === "a2hs") {
      S.forceShareUI = true;
      S.videoFile = fakeFile("doodle-alive-preview.mp4", "video/mp4");
      S.stickerFile = fakeFile("doodle-alive-doodle.png", "image/png");
      S.phase = "ready";
      S.shareMode = "share";
      if (d === "a2hs") maybeShowA2hs(true);
    } else if (d === "error-video") {
      S.fail = { code: "video-unsupported", title: "This browser can't make videos.", detail: "You can still save your doodle on its own!" };
      S.stickerFile = fakeFile("doodle-alive-doodle.png", "image/png");
      S.phase = "nosupport";
    } else {
      S.noAuto = false;
    }
    renderBar();
  }

  var DEV_ERRORS = {
    "error-no-doodle": { code: "no-doodle", title: "Hmm, I couldn't find a doodle.", detail: "Try darker pen, more light, or get a bit closer." },
    "error-heic": { code: "heic", title: "Your phone saved this in a format I can't read.", detail: "Take a screenshot of it and use that." }
  };

  async function devFrame() {
    var job = ++S.job;
    try {
      var img = await DA.sample.load();
      var res = await DA.cleanup.findDoodles(img);
      if (!res || !res.ok) throw res && res.error;
      var prep = await DA.animate.prepare(res.doodles[0]);
      var scene = await DA.compose.createScene(prep, S.settings);
      if (job !== S.job) return;
      S.scene = scene;
      D.documentElement.classList.add("frame-only");
      var ctx = $("frameCanvas").getContext("2d");
      scene.drawFrame(ctx, devT == null ? 3 : devT, 1);
      dbg.screen = "frame";
      S.screen = "frame";
      D.body.setAttribute("data-screen", "frame");
      syncDebug();
      dbg.screen = "frame";
    } catch (e) {
      D.documentElement.classList.remove("frame-only");
      showError(e);
    }
  }

  /* ---------- wiring ---------- */

  function footerHTML() {
    return '<footer class="site-footer"><p class="more-from">More from ' + esc(MAKER_NAME) + '</p>' +
      '<a class="sib-card" href="' + esc(SIBLING.url) + '" target="_blank" rel="noopener">' +
      '<span class="sib-ico" aria-hidden="true">Aa</span>' +
      '<span class="sib-text"><strong>' + esc(SIBLING.name) + '</strong><span>' + esc(SIBLING.blurb) + '</span></span></a></footer>';
  }

  function fillStatic() {
    var d = decor();
    if (d) d.mount(D);
    qsa("[data-footer]").forEach(function (el) { el.innerHTML = footerHTML(); });
    qsa("[data-icon]").forEach(function (el) { el.innerHTML = d ? d.icon(el.getAttribute("data-icon")) : ""; });
    qsa("[data-squiggle]").forEach(function (el) { el.innerHTML = d ? d.squiggle(d.colors.pink) : ""; });
    qsa("[data-arrow]").forEach(function (el) { el.innerHTML = d ? d.arrow(d.colors.cyan) : ""; });
    qsa("[data-pencil]").forEach(function (el) { el.innerHTML = d ? d.pencil() : ""; });
    qsa("[data-art]").forEach(function (el) { el.innerHTML = d ? d.sad() : ""; });
  }

  function wire() {
    $("btnSnap").addEventListener("click", function () { if (ensureEngine()) $("cameraInput").click(); });
    $("btnChoose").addEventListener("click", function () { if (ensureEngine()) $("galleryInput").click(); });
    $("btnSample").addEventListener("click", trySample);
    $("brokenBtn").addEventListener("click", function () { W.location.reload(); });

    ["cameraInput", "galleryInput"].forEach(function (id) {
      var input = $(id);
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        input.value = "";
        if (f) handleFile(f);
      });
    });

    $("btnNew").addEventListener("click", goLanding);
    $("miniPhoto").addEventListener("click", onMiniTap);
    $("btnText").addEventListener("click", openSheet);
    $("textDone").addEventListener("click", function () { closeSheet(false); });
    $("sheetBackdrop").addEventListener("click", function () { closeSheet(false); });
    $("textClear").addEventListener("click", function () {
      $("textInput").value = "";
      updateCount();
      flushText();
      try { $("textInput").focus(); } catch (e) { /* ignore */ }
    });
    $("textInput").addEventListener("input", onTextInput);
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheetOpen) closeSheet(false); });

    // Share and save: the file is already made; these call the engine straight from the tap.
    $("btnShare").addEventListener("click", function () {
      var file = S.videoFile;
      if (!file) return;
      if (S.shareMode === "share") runShare(file, "share", "video");
      else runShare(file, "save", "video");
    });
    $("btnSaveVideo").addEventListener("click", function () {
      if (S.videoFile) runShare(S.videoFile, "save", "video");
    });
    $("btnSaveSticker").addEventListener("click", function () {
      if (S.stickerFile) runShare(S.stickerFile, "save", "sticker");
    });
    $("btnFail").addEventListener("click", function () {
      if (S.phase === "nosupport") {
        if (S.stickerFile) runShare(S.stickerFile, "save", "sticker");
        else toast("Pick a new doodle and try again.");
      } else {
        scheduleRender(0);
      }
    });
    $("btnMaking").addEventListener("click", function () {
      toast("Hang on, your video is almost ready.");
    });

    $("a2hsClose").addEventListener("click", dismissA2hs);
    $("a2hsInstall").addEventListener("click", function () {
      var ev = S.deferredPrompt;
      if (!ev) return;
      try {
        ev.prompt();
        if (ev.userChoice) ev.userChoice.then(function () { S.deferredPrompt = null; dismissA2hs(); });
      } catch (e) { S.deferredPrompt = null; }
    });
    W.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); S.deferredPrompt = e; });
    W.addEventListener("appinstalled", function () { prefs.a2hsDismissed = true; savePrefs(); hideA2hs(); });

    // paste and drag-and-drop
    D.addEventListener("paste", function (e) {
      if (sheetOpen || !engineOk || S.screen === "working") return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); handleFile(f); return; }
        }
      }
    });
    D.addEventListener("dragover", function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) {
        e.preventDefault();
        D.body.classList.add("dragging");
      }
    });
    D.addEventListener("dragleave", function (e) {
      if (!e.relatedTarget) D.body.classList.remove("dragging");
    });
    D.addEventListener("drop", function (e) {
      D.body.classList.remove("dragging");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (S.screen !== "working") handleFile(f);
    });

    // keep the story card fitted
    var stage = $("stage");
    if ("ResizeObserver" in W) new ResizeObserver(fitStory).observe(stage);
    W.addEventListener("resize", fitStory);
    wireKeyboard();
  }

  /* ---------- service worker (never on localhost) ---------- */

  function registerSW() {
    if (!("serviceWorker" in W.navigator)) return;
    var h = location.hostname;
    var local = h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    if (local) {
      W.navigator.serviceWorker.getRegistrations()
        .then(function (rs) { rs.forEach(function (r) { r.unregister(); }); })
        .catch(function () { /* ignore */ });
      if (W.caches && W.caches.keys) {
        W.caches.keys()
          .then(function (ks) { ks.filter(function (k) { return k.indexOf("doodle-alive-") === 0; }).forEach(function (k) { W.caches.delete(k); }); })
          .catch(function () { /* ignore */ });
      }
      return;
    }
    W.addEventListener("load", function () {
      W.navigator.serviceWorker.register("sw.js").catch(function () { /* the site works without it */ });
    });
  }

  /* ---------- start ---------- */

  function boot() {
    loadPrefs();
    fillStatic();
    wire();
    registerSW();
    S.settings = initialSettings();

    // states that don't need the engine
    if (devScreen && devScreen.indexOf("error-") === 0 && devScreen !== "error-video") {
      showError(DEV_ERRORS[devScreen] || { code: devScreen.slice(6), title: "Hmm, that didn't work.", detail: "Give it another go." });
      return;
    }
    if (devScreen === "landing") {
      showScreen("landing");
      startHeroSoon();
      return;
    }
    if (!engineOk) {
      showScreen("broken");
      return;
    }
    if (DA.export && DA.export.support) {
      try { DA.export.support().then(function (s) { S.support = s; }, function () { /* ignore */ }); } catch (e) { /* ignore */ }
    }
    if (devScreen === "frame") { devFrame(); return; }
    var editorish = ["editor", "making", "done", "a2hs", "error-video"];
    if (Q.get("sample") === "1" || editorish.indexOf(devScreen) !== -1) {
      S.dev = devScreen || "editor";
      handleImage(function () { return DA.sample.load(); }, null);
      return;
    }
    showScreen("landing");
    startHeroSoon();
  }

  boot();
})();
