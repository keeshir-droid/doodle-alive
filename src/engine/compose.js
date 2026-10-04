// The scene (one doodle + settings), the story layout and the live preview player.
//
//   DA.compose.createScene(prepared, settings) -> Promise<Scene>
//   DA.compose.FONTS / TEXT_MAX_CHARS / TEXT_MAX_LINES / STORY / DEFAULTS
//   DA.compose.startPreview(canvas, scene) -> Preview        (DA.compose.Preview is the class)
//
// One drawing function for everything: scene.drawFrame(ctx, t, scale). The preview and the video both call it.
// A scene keeps its settings and its cached layer in an immutable "state" object that update() swaps for a new one, so an export
// that took a snapshot (scene._snapshot()) can never be disturbed by a later change.
//
// Layer order: cached static layer (background, text, mark; DA.backgrounds.draw) -> white die-cut outline with a soft shadow ->
// ink. Only the doodle moves. All the story coordinates below are logical (1080 x 1920) pixels.
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});
  const U = function () { return DA.util; };

  const STORY = { w: 1080, h: 1920, fps: 30, duration: 6, introEnd: 1 };
  const FONTS = [
    { id: "caveat", name: "Caveat", family: "Caveat" },
    { id: "fredoka", name: "Fredoka", family: "Fredoka" },
    { id: "pacifico", name: "Pacifico", family: "Pacifico" }
  ];
  const FONT_STYLE = {
    caveat: { weight: 600, fallback: '"Segoe Print", "Bradley Hand", cursive' },
    fredoka: { weight: 600, fallback: '"Trebuchet MS", system-ui, sans-serif' },
    pacifico: { weight: 400, fallback: '"Brush Script MT", cursive' }
  };
  const TEXT_MAX_CHARS = 40, TEXT_MAX_LINES = 2;
  const DEFAULTS = { background: "collage", motion: "wiggle", ink: "auto", outline: "auto", text: "", font: "caveat" };
  const MARK_TEXT = "made with doodle-alive.vercel.app";

  // ---------- stand-in backgrounds (only used while DA.backgrounds is missing; same shape as ENGINE.md section 4b) ----------
  let STANDIN = null;
  function standin() {
    if (STANDIN) return STANDIN;
    const rows = [
      ["notebook", "Notebook", false, "#24345E", "#FBF6E6"], ["gingham", "Gingham", true, "#8E2440", "#FBD3E4"],
      ["wavy-checks", "Wavy checks", true, "#24203A", "#CDBDF2"], ["graph", "Graph paper", false, "#1F5A44", "#D8F1E4"],
      ["dot-journal", "Dot journal", false, "#3A2A1E", "#FDECB0"], ["polaroid", "Polaroid", false, "#24203A", "#C9A27A"],
      ["strawberries", "Strawberries", true, "#B3263E", "#FBD3E4"], ["collage", "Collage", false, "#24203A", "#FBF7EE"],
      ["watercolour", "Watercolour sparkle", false, "#4A2E5C", "#EDE3FA"], ["night-neon", "Night neon", false, "#FFFFFF", "#1F2A4A"]
    ];
    const LIST = rows.map(function (r) {
      return {
        id: r[0], name: r[1], busy: r[2], ink: r[3], textColor: r[3], base: r[4],
        doodleBox: { x: 120, y: 430, w: 840, h: 900 }, doodleBoxWithText: { x: 120, y: 370, w: 840, h: 880 },
        text: { x: 120, y: 1300, w: 840, h: 160, align: "center", style: "plain" },
        mark: { x: 590, y: 1495, w: 400, h: 40, plate: false },
        outlineAuto: r[0] === "watercolour"
      };
    });
    function draw(ctx, id, opts) {
      const b = LIST.filter(function (x) { return x.id === id; })[0] || LIST[0];
      ctx.save();
      ctx.fillStyle = b.base; ctx.fillRect(0, 0, STORY.w, STORY.h);
      if (opts && opts.hasText) { ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(b.text.x, b.text.y, b.text.w, b.text.h); }
      ctx.restore();
    }
    function thumbnail(id, w, h) {
      const c = U().createCanvas(w, h), x = c.getContext("2d");
      x.scale(w / STORY.w, h / STORY.h); draw(x, id, {});
      return c;
    }
    STANDIN = { LIST: LIST, draw: draw, thumbnail: thumbnail, standin: true };
    return STANDIN;
  }
  function BG() {
    const b = DA.backgrounds;
    return (b && b.LIST && b.LIST.length && typeof b.draw === "function") ? b : standin();
  }
  function bgEntry(id) {
    const list = BG().LIST;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    for (let i = 0; i < list.length; i++) if (list[i].id === DEFAULTS.background) return list[i];
    return list[0];
  }

  // ---------- settings ----------
  function cleanText(s) {
    s = String(s == null ? "" : s).replace(/\r\n?/g, "\n");
    let lines = s.split("\n").map(function (l) { return l.replace(/[ \t]+/g, " ").trim(); }).filter(function (l) { return l.length; });
    lines = lines.slice(0, TEXT_MAX_LINES);
    let left = TEXT_MAX_CHARS;
    const out = [];
    for (let i = 0; i < lines.length && left > 0; i++) {
      const chars = Array.from(lines[i]);
      const take = chars.slice(0, left);
      out.push(take.join("").trim());
      left -= take.length;
    }
    return out.filter(function (l) { return l.length; }).join("\n");
  }
  function fillSettings(partial, base) {
    const s = Object.assign({}, base || DEFAULTS);
    if (partial) Object.keys(DEFAULTS).forEach(function (k) { if (partial[k] !== undefined && partial[k] !== null) s[k] = partial[k]; });
    s.background = bgEntry(s.background).id;
    if (!MOTIONS_BY_ID(s.motion)) s.motion = DEFAULTS.motion;
    if (s.ink !== "original") s.ink = "auto";
    if (s.outline !== "on" && s.outline !== "off") s.outline = "auto";
    if (!FONT_STYLE[s.font]) s.font = DEFAULTS.font;
    s.text = cleanText(s.text);
    return s;
  }
  function MOTIONS_BY_ID(id) {
    const m = (DA.animate && DA.animate.MOTIONS) || [];
    for (let i = 0; i < m.length; i++) if (m[i].id === id) return true;
    return false;
  }
  function resolve(settings, bg, prep) {
    const outline = settings.outline === "on" ? true : (bg.busy ? true : (settings.outline === "off" ? false : !!bg.outlineAuto));
    const ink = settings.ink === "original" ? (prep.inkColor || bg.ink) : bg.ink;
    return { ink: ink, outline: outline };
  }

  // ---------- fonts ----------
  const delay = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  async function ensureFonts(fontId, text) {
    if (typeof document === "undefined" || !document.fonts || !document.fonts.load) return;
    const jobs = [];
    const f = FONTS.filter(function (x) { return x.id === fontId; })[0] || FONTS[0];
    if (text) jobs.push(document.fonts.load(FONT_STYLE[f.id].weight + " 48px " + f.family, text));
    jobs.push(document.fonts.load("600 24px Fredoka", MARK_TEXT));
    try { await Promise.race([Promise.all(jobs), delay(3000)]); } catch (e) { /* use the fallback font */ }
  }
  function fontString(fontId, size) {
    const f = FONTS.filter(function (x) { return x.id === fontId; })[0] || FONTS[0], st = FONT_STYLE[f.id];
    return st.weight + " " + Math.round(size) + "px " + f.family + ", " + st.fallback;
  }

  // ---------- text layout ----------
  // Text is fitted by its real ink (the measured top of the tallest letter and bottom of the lowest tail), not by a nominal line
  // height, so tall-ascender fonts like Pacifico get the same breathing room as the others.
  const LABEL_PAD = 28;                       // clear space between the ink and the label edge (the dashed border sits 13 px in)
  const LABEL_W = 760;                        // widest line inside a label (label is 880 wide)
  function labelled(bg) { return bg.text.style === "label" || bg.id === "graph"; }   // these draw a plate under the text
  // vertical centre of the text block; the two-line label sits 8 px higher than the one-line one (see labelRect in backgrounds.js)
  function textCenterY(bg, n) { const z = bg.text; return z.y + z.h / 2 - (labelled(bg) && n >= 2 ? 8 : 0); }
  function availHeight(bg, n) { return labelled(bg) ? (n >= 2 ? 196 : 150) - 2 * LABEL_PAD : (bg.text.style === "strip" ? bg.text.h - 50 : bg.text.h); }
  function maxWidth(bg) { return labelled(bg) ? LABEL_W : (bg.text.style === "strip" ? bg.text.w - 100 : bg.text.w); }   // the strip has tape in its corners

  function lineInk(ctx, line, size) {
    const m = ctx.measureText(line);
    const asc = typeof m.actualBoundingBoxAscent === "number" ? m.actualBoundingBoxAscent : size * 0.85;
    const desc = typeof m.actualBoundingBoxDescent === "number" ? m.actualBoundingBoxDescent : size * 0.28;
    return { w: m.width, asc: Math.max(asc, size * 0.3), desc: Math.max(desc, 0) };
  }
  function layoutText(ctx, text, bg, fontId) {
    const zone = bg.text, style = zone.style;
    const lines0 = text.split("\n");
    const cands = [lines0];
    if (lines0.length === 1) {
      const words = lines0[0].split(" ");
      if (words.length > 1) { // best two-line split: the most even by length
        let best = 1, bestDiff = Infinity;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
          if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
        }
        cands.push([words.slice(0, best).join(" "), words.slice(best).join(" ")]);
      }
    }
    const ruled = style === "lines";                 // notebook: text sits on rules 80 px apart (zone.y, +80, +160)
    const maxW = maxWidth(bg);
    const maxSize = Math.min(120, zone.h * 0.84);
    let last = null;
    for (let size = maxSize; size >= 22; size -= 2) {
      ctx.font = fontString(fontId, size);
      for (let c = 0; c < cands.length; c++) {
        const L = cands[c], n = L.length;
        if (ruled && n === 2 && size > 62) continue;
        const ink = L.map(function (l) { return lineInk(ctx, l, size); });
        let wmax = 0;
        for (let i = 0; i < n; i++) wmax = Math.max(wmax, ink[i].w);
        let lh = size * 1.1;
        if (n === 2) lh = Math.max(lh, ink[0].desc + ink[1].asc + size * 0.08);   // a tail on line 1 must not reach a tall letter on line 2
        if (ruled && n === 2) lh = 80;
        // ink block: top of the first line's tallest letter to the bottom of the last line's lowest tail
        const top = ink[0].asc, bottom = (n - 1) * lh + ink[n - 1].desc, blockH = top + bottom;
        last = { lines: L, size: size, lh: lh, ruled: ruled, top: top, blockH: blockH };
        if (wmax <= maxW && (ruled ? n * lh <= zone.h : blockH <= availHeight(bg, n))) return last;
      }
    }
    return last || { lines: cands[cands.length - 1], size: 22, lh: 25, ruled: ruled, top: 20, blockH: 30 };
  }
  function drawText(ctx, text, bg, fontId, lay) {
    const z = bg.text;
    ctx.save();
    ctx.font = fontString(fontId, lay.size);
    ctx.fillStyle = bg.textColor || bg.ink;
    ctx.textAlign = "center";
    const cx = z.x + z.w / 2, n = lay.lines.length, maxW = maxWidth(bg);
    if (lay.ruled) { // written on the ruled lines: baseline a little above the rule
      ctx.textBaseline = "alphabetic";
      if (n === 1) ctx.fillText(lay.lines[0], cx, z.y + z.h - Math.round(lay.size * 0.2) - 6, maxW);
      else for (let i = 0; i < n; i++) ctx.fillText(lay.lines[i], cx, z.y + 80 * (i + 1) - 16, maxW);
    } else {
      ctx.textBaseline = "alphabetic";
      const y0 = textCenterY(bg, n) - lay.blockH / 2 + lay.top;   // baseline of line 1 so the ink block is centred
      for (let i = 0; i < n; i++) ctx.fillText(lay.lines[i], cx, y0 + i * lay.lh, maxW);
    }
    ctx.restore();
  }
  // the made-with mark: small, right-aligned at x = 990 (zone.x + zone.w), quiet; a touch stronger where the background is dark or mottled
  const MARK_ALPHA = { "night-neon": 0.7, "watercolour": 0.7 };
  function drawMark(ctx, bg) {
    const m = bg.mark || { x: 590, y: 1495, w: 400, h: 40, plate: false };
    ctx.save();
    ctx.font = "600 24px Fredoka, " + FONT_STYLE.fredoka.fallback;
    ctx.fillStyle = bg.textColor || bg.ink;
    ctx.globalAlpha = MARK_ALPHA[bg.id] || (m.plate ? 0.8 : 0.6);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(MARK_TEXT, m.x + m.w, m.y + m.h / 2, m.w);
    ctx.restore();
  }

  async function buildLayer(bg, settings) {
    const api = BG();
    await ensureFonts(settings.font, settings.text);
    const canvas = U().createCanvas(STORY.w, STORY.h);
    const ctx = canvas.getContext("2d");
    const hasText = settings.text.length > 0;
    let lay = null;
    if (hasText) lay = layoutText(ctx, settings.text, bg, settings.font);
    api.draw(ctx, bg.id, { hasText: hasText, textLines: lay ? lay.lines.slice() : [], markPlate: !!(bg.mark && bg.mark.plate) });
    if (hasText) drawText(ctx, settings.text, bg, settings.font, lay);
    drawMark(ctx, bg);
    return canvas;
  }

  // ---------- where the doodle sits ----------
  const BOX = { x: 120, y: 430, w: 840, h: 900 }, BOX_T = { x: 120, y: 370, w: 840, h: 880 };
  function makeGeom(prep, bg, hasText) {
    const box = hasText ? (bg.doodleBoxWithText || BOX_T) : (bg.doodleBox || BOX);
    const T = prep.T0 || 18;                       // the outline fits inside the box too
    const iw = Math.max(1, prep.bbox.x1 - prep.bbox.x0), ih = Math.max(1, prep.bbox.y1 - prep.bbox.y0);
    const F = Math.max(0.01, Math.min((box.w - 2 * T) / iw, (box.h - 2 * T) / ih));
    return {
      F: F, bx: box.x + box.w / 2, by: box.y + box.h / 2,
      mcx: (prep.bbox.x0 + prep.bbox.x1) / 2, mcy: (prep.bbox.y0 + prep.bbox.y1) / 2,
      w: iw * F, h: ih * F, T: T
    };
  }

  // ---------- drawing ----------
  function applyPose(ctx, g, ps) {
    const ax = g.bx, ay = ps.anchor === "b" ? g.by + g.h / 2 : g.by;
    ctx.translate(ax + ps.dx, ay + ps.dy);
    if (ps.rot) ctx.rotate(ps.rot);
    if (ps.sx !== 1 || ps.sy !== 1) ctx.scale(ps.sx, ps.sy);
    ctx.translate(-ax, -ay);
  }
  function applyLocal(ctx, g) { ctx.translate(g.bx, g.by); ctx.scale(g.F, g.F); ctx.translate(-g.mcx, -g.mcy); }
  function tracePolys(c, arr, ends) {
    c.beginPath();
    let a = 0;
    for (let l = 0; l < ends.length; l++) {
      const e = ends[l];
      c.moveTo(arr[a * 2], arr[a * 2 + 1]);
      for (let i = a + 1; i < e; i++) c.lineTo(arr[i * 2], arr[i * 2 + 1]);
      c.closePath();
      a = e;
    }
  }
  function fillShape(c, state, kind, ps, vi, rv) {
    const A = DA.animate, prep = state.prep;
    if (ps.jelly) {
      const arr = rv.scratch[kind] = A.jellyPoints(prep, kind, vi, ps, state.geom.F, rv.scratch[kind]);
      tracePolys(c, arr, prep[kind].ends);
      c.fill("evenodd");
      return;
    }
    const p = A.path(prep, kind, vi);
    if (p) c.fill(p, "evenodd");
    else { tracePolys(c, prep[kind].variants[vi], prep[kind].ends); c.fill("evenodd"); }
  }

  function makeReveals() { return { ink: null, sil: null, scratch: { ink: null, sil: null }, tmp: null }; }

  function layerFor(state, S) {
    if (S >= 0.995) return state.layer;
    const w = Math.max(1, Math.round(STORY.w * S)), h = Math.max(1, Math.round(STORY.h * S));
    let c = state.scaled;
    if (!c || c.width !== w || c.height !== h) {
      c = U().createCanvas(w, h);
      const x = c.getContext("2d");
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
      x.drawImage(state.layer, 0, 0, w, h);
      state.scaled = c;
    }
    return c;
  }

  const SHADOW = { color: "rgba(0,0,0,0.14)", blur: 14, dy: 6 };

  function drawState(state, ctx, t, S, rv) {
    const A = DA.animate, g = state.geom, prep = state.prep;
    S = S > 0 ? S : 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const L = layerFor(state, S);
    ctx.drawImage(L, 0, 0, L.width, L.height, 0, 0, STORY.w * S, STORY.h * S);

    const tn = A.normT(t);
    const ps = A.pose(state.settings.motion, tn, { w: g.w, h: g.h });
    const vi = ps.boil;
    const outline = state.resolved.outline, inkColor = state.resolved.ink;

    if (tn >= STORY.introEnd) {
      ctx.setTransform(S, 0, 0, S, 0, 0);
      applyPose(ctx, g, ps);
      if (outline) {
        ctx.save();
        applyLocal(ctx, g);
        ctx.shadowColor = SHADOW.color; ctx.shadowBlur = SHADOW.blur * S; ctx.shadowOffsetY = SHADOW.dy * S;
        ctx.fillStyle = "#ffffff";
        fillShape(ctx, state, "sil", ps, vi, rv);
        ctx.restore();
      }
      ctx.save();
      applyLocal(ctx, g);
      ctx.fillStyle = inkColor;
      fillShape(ctx, state, "ink", ps, vi, rv);
      ctx.restore();
    } else {
      // draws itself: each layer is drawn on its own small canvas, cut with the "how far has the pen got" mask, then placed with the pose
      const u = A.introProgress(tn);
      const M = g.T + 44 + (ps.jelly ? ps.jelly.amp : 0);   // room for the outline, its shadow and the jelly sway
      const rx = g.bx - g.w / 2 - M, ry = g.by - g.h / 2 - M, rW = g.w + 2 * M, rH = g.h + 2 * M;
      const tw = Math.max(1, Math.ceil(rW * S)), th = Math.max(1, Math.ceil(rH * S));
      if (!rv.tmp || rv.tmp.width !== tw || rv.tmp.height !== th) { rv.tmp = U().createCanvas(tw, th); }
      const tc = rv.tmp.getContext("2d");
      const pass = function (kind, mask, color, shadow) {
        tc.setTransform(1, 0, 0, 1, 0, 0);
        tc.globalCompositeOperation = "source-over";
        tc.clearRect(0, 0, tw, th);
        tc.save();
        tc.setTransform(S, 0, 0, S, -rx * S, -ry * S);
        applyLocal(tc, g);
        tc.save();
        if (shadow) { tc.shadowColor = SHADOW.color; tc.shadowBlur = SHADOW.blur * S; tc.shadowOffsetY = SHADOW.dy * S; }
        tc.fillStyle = color;
        fillShape(tc, state, kind, ps, vi, rv);
        tc.restore();
        tc.globalCompositeOperation = "destination-in";
        tc.imageSmoothingEnabled = true;
        tc.drawImage(mask.canvas, 0, 0, mask.rw * mask.ds, mask.rh * mask.ds);
        tc.restore();
        ctx.save();
        ctx.setTransform(S, 0, 0, S, 0, 0);
        applyPose(ctx, g, ps);
        ctx.drawImage(rv.tmp, 0, 0, tw, th, rx, ry, tw / S, th / S);
        ctx.restore();
      };
      if (u > 0) {
        if (outline) {
          if (!rv.sil) rv.sil = A.createReveal(prep);
          rv.sil.update(Math.min(1, u + 0.08));   // the outline is drawn slightly ahead of the pen
          pass("sil", rv.sil, "#ffffff", true);
        }
        if (!rv.ink) rv.ink = A.createReveal(prep);
        rv.ink.update(u);
        pass("ink", rv.ink, inkColor, false);
      }
    }
    ctx.restore();
  }

  // ---------- the scene ----------
  class Scene {
    constructor(prep) {
      this._prep = prep;
      this._reveals = null;
      this._state = null;
      this._token = 0;
      this.version = 0;
      this.settings = null;
      this.resolved = null;
    }
    _install(state) {
      this._state = state;
      this.settings = state.settings;
      this.resolved = state.resolved;
      this.version++;
    }
    async _make(settings, oldState) {
      const bg = bgEntry(settings.background);
      const hasText = settings.text.length > 0;
      let layer;
      if (oldState && oldState.settings.background === settings.background && oldState.settings.text === settings.text &&
          oldState.settings.font === settings.font && oldState.bgApi === BG()) layer = oldState.layer;
      else layer = await buildLayer(bg, settings);
      return {
        settings: settings, resolved: resolve(settings, bg, this._prep), bg: bg, bgApi: BG(),
        layer: layer, scaled: null, prep: this._prep, geom: makeGeom(this._prep, bg, hasText)
      };
    }
    update(partial) {
      const next = fillSettings(partial, this._pendingSettings || this.settings);
      this._pendingSettings = next;
      const old = this._state;
      const layerSame = old && old.settings.background === next.background && old.settings.text === next.text && old.settings.font === next.font && old.bgApi === BG();
      const token = ++this._token;
      if (layerSame) { // nothing to rebuild: instant
        const bg = old.bg, hasText = next.text.length > 0;
        this._install({ settings: next, resolved: resolve(next, bg, this._prep), bg: bg, bgApi: old.bgApi, layer: old.layer, scaled: old.scaled, prep: this._prep, geom: makeGeom(this._prep, bg, hasText) });
        return Promise.resolve();
      }
      const self = this;
      return this._make(next, old).then(function (st) {
        if (token === self._token) self._install(st); // a newer update has started: it will install its own
      });
    }
    drawFrame(ctx, t, scale) {
      if (!this._state) return;
      if (!this._reveals) this._reveals = makeReveals();
      drawState(this._state, ctx, t, scale, this._reveals);
    }
    // for the exporter: frozen copy of everything a frame needs, with its own private "draws itself" masks
    _snapshot() {
      const state = this._state, rv = makeReveals();
      return {
        state: state, settings: state.settings, resolved: state.resolved, prep: state.prep,
        drawFrame: function (ctx, t, scale) { drawState(state, ctx, t, scale, rv); }
      };
    }
    _newReveals() { return makeReveals(); }
    _drawWith(rv, ctx, t, scale) { if (this._state) drawState(this._state, ctx, t, scale, rv); }
  }

  async function createScene(prepared, settings) {
    if (!prepared) throw U().error("unreadable");
    const scene = new Scene(prepared);
    const s = fillSettings(settings, DEFAULTS);
    DA.animate.warm(prepared);
    scene._install(await scene._make(s, null));
    scene._pendingSettings = scene.settings;
    return scene;
  }

  // ---------- the live preview ----------
  class Preview {
    constructor(canvas, scene) {
      if (canvas && canvas.__daPreview && canvas.__daPreview !== this) { try { canvas.__daPreview.stop(); } catch (e) { /* already gone */ } }
      this.canvas = canvas;
      this.scene = scene;
      this.stats = { fps: 30, avgMs: 0, frames: 0 };
      this._rv = makeReveals();
      this._stopped = false;
      this._frozen = null;
      this._dirty = true;
      this._ok = false;
      this._needSize = true;
      this._fps = 30;
      this._ema = 0;
      this._last = -1e9;
      this._lastVersion = -1;
      this._t0 = performance.now();
      this._hiddenAt = null;
      canvas.__daPreview = this;
      const self = this;
      this._onVis = function () {
        if (typeof document === "undefined") return;
        const now = performance.now();
        if (document.hidden) self._hiddenAt = now;
        else if (self._hiddenAt != null) { self._t0 += now - self._hiddenAt; self._hiddenAt = null; self._dirty = true; }
      };
      this._onSize = function () { self._needSize = true; };
      document.addEventListener("visibilitychange", this._onVis);
      window.addEventListener("resize", this._onSize);
      if (typeof ResizeObserver !== "undefined") { this._ro = new ResizeObserver(this._onSize); this._ro.observe(canvas); }
      this._bound = function (now) { self._tick(now); };
      this._raf = requestAnimationFrame(this._bound);
      this._drawNow(performance.now());
    }
    setScene(scene) {
      this.scene = scene;
      this._rv = makeReveals();
      this._t0 = performance.now();
      this._dirty = true;
      this._fps = 30; this._gap = 0; this._since = 0;
      this._drawNow(this._t0);
    }
    restart() { this._t0 = performance.now(); this._dirty = true; this._fps = 30; this._gap = 0; this._since = 0; }
    freeze(t) {
      if (t === null || t === undefined) { this._frozen = null; this._t0 = performance.now(); }
      else this._frozen = +t || 0;
      this._dirty = true;
      this._drawNow(performance.now());
    }
    stop() {
      this._stopped = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      document.removeEventListener("visibilitychange", this._onVis);
      window.removeEventListener("resize", this._onSize);
      if (this._ro) { try { this._ro.disconnect(); } catch (e) { /* ignore */ } this._ro = null; }
      if (this.canvas && this.canvas.__daPreview === this) this.canvas.__daPreview = null;
      this._rv = null;
    }
    _size() {
      const c = this.canvas;
      const cw = c.clientWidth || 0, ch = c.clientHeight || 0;
      if (!(cw > 0 && ch > 0)) { this._ok = false; return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(cw * dpr)), H = Math.max(1, Math.round(ch * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this._dirty = true; }
      this._ok = true; this._S = W / STORY.w;
      this._needSize = false;
    }
    _drawNow(now) {
      if (this._stopped) return;
      try {
        if (this._needSize || !this._ok) this._size();
        if (!this._ok) return;
        const sc = this.scene;
        if (!sc || !sc._state) return;
        const t = this._frozen != null ? this._frozen : ((now - this._t0) / 1000) % STORY.duration;
        const ctx = this.canvas.getContext("2d");
        const a = performance.now();
        sc._drawWith(this._rv, ctx, t, this._S);
        const ms = performance.now() - a;
        this._ema = this._ema ? this._ema * 0.9 + ms * 0.1 : ms;
        this.stats.avgMs = this._ema; this.stats.frames++;
        // too slow for 30 fps (drawing takes long, or frames really arrive late): drop to 24. Looked at again after restart / setScene.
        if (this._frozen == null && this._prevDraw) {
          const gap = now - this._prevDraw;
          if (gap > 0 && gap < 500) this._gap = this._gap ? this._gap * 0.9 + gap * 0.1 : gap;
        }
        this._prevDraw = now;
        this._since = (this._since || 0) + 1;
        if (this._fps === 30 && this._since > 20 && (this._ema > 26 || this._gap > 46)) this._fps = 24;
        this.stats.fps = this._fps;
        this._lastVersion = sc.version; this._dirty = false;
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    }
    _tick(now) {
      if (this._stopped) return;
      this._raf = requestAnimationFrame(this._bound);
      if (typeof document !== "undefined" && document.hidden) return;
      if (this._needSize) this._size();
      if (!this._ok) { this._size(); return; }
      if (this._frozen != null) {
        if (this._dirty || (this.scene && this.scene.version !== this._lastVersion)) this._drawNow(now);
        return;
      }
      if (now - this._last < 1000 / this._fps - 3) return;
      this._last = now;
      this._drawNow(now);
    }
  }
  function startPreview(canvas, scene) { return new Preview(canvas, scene); }

  DA.compose = {
    FONTS: FONTS, TEXT_MAX_CHARS: TEXT_MAX_CHARS, TEXT_MAX_LINES: TEXT_MAX_LINES, STORY: STORY, DEFAULTS: DEFAULTS,
    createScene: createScene, startPreview: startPreview, Preview: Preview, Scene: Scene,
    _cleanText: cleanText, _fillSettings: fillSettings, _layoutText: layoutText, _usingStandin: function () { return BG().standin === true; }
  };
})();
