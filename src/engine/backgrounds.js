// The 10 story backgrounds, drawn in code on a 1080x1920 canvas (DESIGN.md section 10, ENGINE.md section 4b).
//
//   DA.backgrounds.LIST                  -> [{ id, name, busy, ink, textColor, doodleBox, doodleBoxWithText, text, mark, outlineAuto }]
//   DA.backgrounds.draw(ctx, id, opts)   -> draws the whole static background (opts: { hasText, textLines, markPlate })
//   DA.backgrounds.thumbnail(id, w, h)   -> a small canvas with the background (no doodle, no text)
//
// Everything is deterministic (seeded random only), uses the plain 2D context only, and touches the
// document only inside functions (so this file loads in Node). Nothing here is copied from the mood
// images in notes/references/: every shape is built from paths, gradients and a tiny dot pattern.
(function () {
  "use strict";
  const DA = (globalThis.DA = globalThis.DA || {});
  const W = 1080, H = 1920, TAU = Math.PI * 2;

  // ------------------------------------------------------------------ the list (public data)
  const DBOX = { x: 120, y: 400, w: 840, h: 900 };      // centre y 850
  const DBOX_T = { x: 120, y: 380, w: 840, h: 880 };    // centre y 820, ends 1260 (text zone starts 1300)
  const TEXT = { x: 120, y: 1300, w: 840, h: 160, align: "center" };
  // the made-with mark: small, right-aligned to x = 990 (the zone is the most the text may use; compose.js draws it, the plate here hugs its width)
  const MARK = { x: 590, y: 1495, w: 400, h: 40 };
  const MARK_TEXT = "made with doodle-alive.vercel.app", MARK_FONT = "600 24px Fredoka, \"Trebuchet MS\", system-ui, sans-serif";

  function copy(o) { return { x: o.x, y: o.y, w: o.w, h: o.h }; }
  function entry(id, name, busy, ink, textColor, style, plate, extra) {
    const e = {
      id: id, name: name, busy: busy, ink: ink, textColor: textColor,
      doodleBox: copy(DBOX), doodleBoxWithText: copy(DBOX_T),
      text: { x: TEXT.x, y: TEXT.y, w: TEXT.w, h: TEXT.h, align: "center", style: style },
      mark: { x: MARK.x, y: MARK.y, w: MARK.w, h: MARK.h, plate: plate },
      outlineAuto: false
    };
    if (extra) for (const k in extra) e[k] = extra[k];
    return e;
  }

  const LIST = [
    entry("notebook", "Notebook", false, "#24345E", "#24345E", "lines", false),
    entry("gingham", "Gingham", true, "#8E2440", "#8E2440", "label", true),
    entry("wavy-checks", "Wavy checks", true, "#24203A", "#24203A", "label", true),
    entry("graph", "Graph paper", false, "#1F5A44", "#1F5A44", "plain", false),
    entry("dot-journal", "Dot journal", false, "#3A2A1E", "#3A2A1E", "plain", false),
    // polaroid: the doodle sits in the square photo, text goes in the white strip under it
    entry("polaroid", "Polaroid", false, "#24203A", "#24203A", "strip", true, {
      doodleBox: { x: 180, y: 360, w: 720, h: 720 },
      doodleBoxWithText: { x: 180, y: 360, w: 720, h: 720 },
      text: { x: 170, y: 1195, w: 740, h: 200, align: "center", style: "strip" }
    }),
    entry("strawberries", "Strawberries", true, "#B3263E", "#B3263E", "label", true),
    entry("collage", "Collage", false, "#24203A", "#24203A", "plain", false),
    entry("watercolour", "Watercolour sparkle", false, "#4A2E5C", "#4A2E5C", "label", false, { outlineAuto: true }),
    entry("night-neon", "Night neon", false, "#FFFFFF", "#FFFFFF", "plain", false)
  ];
  const BY_ID = {};
  LIST.forEach(function (b) { BY_ID[b.id] = b; });

  // ------------------------------------------------------------------ small helpers
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mkCanvas(w, h) {
    if (typeof document !== "undefined" && document.createElement) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    return null;
  }
  function scaleOf(ctx) {
    try {
      if (ctx.getTransform) {
        const m = ctx.getTransform();
        const s = Math.hypot(m.a, m.b);
        if (s > 0 && isFinite(s)) return s;
      }
    } catch (e) { /* fall through */ }
    return 1;
  }
  // shadow sizes are in device pixels, so scale them with the drawing (matters for thumbnails)
  function shadow(ctx, color, blur, dy) {
    const k = scaleOf(ctx);
    ctx.shadowColor = color; ctx.shadowBlur = blur * k; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = dy * k;
  }
  function noShadow(ctx) { ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function starPath(ctx, cx, cy, ro, ri, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (rot || 0) + i * Math.PI / n - Math.PI / 2;
      const rad = i % 2 ? ri : ro;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  // the little concave 4-point sparkle
  function sparkPath(ctx, x, y, r, k) {
    k = k || 0.16;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + r * k, y - r * k, x + r, y);
    ctx.quadraticCurveTo(x + r * k, y + r * k, x, y + r);
    ctx.quadraticCurveTo(x - r * k, y + r * k, x - r, y);
    ctx.quadraticCurveTo(x - r * k, y - r * k, x, y - r);
    ctx.closePath();
  }
  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.95);
    ctx.bezierCurveTo(x - s * 1.35, y + s * 0.1, x - s * 1.0, y - s * 1.0, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 1.0, y - s * 1.0, x + s * 1.35, y + s * 0.1, x, y + s * 0.95);
    ctx.closePath();
  }
  function circlePath(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function fillSpark(ctx, x, y, r, color) { sparkPath(ctx, x, y, r); ctx.fillStyle = color; ctx.fill(); }

  function vignette(ctx, inner, outer, r0, r1) {
    const g = ctx.createRadialGradient(W / 2, H / 2, r0 || 420, W / 2, H / 2, r1 || 1250);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // a slightly wobbly hand-ruled line
  function wobbleLine(ctx, x0, y0, x1, y1, r, amp, seg) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / seg));
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i <= n; i++) {
      const t = i / n, tm = (i - 0.5) / n;
      ctx.quadraticCurveTo(x0 + (x1 - x0) * tm + (r() - 0.5) * amp, y0 + (y1 - y0) * tm + (r() - 0.5) * amp * 2,
        x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + (i < n ? (r() - 0.5) * amp : 0));
    }
    ctx.stroke();
  }

  // ---- halftone dots: one tiny tile, repeated (cheap, and it looks printed)
  const tiles = {};
  function dotTile(color, pitch, rad) {
    const key = color + "|" + pitch + "|" + rad;
    if (tiles[key]) return tiles[key];
    const c = mkCanvas(pitch, pitch);
    if (!c) return null;
    const g = c.getContext("2d");
    g.fillStyle = color;
    g.beginPath(); g.arc(pitch * 0.25, pitch * 0.25, rad, 0, TAU); g.fill();
    g.beginPath(); g.arc(pitch * 0.75, pitch * 0.75, rad, 0, TAU); g.fill();
    tiles[key] = c;
    return c;
  }
  function fillDots(ctx, color, pitch, rad, x, y, w, h) {
    const t = dotTile(color, pitch, rad);
    if (!t) return;
    const p = ctx.createPattern(t, "repeat");
    if (!p) return;
    ctx.fillStyle = p; ctx.fillRect(x, y, w, h);
  }

  // ---- torn paper: a polygon whose chosen edges are ragged, with a white fibre rim
  function tornPts(poly, torn, r, amp, step) {
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      out.push(a[0], a[1]);
      if (!torn || !torn[i]) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      let s = step * (0.6 + r() * 0.8);
      while (s < len - step * 0.5) {
        const o = (r() - 0.5) * 2 * amp * (r() < 0.14 ? 1.9 : 1);
        out.push(a[0] + dx * s / len + nx * o, a[1] + dy * s / len + ny * o);
        s += step * (0.55 + r() * 0.9);
      }
    }
    return out;
  }
  function ptsPath(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function circlePoly(cx, cy, rad, n) {
    const p = [];
    for (let i = 0; i < n; i++) p.push([cx + Math.cos(i / n * TAU) * rad, cy + Math.sin(i / n * TAU) * rad]);
    return p;
  }
  // o: { fill, seed, amp, step, rimColor, rimW, halftone:[color,pitch,rad], inside(ctx,bb), shadow }
  function paper(ctx, poly, torn, o) {
    const r = makeRng(o.seed || 1);
    const pts = tornPts(poly, torn, r, o.amp == null ? 4 : o.amp, o.step || 11);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    ctx.save();
    if (o.shadow !== false) shadow(ctx, "rgba(60,40,80,0.20)", 14, 5);
    ptsPath(ctx, pts);
    if (o.rimColor) { ctx.lineJoin = "round"; ctx.strokeStyle = o.rimColor; ctx.lineWidth = o.rimW || 8; ctx.stroke(); }
    ctx.fillStyle = o.fill; ctx.fill();
    noShadow(ctx);
    ptsPath(ctx, pts); ctx.clip();
    ctx.fillStyle = o.fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (o.halftone) fillDots(ctx, o.halftone[0], o.halftone[1], o.halftone[2], x0, y0, x1 - x0, y1 - y0);
    if (o.inside) o.inside(ctx, { x0: x0, y0: y0, x1: x1, y1: y1 });
    ctx.restore();
  }

  // ---- washi tape: translucent strip with zigzag ends
  function washi(ctx, cx, cy, w, h, rot, color, kind) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    const hw = w / 2, hh = h / 2, n = Math.max(2, Math.round(h / 8));
    function path() {
      ctx.beginPath(); ctx.moveTo(-hw, -hh); ctx.lineTo(hw, -hh);
      for (let k = 1; k <= n; k++) ctx.lineTo(hw + (k % 2 ? -4 : 0), -hh + h * k / n);
      ctx.lineTo(-hw, hh);
      for (let k = n - 1; k >= 0; k--) ctx.lineTo(-hw + (k % 2 ? 4 : 0), -hh + h * k / n);
      ctx.closePath();
    }
    shadow(ctx, "rgba(40,20,60,0.22)", 6, 3);
    path(); ctx.fillStyle = color; ctx.globalAlpha = 0.9; ctx.fill();
    noShadow(ctx); ctx.globalAlpha = 1;
    path(); ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    if (kind === "stripe") {
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 7;
      for (let x = -hw - h; x < hw + h; x += 22) { ctx.beginPath(); ctx.moveTo(x, hh + 2); ctx.lineTo(x + h, -hh - 2); ctx.stroke(); }
    } else if (kind === "dots") {
      for (let y = -hh + 11, row = 0; y < hh; y += 22, row++)
        for (let x = -hw + (row % 2 ? 24 : 12); x < hw; x += 24) { ctx.beginPath(); ctx.arc(x, y, 4.2, 0, TAU); ctx.fill(); }
    } else if (kind === "check") {
      for (let x = -hw, i = 0; x < hw; x += 16, i++)
        for (let y = -hh, j = 0; y < hh; y += 16, j++) if ((i + j) % 2 === 0) ctx.fillRect(x, y, 16, 16);
    }
    ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fillRect(-hw, -hh, w, h * 0.22);
    ctx.restore();
  }

  // ---- die-cut sticker: white rim + soft shadow
  function sticker(ctx, pathFn, fill, rim) {
    ctx.save();
    pathFn(); shadow(ctx, "rgba(40,20,70,0.24)", 10, 5);
    ctx.lineJoin = "round"; ctx.strokeStyle = "#fff"; ctx.lineWidth = rim || 14; ctx.stroke();
    noShadow(ctx);
    ctx.fillStyle = "#fff"; ctx.fill();
    pathFn(); ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
  }
  function burst(ctx, x, y, ro, ri, n, rot, fill, rim) {
    sticker(ctx, function () { starPath(ctx, x, y, ro, ri, n, rot); }, fill, rim);
  }
  function flatBurst(ctx, x, y, ro, ri, n, rot, fill) { starPath(ctx, x, y, ro, ri, n, rot); ctx.fillStyle = fill; ctx.fill(); }

  function daisy(ctx, x, y, R, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    shadow(ctx, "rgba(90,30,60,0.25)", 8, 4);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#F3B3CD"; ctx.lineWidth = 2.5;
    for (let k = 0; k < 8; k++) {
      ctx.save(); ctx.rotate(k * Math.PI / 4);
      ctx.beginPath(); ctx.ellipse(0, -R * 0.62, R * 0.24, R * 0.42, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
      noShadow(ctx);
    }
    circlePath(ctx, 0, 0, R * 0.3); ctx.fillStyle = "#FAD15A"; ctx.fill();
    circlePath(ctx, -R * 0.07, -R * 0.07, R * 0.12); ctx.fillStyle = "#FDE9A0"; ctx.fill();
    ctx.restore();
  }

  function paperclip(ctx, x, y, rot, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.strokeStyle = color || "#9AA3B5"; ctx.lineWidth = 4.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(10, -30); ctx.lineTo(10, 20); ctx.arc(-1, 20, 11, 0, Math.PI); ctx.lineTo(-12, -18);
    ctx.arc(-5, -18, 7, Math.PI, 0); ctx.lineTo(2, 12);
    ctx.stroke(); ctx.restore();
  }
  function pin(ctx, x, y, color) {
    ctx.save(); shadow(ctx, "rgba(0,0,0,0.35)", 6, 4);
    circlePath(ctx, x, y, 17); ctx.fillStyle = color; ctx.fill(); noShadow(ctx);
    circlePath(ctx, x - 5, y - 5, 6); ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fill();
    ctx.restore();
  }
  // hand-drawn flower (outline in `line`)
  function flower(ctx, x, y, rad, petal, centre, line) {
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = line; ctx.lineJoin = "round";
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5 - Math.PI / 2;
      circlePath(ctx, x + Math.cos(a) * rad * 0.6, y + Math.sin(a) * rad * 0.6, rad * 0.5);
      ctx.fillStyle = petal; ctx.fill(); ctx.stroke();
    }
    circlePath(ctx, x, y, rad * 0.32); ctx.fillStyle = centre; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function leaf(ctx, x, y, len, rot, fill, line) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0); ctx.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
  }

  function berryPath(ctx, r) {
    ctx.beginPath(); ctx.moveTo(0, -r * 0.72);
    ctx.bezierCurveTo(r * 0.55, -r * 1.0, r * 1.15, -r * 0.55, r * 0.95, -r * 0.05);
    ctx.bezierCurveTo(r * 0.8, r * 0.6, r * 0.3, r * 1.0, 0, r * 1.15);
    ctx.bezierCurveTo(-r * 0.3, r * 1.0, -r * 0.8, r * 0.6, -r * 0.95, -r * 0.05);
    ctx.bezierCurveTo(-r * 1.15, -r * 0.55, -r * 0.55, -r * 1.0, 0, -r * 0.72);
    ctx.closePath();
  }
  const SEEDS = [[-0.42, -0.2], [0.42, -0.2], [0, -0.02], [-0.62, 0.22], [0.62, 0.22], [-0.25, 0.32], [0.25, 0.32], [0, 0.62]];
  function berry(ctx, x, y, r, rot, col, rimmed) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    if (rimmed) {
      berryPath(ctx, r); shadow(ctx, "rgba(70,20,40,0.28)", 10, 5);
      ctx.lineJoin = "round"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 15; ctx.stroke(); noShadow(ctx);
      ctx.fillStyle = "#fff"; ctx.fill();
    }
    berryPath(ctx, r); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = "rgba(255,243,214,0.95)";
    ctx.beginPath();
    for (let i = 0; i < SEEDS.length; i++) {
      const sx = SEEDS[i][0] * r, sy = SEEDS[i][1] * r;
      ctx.moveTo(sx + r * 0.07, sy); ctx.ellipse(sx, sy, r * 0.07, r * 0.115, 0, 0, TAU);
    }
    ctx.fill();
    ctx.save(); ctx.translate(0, -r * 0.7); ctx.scale(1, 0.62);
    starPath(ctx, 0, 0, r * 0.62, r * 0.2, 5, 0.3); ctx.fillStyle = "#5DB075"; ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#4C9A63"; ctx.fillRect(-r * 0.05, -r * 1.12, r * 0.1, r * 0.3);
    ctx.restore();
  }

  // ------------------------------------------------------------------ text plates and mark plate
  function labelRect(bg, count) {
    // two lines: 196 px tall, bottom edge at 1470 (compose.js textCenterY uses the same numbers: keep them in step)
    const z = bg.text, h = count >= 2 ? 196 : 150, cy = z.y + z.h / 2 - (count >= 2 ? 8 : 0);
    return { x: z.x - 20, y: cy - h / 2, w: z.w + 40, h: h };
  }
  function paperLabel(ctx, rc, o) {
    ctx.save();
    shadow(ctx, "rgba(60,30,60,0.22)", 14, 6);
    rr(ctx, rc.x, rc.y, rc.w, rc.h, o.r || 16); ctx.fillStyle = o.fill || "#FFFDF8"; ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = o.border; ctx.lineWidth = 3.5; ctx.setLineDash([15, 10]); ctx.lineCap = "round";
    rr(ctx, rc.x + 13, rc.y + 13, rc.w - 26, rc.h - 26, 9); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    washi(ctx, rc.x + 70, rc.y + 5, 160, 46, -0.3, o.tape1, o.kind);
    washi(ctx, rc.x + rc.w - 70, rc.y + 5, 160, 46, 0.3, o.tape2, o.kind);
  }
  const PLATE = {
    gingham: function (ctx, bg, count) {
      paperLabel(ctx, labelRect(bg, count), { fill: "#FFFDF9", border: "#E58AA8", tape1: "#F58FB8", tape2: "#F7C3D6", kind: "check" });
    },
    "wavy-checks": function (ctx, bg, count) {
      paperLabel(ctx, labelRect(bg, count), { fill: "#FFFDF8", border: "#A998E0", tape1: "#FAD15A", tape2: "#F6A5C8", kind: "dots" });
    },
    strawberries: function (ctx, bg, count) {
      const rc = labelRect(bg, count);
      paper(ctx, [[rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x + rc.w, rc.y + rc.h], [rc.x, rc.y + rc.h]], [1, 1, 1, 1],
        { fill: "#FFF8EE", seed: 77, amp: 2.4, step: 9 });
      ctx.save();
      ctx.strokeStyle = "#D95066"; ctx.lineWidth = 3.5; ctx.setLineDash([15, 10]); ctx.lineCap = "round";
      rr(ctx, rc.x + 16, rc.y + 16, rc.w - 32, rc.h - 32, 10); ctx.stroke();
      ctx.restore();
      berry(ctx, rc.x + 8, rc.y + 8, 30, -0.5, "#F2647E", true);
      washi(ctx, rc.x + rc.w - 80, rc.y + 4, 150, 44, 0.3, "#F7B3C4", "stripe");
    },
    graph: function (ctx, bg, count) {
      const rc = labelRect(bg, count);
      ctx.save();
      for (let i = 2; i >= 0; i--) {
        rr(ctx, rc.x - i * 10, rc.y - i * 10, rc.w + i * 20, rc.h + i * 20, 34 + i * 8);
        ctx.fillStyle = "rgba(255,255,255," + (i === 0 ? 0.5 : 0.2) + ")"; ctx.fill();
      }
      ctx.restore();
    },
    watercolour: function (ctx, bg, count) {
      const rc = labelRect(bg, count);
      ctx.save();
      shadow(ctx, "rgba(110,70,140,0.22)", 18, 7);
      rr(ctx, rc.x, rc.y, rc.w, rc.h, 40); ctx.fillStyle = "rgba(255,255,255,0.80)"; ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = "rgba(205,189,242,0.9)"; ctx.lineWidth = 3; rr(ctx, rc.x + 8, rc.y + 8, rc.w - 16, rc.h - 16, 32); ctx.stroke();
      fillSpark(ctx, rc.x + 44, rc.y + 38, 13, "#CDBDF2");
      fillSpark(ctx, rc.x + rc.w - 46, rc.y + rc.h - 36, 11, "#F8B7CF");
      ctx.restore();
    }
  };

  // a small pill just big enough for the mark text (about 70% opaque), so the mark stays readable without shouting
  function markPlate(ctx, bg) {
    const m = bg.mark;
    ctx.save();
    ctx.font = MARK_FONT;
    const tw = Math.min(m.w, ctx.measureText(MARK_TEXT).width);
    const x = m.x + m.w - tw - 16, y = m.y - 2, w = tw + 30, h = m.h + 4;
    ctx.globalAlpha = 0.7;
    shadow(ctx, "rgba(40,20,50,0.18)", 6, 3);
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = "#FFFBF2"; ctx.fill();
    noShadow(ctx);
    ctx.restore();
  }

  // ------------------------------------------------------------------ 1. Notebook
  function drawNotebook(ctx, o) {
    const r = makeRng(101);
    ctx.fillStyle = "#FBF5E3"; ctx.fillRect(0, 0, W, H);
    vignette(ctx, "rgba(170,130,70,0)", "rgba(170,130,70,0.20)");
    // ruled lines: every 80 px, lined up so two lines of text sit between the rules at 1300 / 1380 / 1460
    const lines = o.hasText ? (o.textLines || [""]).length : 0;
    ctx.strokeStyle = "#9CBDE6"; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (let y = 260; y <= 1900; y += 80) {
      if (lines === 1 && y === 1380) continue;            // one line of text: it sits in the taller row
      wobbleLine(ctx, 0, y, W, y, r, 1.3, 90);
    }
    // top margin rule and the red margin line
    ctx.strokeStyle = "#EE8E94"; ctx.lineWidth = 3.5;
    wobbleLine(ctx, 0, 180, W, 180, r, 1.2, 90);
    wobbleLine(ctx, 150, 0, 150, H, r, 1.2, 90);
    // punched holes
    [300, 960, 1620].forEach(function (y) {
      circlePath(ctx, 62, y, 31); ctx.fillStyle = "rgba(120,95,60,0.16)"; ctx.fill();
      circlePath(ctx, 62, y, 25); ctx.fillStyle = "#B9AA8E"; ctx.fill();
      circlePath(ctx, 63, y + 3, 22); ctx.fillStyle = "#D9CDB4"; ctx.fill();
    });
    // coffee ring
    ctx.save(); ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(150,100,55,0.17)"; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(250, 1720, 78, 0.2, TAU - 0.5); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(150,100,55,0.12)";
    ctx.beginPath(); ctx.arc(252, 1722, 70, 1, TAU - 1.2); ctx.stroke();
    ctx.restore();
    // pencil doodles in the margin and bottom zone
    ctx.save(); ctx.strokeStyle = "rgba(92,118,170,0.65)"; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
    heartPath(ctx, 520, 1640, 26); ctx.stroke();
    starPath(ctx, 430, 1590, 24, 10, 5, 0.2); ctx.stroke();
    starPath(ctx, 610, 1810, 20, 8, 5, -0.3); ctx.stroke();
    starPath(ctx, 330, 130, 20, 8, 5, 0.1); ctx.stroke();
    starPath(ctx, 620, 215, 15, 6, 5, 0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(380, 1860); ctx.bezierCurveTo(410, 1830, 440, 1890, 470, 1860); ctx.bezierCurveTo(500, 1830, 530, 1890, 560, 1860); ctx.stroke();
    ctx.restore();
    // washi tape in the top corners
    washi(ctx, 905, 72, 330, 66, 0.52, "#F6A5C8", "stripe");
    washi(ctx, 215, 38, 230, 58, -0.2, "#9ADBC4", "dots");
    // sticky note with a paperclip, bottom right
    ctx.save(); ctx.translate(835, 1740); ctx.rotate(0.07);
    shadow(ctx, "rgba(70,50,20,0.28)", 14, 7);
    ctx.fillStyle = "#FFE680"; ctx.fillRect(-135, -118, 270, 236); noShadow(ctx);
    const g = ctx.createLinearGradient(0, -118, 0, 118);
    g.addColorStop(0, "rgba(255,255,255,0.35)"); g.addColorStop(0.15, "rgba(255,255,255,0)"); g.addColorStop(0.8, "rgba(200,150,30,0)"); g.addColorStop(1, "rgba(200,150,30,0.22)");
    ctx.fillStyle = g; ctx.fillRect(-135, -118, 270, 236);
    heartPath(ctx, -4, 12, 40); ctx.fillStyle = "#F27BB1"; ctx.fill();
    ctx.strokeStyle = "#B64B7E"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
    paperclip(ctx, 790, 1640, 0.0, "#8F99B0");
  }

  // ------------------------------------------------------------------ 2. Gingham
  function ribbonBand(ctx, top, color, stitch, dot) {
    // scalloped fabric band along the top (top=true) or bottom edge
    const y0 = top ? 0 : H, dir = top ? 1 : -1, bandH = 128;
    ctx.save();
    shadow(ctx, "rgba(110,30,70,0.30)", 12, top ? 6 : -6);
    ctx.beginPath();
    ctx.rect(-10, top ? -10 : H - bandH, W + 20, bandH + 10);
    for (let x = 45; x < W + 45; x += 90) { ctx.moveTo(x + 45, y0 + dir * bandH); ctx.arc(x, y0 + dir * bandH, 45, 0, TAU); }
    ctx.fillStyle = color; ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = stitch; ctx.lineWidth = 4.5; ctx.setLineDash([15, 11]); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, y0 + dir * 100); ctx.lineTo(W, y0 + dir * 100); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = dot;
    for (let x = 45; x < W; x += 90) { circlePath(ctx, x, y0 + dir * 46, 9); ctx.fill(); }
    ctx.restore();
  }
  function drawGingham(ctx) {
    ctx.fillStyle = "#FFF9FB"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(240,120,165,0.30)";
    for (let x = 30; x < W; x += 120) ctx.fillRect(x, 0, 60, H);
    for (let y = 30; y < H; y += 120) ctx.fillRect(0, y, W, 60);
    vignette(ctx, "rgba(255,255,255,0.0)", "rgba(230,90,140,0.12)");
    ribbonBand(ctx, true, "#F58FB8", "rgba(255,255,255,0.95)", "rgba(255,255,255,0.95)");
    ribbonBand(ctx, false, "#F58FB8", "rgba(255,255,255,0.95)", "rgba(255,255,255,0.95)");
    daisy(ctx, 90, 222, 54, 0.2);
    daisy(ctx, 1000, 236, 46, -0.3);
    daisy(ctx, 150, 1700, 48, 0.5);
    daisy(ctx, 965, 1690, 56, -0.1);
    fillSpark(ctx, 540, 262, 20, "#fff");
    fillSpark(ctx, 330, 1688, 22, "#fff");
    fillSpark(ctx, 780, 1650, 16, "#fff");
  }

  // ------------------------------------------------------------------ 3. Wavy checks
  function drawWavyChecks(ctx) {
    function warp(x, y) {
      return [x + 30 * Math.sin(y * 0.0131 + 0.6) + 9 * Math.sin(y * 0.032 + 1.4),
              y + 30 * Math.sin(x * 0.0131 + 2.0) + 9 * Math.sin(x * 0.029 + 0.3)];
    }
    ctx.fillStyle = "#FFF8EA"; ctx.fillRect(0, 0, W, H);
    const S = 120, SEG = 6;
    ctx.beginPath();
    for (let j = -1; j <= 16; j++) {
      for (let i = -1; i <= 9; i++) {
        if (((i + j) & 1) !== 0) continue;
        const x0 = i * S, y0 = j * S;
        let p = warp(x0, y0); ctx.moveTo(p[0], p[1]);
        for (let k = 1; k <= SEG; k++) { p = warp(x0 + S * k / SEG, y0); ctx.lineTo(p[0], p[1]); }
        for (let k = 1; k <= SEG; k++) { p = warp(x0 + S, y0 + S * k / SEG); ctx.lineTo(p[0], p[1]); }
        for (let k = 1; k <= SEG; k++) { p = warp(x0 + S - S * k / SEG, y0 + S); ctx.lineTo(p[0], p[1]); }
        for (let k = 1; k <= SEG; k++) { p = warp(x0, y0 + S - S * k / SEG); ctx.lineTo(p[0], p[1]); }
        ctx.closePath();
      }
    }
    ctx.fillStyle = "#D8CBF5"; ctx.fill();
    vignette(ctx, "rgba(255,255,255,0.10)", "rgba(150,120,220,0.10)");
    // stickers in the top and bottom zones
    burst(ctx, 150, 150, 118, 76, 14, 0.1, "#F27BB1", 14);
    burst(ctx, 905, 125, 100, 68, 12, 0.3, "#FAD15A", 14);
    sticker(ctx, function () { heartPath(ctx, 540, 100, 62); }, "#F6A5C8", 14);
    sticker(ctx, function () { sparkPath(ctx, 1000, 262, 52, 0.2); }, "#9C9BE3", 12);
    sticker(ctx, function () { heartPath(ctx, 175, 1750, 66); }, "#F27BB1", 14);
    burst(ctx, 880, 1775, 120, 80, 16, 0.2, "#FAD15A", 14);
    sticker(ctx, function () { sparkPath(ctx, 520, 1830, 58, 0.2); }, "#9C9BE3", 12);
    burst(ctx, 640, 1660, 46, 24, 8, 0.4, "#F27BB1", 10);
    fillSpark(ctx, 80, 1580, 24, "#fff");
    fillSpark(ctx, 1010, 1520, 20, "#fff");
    fillSpark(ctx, 70, 320, 22, "#fff");
  }

  // ------------------------------------------------------------------ 4. Graph paper
  function gridInside(color, pitch, lw, major, majorColor) {
    return function (ctx, bb) {
      ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.beginPath();
      for (let x = Math.ceil(bb.x0 / pitch) * pitch; x <= bb.x1; x += pitch) if (!major || (x / pitch) % major) { ctx.moveTo(x, bb.y0); ctx.lineTo(x, bb.y1); }
      for (let y = Math.ceil(bb.y0 / pitch) * pitch; y <= bb.y1; y += pitch) if (!major || (y / pitch) % major) { ctx.moveTo(bb.x0, y); ctx.lineTo(bb.x1, y); }
      ctx.stroke();
      if (major) {
        ctx.lineWidth = lw * 1.5; ctx.strokeStyle = majorColor; ctx.beginPath();
        for (let x = Math.ceil(bb.x0 / (pitch * major)) * pitch * major; x <= bb.x1; x += pitch * major) { ctx.moveTo(x, bb.y0); ctx.lineTo(x, bb.y1); }
        for (let y = Math.ceil(bb.y0 / (pitch * major)) * pitch * major; y <= bb.y1; y += pitch * major) { ctx.moveTo(bb.x0, y); ctx.lineTo(bb.x1, y); }
        ctx.stroke();
      }
    };
  }
  function drawGraph(ctx) {
    // pink desk paper underneath, with a mint grid sheet torn along the top and bottom laid on it
    ctx.fillStyle = "#F8CCDD"; ctx.fillRect(0, 0, W, H);
    fillDots(ctx, "rgba(220,90,140,0.22)", 12, 2.3, 0, 0, W, H);
    paper(ctx, [[28, 190], [1052, 168], [1052, 1742], [28, 1764]], [1, 0, 1, 0], {
      fill: "#D9F2E4", seed: 404, amp: 6, step: 13, rimColor: "#FFFDF6", rimW: 9,
      inside: function (c, bb) {
        gridInside("rgba(31,90,68,0.15)", 30, 1.5, 5, "rgba(31,90,68,0.24)")(c, { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 });
      }
    });
    // pixel heart on the grid (cells line up with the 30 px grid)
    const heart = [".XX.XX.", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
    ctx.fillStyle = "#F27BB1";
    heart.forEach(function (row, j) { for (let i = 0; i < row.length; i++) if (row.charAt(i) === "X") ctx.fillRect(150 + i * 30, 1560 + j * 30, 30, 30); });
    ctx.strokeStyle = "rgba(142,36,88,0.55)"; ctx.lineWidth = 2;
    heart.forEach(function (row, j) { for (let i = 0; i < row.length; i++) if (row.charAt(i) === "X") ctx.strokeRect(150 + i * 30, 1560 + j * 30, 30, 30); });
    // hand-drawn graph, bottom right
    ctx.save(); ctx.strokeStyle = "rgba(31,90,68,0.7)"; ctx.lineWidth = 4.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(850, 1580); ctx.lineTo(850, 1710); ctx.lineTo(1010, 1710); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(850, 1580); ctx.lineTo(842, 1596); ctx.moveTo(850, 1580); ctx.lineTo(858, 1596);
    ctx.moveTo(1010, 1710); ctx.lineTo(994, 1702); ctx.moveTo(1010, 1710); ctx.lineTo(994, 1718); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(862, 1690); ctx.bezierCurveTo(900, 1590, 940, 1700, 990, 1610); ctx.stroke();
    ctx.fillStyle = "rgba(31,90,68,0.75)";
    [[900, 1631], [940, 1664], [990, 1610]].forEach(function (p) { circlePath(ctx, p[0], p[1], 7); ctx.fill(); });
    ctx.restore();
    // pencil sparkles near the top
    ctx.save(); ctx.strokeStyle = "rgba(31,90,68,0.5)"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    [[250, 235], [880, 250]].forEach(function (p) {
      ctx.beginPath(); ctx.moveTo(p[0] - 14, p[1]); ctx.lineTo(p[0] + 14, p[1]); ctx.moveTo(p[0], p[1] - 14); ctx.lineTo(p[0], p[1] + 14); ctx.stroke();
    });
    ctx.restore();
    // tape on the four corners
    washi(ctx, 74, 190, 210, 58, -0.78, "#FAD15A", "stripe");
    washi(ctx, 1006, 176, 210, 58, 0.78, "#CDBDF2", "dots");
    washi(ctx, 74, 1744, 210, 58, 0.78, "#CDBDF2", "dots");
    washi(ctx, 1006, 1756, 210, 58, -0.78, "#FAD15A", "stripe");
    paperclip(ctx, 700, 120, 0.2, "#8F99B0");
    burst(ctx, 330, 80, 46, 26, 8, 0.2, "#F27BB1", 10);
    sticker(ctx, function () { sparkPath(ctx, 540, 100, 36, 0.2); }, "#FAD15A", 10);
    burst(ctx, 540, 1850, 40, 22, 8, 0.2, "#CDBDF2", 10);
    sticker(ctx, function () { heartPath(ctx, 300, 1850, 28); }, "#F27BB1", 10);
  }

  // ------------------------------------------------------------------ 5. Dot journal
  function drawDotJournal(ctx) {
    const r = makeRng(505);
    ctx.fillStyle = "#FFF1B8"; ctx.fillRect(0, 0, W, H);
    vignette(ctx, "rgba(255,230,140,0)", "rgba(215,170,60,0.22)");
    ctx.fillStyle = "rgba(190,145,40,0.62)";
    ctx.beginPath();
    for (let y = 27; y < H; y += 54) for (let x = 27; x < W; x += 54) { ctx.moveTo(x + 3.4, y); ctx.arc(x, y, 3.4, 0, TAU); }
    ctx.fill();
    // top: a wide strip of washi tape and a hand-drawn flower garland
    washi(ctx, 540, 62, 1240, 100, -0.022, "#F6A5C8", "dots");
    ctx.save();
    ctx.strokeStyle = "#5C7A4A"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(90, 190); ctx.quadraticCurveTo(540, 275, 990, 190); ctx.stroke();
    ctx.restore();
    const qx = function (t) { return (1 - t) * (1 - t) * 90 + 2 * (1 - t) * t * 540 + t * t * 990; };
    const qy = function (t) { return (1 - t) * (1 - t) * 190 + 2 * (1 - t) * t * 275 + t * t * 190; };
    const cols = ["#F6A5C8", "#FFFDF3", "#CDBDF2", "#FFFDF3"];
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9, x = qx(t), y = qy(t);
      leaf(ctx, x, y, 34, (i % 2 ? 2.4 : 0.7), "#B8E0A8", "#5C7A4A");
      if (i % 2 === 0) flower(ctx, x, y + 6, 26, cols[(i / 2) % cols.length | 0], "#FAD15A", "#6A4A2E");
    }
    // bottom: habit tracker circles, squiggle, tape strip
    ctx.save(); ctx.strokeStyle = "#6A4A2E"; ctx.lineWidth = 4.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let i = 0; i < 7; i++) {
      const cx = 200 + i * 113, cy = 1650;
      ctx.beginPath(); ctx.ellipse(cx, cy, 34 + r() * 2, 33 + r() * 2, r() * 0.4, 0, TAU);
      if (i < 4) { ctx.fillStyle = "rgba(246,140,180,0.85)"; ctx.fill(); }
      ctx.stroke();
      if (i < 4) { ctx.beginPath(); ctx.moveTo(cx - 14, cy + 1); ctx.lineTo(cx - 3, cy + 12); ctx.lineTo(cx + 16, cy - 12); ctx.stroke(); }
    }
    ctx.beginPath(); ctx.moveTo(200, 1750);
    for (let i = 0; i < 8; i++) ctx.quadraticCurveTo(200 + i * 85 + 42, 1750 + (i % 2 ? 18 : -18), 200 + (i + 1) * 85, 1750);
    ctx.stroke();
    ctx.restore();
    paper(ctx, [[-30, 1745], [175, 1728], [190, 1960], [-30, 1960]], [1, 0, 0, 0], { fill: "#CDBDF2", seed: 51, amp: 3.5, step: 10, rimColor: "#FFFDF3", rimW: 7, halftone: ["rgba(110,90,200,0.25)", 10, 1.6] });
    paper(ctx, [[925, 1738], [1110, 1722], [1110, 1960], [915, 1960]], [1, 0, 0, 0], { fill: "#F6A5C8", seed: 52, amp: 3.5, step: 10, rimColor: "#FFFDF3", rimW: 7, halftone: ["rgba(200,60,120,0.25)", 10, 1.6] });
    washi(ctx, 540, 1860, 1240, 82, 0.02, "#A8E0CF", "stripe");
    paperclip(ctx, 1000, 1735, 0.3, "#8F99B0");
    sticker(ctx, function () { heartPath(ctx, 95, 1790, 30); }, "#F27BB1", 10);
    heartPath(ctx, 110, 1585, 24); ctx.fillStyle = "#F27BB1"; ctx.fill();
    fillSpark(ctx, 980, 1570, 24, "#F27BB1");
    fillSpark(ctx, 90, 330, 18, "#E7B94A");
    fillSpark(ctx, 995, 380, 22, "#E7B94A");
  }

  // ------------------------------------------------------------------ 6. Polaroid on cork
  function drawPolaroid(ctx) {
    const r = makeRng(606);
    ctx.fillStyle = "#C99A64"; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 150; i++) {
      const x = r() * W, y = r() * H, rad = 8 + r() * 22;
      ctx.fillStyle = r() < 0.5 ? "rgba(120,78,38,0.20)" : "rgba(240,205,150,0.30)";
      ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = "rgba(90,52,22,0.40)";
    ctx.beginPath();
    for (let i = 0; i < 110; i++) { const x = r() * W, y = r() * H, rad = 2 + r() * 3; ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, TAU); }
    ctx.fill();
    vignette(ctx, "rgba(255,230,180,0.0)", "rgba(80,40,10,0.32)");
    // bunting across the top
    const P = function (t) { return [(1 - t) * (1 - t) * -10 + 2 * (1 - t) * t * 540 + t * t * 1090, (1 - t) * (1 - t) * 24 + 2 * (1 - t) * t * 190 + t * t * 24]; };
    ctx.save(); ctx.strokeStyle = "#F5E6C8"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-10, 24); ctx.quadraticCurveTo(540, 190, 1090, 24); ctx.stroke(); ctx.restore();
    const flagCols = ["#F27BB1", "#FAD15A", "#9C9BE3", "#8FDCC2", "#F6A5A0"];
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.7) / 9.4, a = P(t), b = P(t + 0.045);
      const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty), ux = tx / tl, uy = ty / tl;
      const nx = -uy, ny = ux, hw = 56;
      ctx.save(); shadow(ctx, "rgba(40,20,0,0.3)", 6, 4);
      ctx.beginPath(); ctx.moveTo(a[0] - ux * hw, a[1] - uy * hw); ctx.lineTo(a[0] + ux * hw, a[1] + uy * hw); ctx.lineTo(a[0] + nx * 112, a[1] + ny * 112); ctx.closePath();
      ctx.fillStyle = flagCols[i % flagCols.length]; ctx.fill(); noShadow(ctx);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let k = 0; k < 4; k++) { circlePath(ctx, a[0] + ux * (k - 1.5) * 20 + nx * 28, a[1] + uy * (k - 1.5) * 20 + ny * 28, 4.5); ctx.fill(); }
      ctx.restore();
    }
    pin(ctx, 34, 28, "#E04F5F");
    pin(ctx, 1046, 28, "#3E9DE0");
    // the polaroid
    const cx = 100, cy = 280, cw = 880, ch = 1190;
    ctx.save();
    shadow(ctx, "rgba(40,20,5,0.45)", 34, 16);
    rr(ctx, cx, cy, cw, ch, 8); ctx.fillStyle = "#FFFEFA"; ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = "#E7E0D0"; ctx.lineWidth = 2.5; ctx.stroke();
    // paper sheen
    const sg = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
    sg.addColorStop(0, "rgba(255,255,255,0.0)"); sg.addColorStop(1, "rgba(220,205,170,0.20)");
    ctx.fillStyle = sg; ctx.fillRect(cx, cy, cw, ch);
    ctx.restore();
    // the photo square
    const px = 150, py = 330, ps = 780;
    const pg = ctx.createLinearGradient(px, py, px + ps * 0.3, py + ps);
    pg.addColorStop(0, "#FFF6DA"); pg.addColorStop(0.55, "#FFEBDD"); pg.addColorStop(1, "#FFD9E6");
    ctx.fillStyle = pg; ctx.fillRect(px, py, ps, ps);
    const rg = ctx.createRadialGradient(px + ps / 2, py + ps / 2, 200, px + ps / 2, py + ps / 2, 560);
    rg.addColorStop(0, "rgba(255,255,255,0.35)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg; ctx.fillRect(px, py, ps, ps);
    const ig = ctx.createLinearGradient(0, py, 0, py + 26); ig.addColorStop(0, "rgba(90,60,40,0.20)"); ig.addColorStop(1, "rgba(90,60,40,0)");
    ctx.fillStyle = ig; ctx.fillRect(px, py, ps, 26);
    const ig2 = ctx.createLinearGradient(px, 0, px + 26, 0); ig2.addColorStop(0, "rgba(90,60,40,0.16)"); ig2.addColorStop(1, "rgba(90,60,40,0)");
    ctx.fillStyle = ig2; ctx.fillRect(px, py, 26, ps);
    fillSpark(ctx, 212, 398, 24, "rgba(255,255,255,0.95)");
    fillSpark(ctx, 872, 1040, 28, "rgba(255,255,255,0.95)");
    fillSpark(ctx, 860, 410, 14, "rgba(246,140,180,0.8)");
    heartPath(ctx, 215, 1030, 15); ctx.fillStyle = "rgba(246,140,180,0.75)"; ctx.fill();
    // tape on the polaroid
    washi(ctx, 540, 286, 250, 62, 0.02, "#FAD15A", "stripe");
    washi(ctx, 116, 1452, 200, 54, -0.78, "#F6A5C8", "dots");
    washi(ctx, 964, 1452, 200, 54, 0.78, "#CDBDF2", "dots");
    // bottom of the board: a pinned index card and a sticky note
    ctx.save(); ctx.translate(255, 1750); ctx.rotate(-0.06);
    shadow(ctx, "rgba(40,20,5,0.4)", 16, 8);
    ctx.fillStyle = "#FFFDF4"; ctx.fillRect(-195, -112, 390, 224); noShadow(ctx);
    ctx.strokeStyle = "rgba(235,120,130,0.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-195, -62); ctx.lineTo(195, -62); ctx.stroke();
    ctx.strokeStyle = "rgba(120,160,215,0.7)";
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-195, -20 + k * 40); ctx.lineTo(195, -20 + k * 40); ctx.stroke(); }
    heartPath(ctx, -120, -12, 22); ctx.fillStyle = "#F27BB1"; ctx.fill();
    ctx.strokeStyle = "rgba(60,50,80,0.6)"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-70, -2); ctx.bezierCurveTo(-30, -16, 10, 12, 60, -4); ctx.stroke();
    ctx.restore();
    pin(ctx, 255, 1648, "#E04F5F");
    ctx.save(); ctx.translate(835, 1745); ctx.rotate(0.08);
    shadow(ctx, "rgba(40,20,5,0.4)", 16, 8);
    ctx.fillStyle = "#FFE680"; ctx.fillRect(-105, -105, 210, 210); noShadow(ctx);
    starPath(ctx, 0, 6, 46, 20, 5, 0.1); ctx.fillStyle = "#F7A64C"; ctx.fill();
    ctx.strokeStyle = "#8A5A20"; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
    pin(ctx, 835, 1655, "#3E9DE0");
    fillSpark(ctx, 560, 1700, 24, "#FFF3D8");
    fillSpark(ctx, 600, 1860, 18, "#FFF3D8");
  }

  // ------------------------------------------------------------------ 7. Strawberries
  function drawStrawberries(ctx) {
    const r = makeRng(707);
    ctx.fillStyle = "#FFD7E1"; ctx.fillRect(0, 0, W, H);
    const cols = ["#F794A6", "#F5869B", "#F9A5B4"];
    let row = 0;
    for (let y = 40; y < H + 60; y += 105, row++) {
      for (let x = (row % 2 ? 67 : 0); x < W + 70; x += 135) {
        const px = x + (r() - 0.5) * 22, py = y + (r() - 0.5) * 18;
        const centre = px > 170 && px < 910 && py > 380 && py < 1260;
        ctx.globalAlpha = centre ? 0.5 : 1;
        berry(ctx, px, py, 29 + r() * 6, (r() - 0.5) * 0.9, cols[(r() * 3) | 0], false);
        ctx.globalAlpha = 1;
        fillSpark(ctx, x + 67, y + 2, 10, "rgba(255,255,255,0.9)");
      }
    }
    vignette(ctx, "rgba(255,230,236,0.0)", "rgba(230,90,120,0.10)");
    // cream scalloped bands top and bottom with small red dots
    [true, false].forEach(function (top) {
      const y0 = top ? 0 : H, dir = top ? 1 : -1, bandH = 124;
      ctx.save();
      shadow(ctx, "rgba(120,30,50,0.30)", 12, top ? 6 : -6);
      ctx.beginPath(); ctx.rect(-10, top ? -10 : H - bandH, W + 20, bandH + 10);
      for (let x = 45; x < W + 45; x += 90) { ctx.moveTo(x + 45, y0 + dir * bandH); ctx.arc(x, y0 + dir * bandH, 45, 0, TAU); }
      ctx.fillStyle = "#FFF6EC"; ctx.fill(); noShadow(ctx);
      ctx.strokeStyle = "#E0586F"; ctx.lineWidth = 4.5; ctx.setLineDash([15, 11]); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, y0 + dir * 98); ctx.lineTo(W, y0 + dir * 98); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#F2647E";
      for (let x = 45; x < W; x += 90) { heartPath(ctx, x, y0 + dir * 48, 13); ctx.fill(); }
      ctx.restore();
    });
    berry(ctx, 120, 235, 82, -0.45, "#F2556F", true);
    berry(ctx, 975, 1700, 90, 0.5, "#F2556F", true);
    berry(ctx, 140, 1650, 46, 0.3, "#F77F93", true);
    berry(ctx, 960, 250, 44, -0.3, "#F77F93", true);
  }

  // ------------------------------------------------------------------ 8. Collage
  function drawCollage(ctx) {
    ctx.fillStyle = "#FCF8EE"; ctx.fillRect(0, 0, W, H);
    vignette(ctx, "rgba(255,255,255,0.0)", "rgba(210,190,140,0.12)");
    const RIM = "#FFFDF6";
    // ---- top left: graph scrap, periwinkle paper, yellow brush stroke
    paper(ctx, [[262, -30], [650, -30], [610, 310], [252, 282]], [0, 0, 1, 0], {
      fill: "#F1EBFB", seed: 11, amp: 4, step: 10, rimColor: RIM, rimW: 8,
      inside: function (c, bb) {
        c.save(); c.translate(450, 150); c.rotate(0.07); c.translate(-450, -150);
        gridInside("rgba(124,120,214,0.55)", 38, 1.7)(c, { x0: bb.x0 - 60, y0: bb.y0 - 60, x1: bb.x1 + 60, y1: bb.y1 + 60 });
        c.restore();
      }
    });
    paper(ctx, [[-30, -30], [450, -30], [440, 205], [-30, 252]], [0, 1, 1, 0], {
      fill: "#A6A4E6", seed: 12, amp: 4.5, step: 9, rimColor: RIM, rimW: 8, halftone: ["rgba(90,88,190,0.30)", 9, 1.5]
    });
    ctx.save(); ctx.translate(190, 300); ctx.rotate(-0.07);
    const br = makeRng(13);
    for (let i = 0; i < 10; i++) {
      const yy = -36 + i * 7.6, endX = 215 + (br() - 0.5) * 46 - Math.abs(i - 4.5) * 3;
      ctx.fillStyle = i % 3 === 0 ? "#F7C94A" : "#FAD15A";
      ctx.fillRect(-230, yy, endX + 230, 8.2);
    }
    ctx.restore();
    // ---- top right: pink halftone circle, yellow starburst, sparkles
    paper(ctx, circlePoly(985, 20, 215, 56), null, { fill: "#F27BB1", seed: 14, rimColor: RIM, rimW: 7, halftone: ["rgba(190,40,110,0.30)", 9, 1.6] });
    ctx.save(); shadow(ctx, "rgba(120,80,0,0.2)", 10, 4);
    flatBurst(ctx, 735, 150, 108, 54, 14, 0.12, "#FAD15A"); noShadow(ctx); ctx.restore();
    fillSpark(ctx, 1000, 340, 44, "#9C9BE3");
    fillSpark(ctx, 585, 372, 26, "#9C9BE3");
    fillSpark(ctx, 905, 330, 18, "#CDBDF2");
    // ---- bottom left: periwinkle circle, pink torn paper, pink starburst
    paper(ctx, circlePoly(110, 1790, 195, 56), null, { fill: "#A6A4E6", seed: 15, rimColor: RIM, rimW: 7, halftone: ["rgba(90,88,190,0.28)", 9, 1.5] });
    paper(ctx, [[-30, 1660], [190, 1672], [430, 1722], [640, 1832], [704, 1950], [-30, 1950]], [0, 1, 1, 1, 0, 0], {
      fill: "#F27BB1", seed: 16, amp: 4.5, step: 10, rimColor: RIM, rimW: 8, halftone: ["rgba(190,40,110,0.30)", 9, 1.6]
    });
    ctx.save(); shadow(ctx, "rgba(120,20,70,0.25)", 10, 4);
    flatBurst(ctx, 655, 1690, 92, 22, 9, 0.2, "#F27BB1"); noShadow(ctx); ctx.restore();
    fillSpark(ctx, 345, 1600, 28, "#9C9BE3");
    fillSpark(ctx, 52, 1560, 20, "#9C9BE3");
    // ---- bottom right: lilac graph scrap, pink strip, yellow torn paper with dots
    paper(ctx, [[992, 1215], [1110, 1200], [1110, 1950], [1004, 1950]], [1, 0, 0, 1], {
      fill: "#EFE7FA", seed: 17, amp: 4, step: 10, rimColor: RIM, rimW: 8,
      inside: function (c, bb) { gridInside("rgba(124,120,214,0.55)", 38, 1.7)(c, bb); }
    });
    paper(ctx, [[908, 1592], [1030, 1560], [1060, 1950], [930, 1950]], [1, 0, 0, 0], {
      fill: "#F27BB1", seed: 18, amp: 4, step: 10, rimColor: RIM, rimW: 7, halftone: ["rgba(190,40,110,0.30)", 9, 1.6]
    });
    paper(ctx, [[708, 1768], [945, 1712], [1030, 1950], [670, 1950]], [1, 0, 0, 0], {
      fill: "#FAD15A", seed: 19, amp: 4.5, step: 10, rimColor: RIM, rimW: 8, halftone: ["rgba(200,140,0,0.28)", 9, 1.5],
      inside: function (c) {
        c.fillStyle = "#7D7BD6";
        for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { circlePath(c, 800 + i * 40 + (j % 2) * 8, 1822 + j * 30, 6.5); c.fill(); }
      }
    });
    // the torn top edge of the yellow piece (edge 0 and the left) needs jagged edges
    fillSpark(ctx, 735, 1650, 32, "#9C9BE3");
    fillSpark(ctx, 1020, 1480, 22, "#9C9BE3");
    // a few specks at the sides of the calm middle
    fillSpark(ctx, 46, 1010, 20, "#CDBDF2");
    fillSpark(ctx, 1030, 700, 22, "#CDBDF2");
    fillSpark(ctx, 40, 560, 14, "#F6A5C8");
  }

  // ------------------------------------------------------------------ 9. Watercolour sparkle
  function drawWatercolour(ctx) {
    const r = makeRng(909);
    // an under-wash so there are never white gaps between the blobs
    const base = ctx.createLinearGradient(0, 0, W * 0.6, H);
    base.addColorStop(0, "#E4EDFB"); base.addColorStop(0.3, "#FCE4EE"); base.addColorStop(0.6, "#FFEBD8"); base.addColorStop(1, "#F9D8E7");
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    const WASH = [
      [150, 190, 560, [176, 212, 247]], [930, 130, 480, [205, 189, 242]], [560, 520, 520, [252, 205, 224]],
      [90, 960, 430, [255, 214, 172]], [1000, 1000, 470, [216, 200, 248]], [540, 1330, 440, [253, 232, 170]],
      [150, 1760, 540, [255, 204, 166]], [900, 1740, 500, [250, 190, 214]], [560, 1900, 400, [190, 225, 246]], [620, 120, 340, [255, 224, 200]]
    ];
    WASH.forEach(function (w) {
      for (let k = 0; k < 3; k++) {
        const cx = w[0] + (r() - 0.5) * w[2] * 0.5, cy = w[1] + (r() - 0.5) * w[2] * 0.5, rad = w[2] * (0.6 + r() * 0.4);
        const c = w[3], col = function (a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; };
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(r() * Math.PI); ctx.scale(1, 0.62 + r() * 0.38);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, col(0.42)); g.addColorStop(0.62, col(0.34)); g.addColorStop(0.84, col(0.46)); g.addColorStop(1, col(0));
        ctx.fillStyle = g; ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
        ctx.restore();
      }
    });
    // granulation: soft, uneven pigment patches
    for (let i = 0; i < 90; i++) {
      const w = WASH[(r() * WASH.length) | 0], x = w[0] + (r() - 0.5) * w[2] * 1.5, y = w[1] + (r() - 0.5) * w[2] * 1.5, rad = 22 + r() * 60;
      ctx.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.06)" : "rgba(" + (w[3][0] - 40) + "," + (w[3][1] - 50) + "," + (w[3][2] - 30) + ",0.06)";
      ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, TAU); ctx.fill();
    }
    // glitter: sparse, fewer in the calm middle
    ctx.lineCap = "round";
    for (let i = 0; i < 300; i++) {
      const x = r() * W, y = r() * H, a = r() * TAU, l = 3.5 + r() * 7;
      const mid = x > 200 && x < 880 && y > 400 && y < 1300, txt = x > 100 && x < 980 && y > 1280 && y < 1550;
      if (mid && r() < 0.6) continue;
      if (txt && r() < 0.9) continue;
      ctx.strokeStyle = r() < 0.7 ? "rgba(168,164,186,0.92)" : "rgba(212,170,100,0.92)";
      ctx.lineWidth = 2.2 + r() * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    // star sequins and round dots, out at the edges
    const seq = ["#A4306B", "#2E8BA6", "#B9B6C6", "#F0A25B", "#7A3FA0"];
    for (let i = 0, n = 0; n < 34 && i < 400; i++) {
      const x = r() * W, y = r() * H, mid = x > 190 && x < 890 && y > 380 && y < 1320, txt = x > 80 && x < 1000 && y > 1260 && y < 1570;
      if (mid || txt) continue;
      n++;
      if (n % 4 === 0) { circlePath(ctx, x, y, 6 + r() * 3); ctx.fillStyle = "#2F4C9A"; ctx.fill(); }
      else { const sr = 15 + r() * 11; starPath(ctx, x, y, sr, sr * 0.42, 5, r() * 1.2); ctx.fillStyle = seq[n % seq.length]; ctx.fill(); starPath(ctx, x - 1, y - 1, sr * 0.45, sr * 0.2, 5, 0.3); ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill(); }
    }
    [[120, 330, 30], [960, 1625, 30], [900, 280, 22], [200, 1580, 24], [60, 1010, 18], [1020, 620, 20]].forEach(function (p) {
      fillSpark(ctx, p[0], p[1], p[2], "rgba(255,255,255,0.95)");
    });
  }

  // ------------------------------------------------------------------ 10. Night neon
  const NEON_COLORS = ["#D6F53C", "#FF5FA8", "#A56BFF", "#3DD5F0"];
  const NEON = [
    function (c) { starPath(c, 0, 0.05, 1, 0.46, 5, 0); },
    function (c) { c.beginPath(); c.moveTo(-1, 0.55); c.quadraticCurveTo(-0.3, -0.9, 0.85, -0.35); c.moveTo(0.3, -0.9); c.lineTo(0.9, -0.33); c.lineTo(0.2, 0.1); },
    function (c) { c.beginPath(); c.moveTo(0.25, -1); c.lineTo(-0.55, 0.15); c.lineTo(0.05, 0.15); c.lineTo(-0.3, 1); c.lineTo(0.6, -0.25); c.lineTo(0, -0.25); c.closePath(); },
    function (c) { c.beginPath(); for (let t = 0; t <= 3 * TAU; t += 0.2) { const rad = 0.08 + t / (3 * TAU) * 0.9; const x = Math.cos(t) * rad, y = Math.sin(t) * rad; if (t === 0) c.moveTo(x, y); else c.lineTo(x, y); } },
    function (c) { heartPath(c, 0, 0, 0.78); },
    function (c) { c.beginPath(); c.arc(0, 0, 0.85, 0, TAU); c.moveTo(-0.42, 0); c.lineTo(0.42, 0); c.moveTo(0, -0.42); c.lineTo(0, 0.42); },
    function (c) { c.beginPath(); for (let k = 0; k < 3; k++) { const y = -0.55 + k * 0.55; c.moveTo(-1, y); for (let x = -1; x <= 1.001; x += 0.1) c.lineTo(x, y + 0.2 * Math.sin(x * 6 + k)); } },
    function (c) { c.beginPath(); [0.95, 0.62, 0.3].forEach(function (rad) { c.moveTo(-rad, 0.5); c.arc(0, 0.5, rad, Math.PI, TAU); }); },
    function (c) { c.beginPath(); c.moveTo(-0.7, -0.7); c.lineTo(0.7, 0.7); c.moveTo(0.7, -0.7); c.lineTo(-0.7, 0.7); },
    function (c) { c.beginPath(); c.moveTo(-1, 0.4); c.lineTo(-0.6, -0.4); c.lineTo(-0.2, 0.4); c.lineTo(0.2, -0.4); c.lineTo(0.6, 0.4); c.lineTo(1, -0.4); },
    function (c) { c.beginPath(); for (let t = 0; t <= 2 * TAU + 0.01; t += 0.2) { const x = -1 + (t - 1.7 * Math.sin(t)) / (2 * TAU) * 2 * 0.95 + 0.0, y = -1.7 * Math.cos(t) * 0.3; if (t === 0) c.moveTo(x, y); else c.lineTo(x, y); } },
    function (c) { c.beginPath(); c.arc(0, 0, 0.8, 0.5, TAU - 0.5); },
    function (c) { c.beginPath(); c.moveTo(-0.9, 0.7); c.lineTo(0.02, -0.9); c.lineTo(0.9, 0.62); c.closePath(); }
  ];
  function drawNightNeon(ctx) {
    const r = makeRng(1010);
    const g = ctx.createRadialGradient(W / 2, H / 2, 150, W / 2, H / 2, 1300);
    g.addColorStop(0, "#27355E"); g.addColorStop(1, "#1A2342");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // placements: top row, bottom two rows, and the two side columns
    const spots = [];
    for (let i = 0; i < 7; i++) spots.push([70 + i * 153 + (r() - 0.5) * 30, 70 + (i % 2) * 112 + (r() - 0.5) * 24, 70 + r() * 18]);
    for (let i = 0; i < 6; i++) spots.push([115 + i * 170 + (r() - 0.5) * 30, 275 + (r() - 0.5) * 10, 34 + r() * 10]);
    for (let i = 0; i < 6; i++) { spots.push([34 + (r() - 0.5) * 14, 420 + i * 192 + (r() - 0.5) * 30, 48 + r() * 10]); spots.push([1046 + (r() - 0.5) * 14, 480 + i * 192 + (r() - 0.5) * 30, 48 + r() * 10]); }
    for (let i = 0; i < 7; i++) spots.push([75 + i * 155 + (r() - 0.5) * 30, 1650 + (i % 2) * 40 + (r() - 0.5) * 24, 68 + r() * 20]);
    for (let i = 0; i < 7; i++) spots.push([140 + i * 150 + (r() - 0.5) * 30, 1850 - (i % 2) * 20 + (r() - 0.5) * 20, 66 + r() * 16]);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    spots.forEach(function (s, i) {
      const shape = NEON[(i * 5 + 2) % NEON.length], col = NEON_COLORS[(i * 3 + (i >> 2)) % 4];
      ctx.save(); ctx.translate(s[0], s[1]); ctx.rotate((r() - 0.5) * 1.1); ctx.scale(s[2], s[2]);
      shape(ctx); ctx.strokeStyle = col; ctx.globalAlpha = 0.20; ctx.lineWidth = 0.4; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 0.2; ctx.stroke();
      ctx.restore();
    });
    // little neon dots and plus signs between
    for (let i = 0; i < 46; i++) {
      const edge = r(), x = edge < 0.5 ? r() * W : (edge < 0.75 ? r() * 80 : 1000 + r() * 80);
      const y = edge < 0.5 ? (r() < 0.5 ? 20 + r() * 250 : 1560 + r() * 340) : 300 + r() * 1220;
      ctx.fillStyle = NEON_COLORS[i % 4];
      if (i % 3 === 0) { circlePath(ctx, x, y, 5 + r() * 4); ctx.fill(); }
      else if (i % 3 === 1) fillSpark(ctx, x, y, 11 + r() * 8, "#FFFFFF");
      else { ctx.save(); ctx.strokeStyle = NEON_COLORS[i % 4]; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke(); ctx.restore(); }
    }
  }

  const DRAW = {
    "notebook": drawNotebook, "gingham": drawGingham, "wavy-checks": drawWavyChecks, "graph": drawGraph,
    "dot-journal": drawDotJournal, "polaroid": drawPolaroid, "strawberries": drawStrawberries,
    "collage": drawCollage, "watercolour": drawWatercolour, "night-neon": drawNightNeon
  };

  // ------------------------------------------------------------------ public
  function draw(ctx, id, opts) {
    opts = opts || {};
    const bg = BY_ID[id] || BY_ID.collage;
    const o = { hasText: !!opts.hasText, textLines: opts.textLines || [], markPlate: !!opts.markPlate };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.globalAlpha = 1; ctx.lineCap = "butt"; ctx.lineJoin = "miter"; noShadow(ctx);
    DRAW[bg.id](ctx, o);
    if (o.hasText && PLATE[bg.id]) PLATE[bg.id](ctx, bg, Math.max(1, o.textLines.length));
    if (o.markPlate) markPlate(ctx, bg);
    ctx.restore();
  }

  function thumbnail(id, w, h) {
    const c = mkCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    if (!c) throw new Error("No canvas available to draw the thumbnail.");
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.scale(c.width / W, c.height / H);
    draw(ctx, id, {});
    ctx.restore();
    return c;
  }

  DA.backgrounds = { LIST: LIST, draw: draw, thumbnail: thumbnail };
})();
