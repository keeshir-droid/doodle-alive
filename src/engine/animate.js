// Getting a doodle ready to animate, and the motion maths.
//
//   DA.animate.prepare(doodle) -> Promise<Prepared>      traces the ink and the sticker silhouette, builds the line-boil
//                                                         variants and the "draws itself" order. Prepared is opaque.
//   DA.animate.MOTIONS                                    [{ id, name }]
//   DA.animate.TIMELINE                                   { intro: 1, loop: 5, total: 6, boilRate: 8, boilVariants: 4 }
//
// Pure functions of time (these are what makes the loop exact, and they run in Node for tests):
//   normT(t)            wraps or clamps any t into 0..6 so that t = 6 is exactly t = 1
//   introProgress(t)    0..1 eased "how much has been drawn"
//   boilIndex(t)        which boil variant (0..3) is showing
//   loopPhase(t)        0..1 phase of the 5 s motion loop (the motion keeps running through the intro, so it is smooth at t = 1)
//   pose(motionId, t, { w, h })   -> { dx, dy, rot, sx, sy, anchor: "c" | "b", jelly: null | { amp, phase }, boil }
//                       w and h = size of the doodle on the story, in story pixels. dx, dy in story pixels, rot in radians.
//   jellyShift(v, phase, amp)     sideways shift (story px) of a point v (0 = bottom .. 1 = top) of the doodle
//   jellyPoints(prepared, which, variant, pose, F, out)   displaced copy of a contour set (matte pixels)
//
// Drawing helpers used by compose.js:
//   path(prepared, "ink" | "sil", variant) -> Path2D (cached, matte pixels) or null where Path2D does not exist
//   createReveal(prepared) -> { canvas, rw, rh, ds, update(u) }   the "draws itself" mask for one consumer
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});
  const U = function () { return DA.util; };

  const MOTIONS = [
    { id: "wiggle", name: "Wiggle" },
    { id: "bounce", name: "Bounce" },
    { id: "float", name: "Float" },
    { id: "sway", name: "Sway" },
    { id: "jelly", name: "Jelly" },
    { id: "shiver", name: "Shiver" }
  ];
  const TIMELINE = { intro: 1, loop: 5, total: 6, boilRate: 8, boilVariants: 4 };
  const INTRO = 1, LOOP = 5, BOIL_N = 4, BOIL_RATE = 8;
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const NB = 512;               // "draws itself" steps
  const REVEAL_MAX = 300;       // long side of the draws-itself maps, in pixels

  // ================= time =================
  function normT(t) {
    t = +t;
    if (!isFinite(t) || !(t > 0)) return 0;
    if (t < INTRO) return t;
    return INTRO + ((t - INTRO) % LOOP);
  }
  function introProgress(t) {
    const n = normT(t);
    if (n >= INTRO) return 1;
    const x = n / INTRO;
    return x * x * (3 - 2 * x);
  }
  function boilIndex(t) {
    const n = normT(t);
    return Math.floor(n * BOIL_RATE + 1e-9) % BOIL_N;
  }
  function loopPhase(t) {
    const p = (normT(t) - INTRO) / LOOP;
    return p - Math.floor(p);
  }

  // ================= motions =================
  let SHIVER = null;
  function shiverTable() {
    if (!SHIVER) {
      const r = U().mulberry32(20261004);
      SHIVER = [];
      for (let i = 0; i < 75; i++) SHIVER.push([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]); // 15 positions a second over 5 s
    }
    return SHIVER;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function jellyShift(v, phase, amp) {
    v = clamp(v, 0, 1);
    return amp * Math.pow(v, 1.25) * Math.sin(TAU * (3 * phase - 0.9 * v));
  }

  function pose(motionId, t, size) {
    const w = (size && size.w) || 600, h = (size && size.h) || 600;
    const p = loopPhase(t);
    const o = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, anchor: "c", jelly: null, boil: boilIndex(t) };
    switch (motionId) {
      case "bounce": {
        const q = (p * 4) % 1;                          // 4 hops per loop
        const H = clamp(0.06 * h, 24, 46);
        o.anchor = "b";
        o.dy = -H * 4 * q * (1 - q);
        const speed = Math.abs(1 - 2 * q);
        const d = Math.min(q, 1 - q);
        const g = Math.exp(-(d / 0.05) * (d / 0.05));   // 1 on the ground, 0 in the air
        o.sy = 1 + 0.06 * speed * speed * (1 - g) - 0.09 * g;
        o.sx = 1 / Math.sqrt(o.sy);
        break;
      }
      case "float":
        o.dy = -clamp(0.025 * h, 12, 26) * Math.sin(TAU * 2 * p);
        o.rot = 2.5 * D2R * Math.sin(TAU * p);
        break;
      case "sway":
        o.anchor = "b";
        o.rot = 7 * D2R * Math.sin(TAU * 3 * p);
        break;
      case "jelly": {
        o.anchor = "b";
        const k = 1 + 0.022 * Math.sin(TAU * 3 * p + 1.2);   // slight breathing
        o.sx = 1 / Math.sqrt(k); o.sy = k;
        o.jelly = { amp: clamp(0.045 * Math.max(w, h), 14, 38), phase: p };
        break;
      }
      case "shiver": {
        const tab = shiverTable();
        const e = tab[Math.floor(p * tab.length) % tab.length];
        const a = clamp(0.004 * Math.max(w, h), 1.5, 4);
        o.dx = e[0] * a; o.dy = e[1] * a; o.rot = e[2] * 1 * D2R;
        break;
      }
      case "wiggle":
      default:
        o.rot = 1.5 * D2R * Math.sin(TAU * 2 * p);
        break;
    }
    return o;
  }

  // ================= contours =================
  function flatten(loops, div) {
    let n = 0;
    loops.forEach(function (l) { n += l.pts.length; });
    const pts = new Float32Array(n * 2), ends = new Int32Array(loops.length);
    let k = 0;
    loops.forEach(function (l, i) {
      for (let j = 0; j < l.pts.length; j++) { pts[k++] = l.pts[j][0] / div; pts[k++] = l.pts[j][1] / div; }
      ends[i] = k / 2;
    });
    return { pts: pts, ends: ends };
  }
  function boundsOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // A smooth random field: a handful of sine waves. Wavelengths are in story pixels (divided by F to get matte pixels).
  function makeField(seed, amp, F) {
    const r = U().mulberry32(seed);
    const T = [], total = 2.0 * amp;
    let wsum = 0;
    for (let i = 0; i < 6; i++) {
      const fine = i >= 4;
      const wl = (fine ? 26 + r() * 22 : 70 + r() * 110) / F;
      const ax = r() * TAU, ay = r() * TAU;
      const wgt = (fine ? 0.35 : 1) * (0.6 + 0.4 * r());
      T.push({ kx: TAU / wl * Math.cos(ax), ky: TAU / wl * Math.sin(ax), px: r() * TAU, kx2: TAU / wl * Math.cos(ay), ky2: TAU / wl * Math.sin(ay), py: r() * TAU, w: wgt });
      wsum += wgt;
    }
    T.forEach(function (c) { c.w = c.w / wsum * total; });
    return function (x, y, out) {
      let dx = 0, dy = 0;
      for (let i = 0; i < T.length; i++) {
        const c = T[i];
        dx += c.w * Math.sin(c.kx * x + c.ky * y + c.px);
        dy += c.w * Math.sin(c.kx2 * x + c.ky2 * y + c.py);
      }
      out[0] = dx; out[1] = dy;
    };
  }
  function nudge(base, field) {
    const out = new Float32Array(base.length), o = [0, 0];
    for (let i = 0; i < base.length; i += 2) {
      field(base[i], base[i + 1], o);
      out[i] = base[i] + o[0]; out[i + 1] = base[i + 1] + o[1];
    }
    return out;
  }

  // ================= "draws itself" =================
  // For every pixel of a small map of the doodle: how far along the pen it is. Ink pixels get their walking distance along the
  // ink (a breadth-first walk from one end of each blob, blobs taken left to right); empty pixels take the value of the nearest
  // ink pixel so that a slightly moved (boiled, jelly) line is never cut off. Pixels are then sorted into NB steps.
  // a pixel of the small map is ink if any matte pixel under it is (a small function on purpose: it gets optimised fast)
  function downInk(alpha, w, h, ds, rw, rh) {
    const out = new Uint8Array(rw * rh);
    for (let y = 0; y < h; y++) {
      const orow = ((y / ds) | 0) * rw, row = y * w;
      for (let x = 0; x < w; x++) {
        if (alpha[row + x] >= 77) out[orow + ((x / ds) | 0)] = 1;
      }
    }
    return out;
  }
  function buildReveal(alpha, w, h) {
    const P0 = U().now(), prof = {};
    const ds = Math.max(1, Math.ceil(Math.max(w, h) / REVEAL_MAX));
    const rw = Math.ceil(w / ds), rh = Math.ceil(h / ds), n = rw * rh;
    const ink = downInk(alpha, w, h, ds, rw, rh);
    prof.down = Math.round(U().now() - P0);
    const lab = U().labelBlobs(ink, rw, rh);
    prof.label = Math.round(U().now() - P0);
    const comps = lab.comps.slice().sort(function (a, b) { return a.x0 - b.x0 || a.y0 - b.y0; });
    const dist = new Float32Array(n).fill(-1);
    const q = new Int32Array(n), d = new Int32Array(n), seen = new Int32Array(n);
    let stamp = 0;
    function bfs(start) {            // walks the blob; returns the queue length (q holds the pixels, d their distances)
      stamp++;
      let head = 0, tail = 0;
      q[tail++] = start; seen[start] = stamp; d[start] = 0;
      while (head < tail) {
        const p = q[head++], py = (p / rw) | 0, px = p - py * rw, dp = d[p] + 1;
        const ya = py > 0 ? py - 1 : 0, yb = py < rh - 1 ? py + 1 : rh - 1;
        const xa = px > 0 ? px - 1 : 0, xb = px < rw - 1 ? px + 1 : rw - 1;
        for (let ny = ya; ny <= yb; ny++) {
          for (let nx = xa; nx <= xb; nx++) {
            const m = ny * rw + nx;
            if (ink[m] && seen[m] !== stamp) { seen[m] = stamp; d[m] = dp; q[tail++] = m; }
          }
        }
      }
      return tail;
    }
    let offset = 0;
    comps.forEach(function (c) {
      let len = bfs(c.start);
      const A = q[len - 1];
      len = bfs(A);
      const B = q[len - 1], maxd = d[B];
      const ax = A % rw, bx = B % rw, ay = (A / rw) | 0, by = (B / rw) | 0;
      const bFirst = bx < ax - 1 || (Math.abs(bx - ax) <= 1 && by < ay);
      if (bFirst) len = bfs(B);
      for (let i = 0; i < len; i++) dist[q[i]] = offset + d[q[i]];
      offset += maxd + 6;
    });
    const total = Math.max(1, offset - 6);
    prof.bfs = Math.round(U().now() - P0); prof.comps = comps.length;
    // spread to the empty pixels (a flood from all ink pixels at once)
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) if (ink[i]) q[tail++] = i;
    if (tail === 0) { for (let i = 0; i < n; i++) dist[i] = 0; }
    while (head < tail) {
      const p = q[head++], py = (p / rw) | 0, px = p - py * rw, dv = dist[p];
      if (px > 0 && dist[p - 1] < 0) { dist[p - 1] = dv; q[tail++] = p - 1; }
      if (px < rw - 1 && dist[p + 1] < 0) { dist[p + 1] = dv; q[tail++] = p + 1; }
      if (py > 0 && dist[p - rw] < 0) { dist[p - rw] = dv; q[tail++] = p - rw; }
      if (py < rh - 1 && dist[p + rw] < 0) { dist[p + rw] = dv; q[tail++] = p + rw; }
    }
    // the empty pixels' values are smoothed, so the edge of the revealed area (it also uncovers the white outline) is a soft wipe,
    // not the ragged borders between nearest-ink regions. Ink pixels keep their exact value.
    const smooth = U().boxBlur(dist, rw, rh, 5, 2);
    for (let i = 0; i < n; i++) if (!ink[i]) dist[i] = smooth[i];
    prof.flood = Math.round(U().now() - P0);
    // sort into NB steps
    const bucket = new Uint16Array(n), starts = new Int32Array(NB + 1);
    for (let i = 0; i < n; i++) {
      let b = Math.floor(dist[i] / total * NB);
      if (b < 0) b = 0; if (b > NB - 1) b = NB - 1;
      bucket[i] = b; starts[b + 1]++;
    }
    for (let b = 0; b < NB; b++) starts[b + 1] += starts[b];
    const fillAt = starts.slice(0, NB), order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[fillAt[bucket[i]]++] = i;
    prof.sort = Math.round(U().now() - P0);
    return { rw: rw, rh: rh, ds: ds, order: order, starts: starts, prof: prof };
  }

  // One mask per consumer (preview, export, ...), because it remembers how far it has been revealed.
  function createReveal(prep) {
    const R = prep.reveal;
    const canvas = U().createCanvas(R.rw, R.rh);
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(R.rw, R.rh);
    const px = new Uint32Array(img.data.buffer);
    let done = 0;
    return {
      canvas: canvas, rw: R.rw, rh: R.rh, ds: R.ds,
      update: function (u) {
        const target = u >= 1 ? NB : (u <= 0 ? 0 : Math.floor(u * NB));
        if (target === done) return canvas;
        if (target < done) { px.fill(0); done = 0; }
        for (let b = done; b < target; b++) {
          for (let k = R.starts[b], e = R.starts[b + 1]; k < e; k++) px[R.order[k]] = 0xFFFFFFFF;
        }
        ctx.putImageData(img, 0, 0);
        done = target;
        return canvas;
      }
    };
  }

  // ================= prepare =================
  const tick = function () { return new Promise(function (res) { setTimeout(res, 0); }); };

  async function prepare(doodle) {
    if (!doodle || !doodle._matte || !doodle._sil) throw U().error("unreadable");
    const t0 = U().now(), tm = {};
    const m = doodle._matte, s = doodle._sil, k = s.k || 1;
    const F0 = (doodle._story && doodle._story.fit) || 1;
    const T0 = (doodle._story && doodle._story.outline) || 18;

    // ink: lift thin lines a little so they survive the trace, then trace
    // (faint pencil gets a bigger lift than pen: the gain follows how strong the strong ink is)
    const hist = new Uint32Array(256);
    let cnt = 0;
    for (let i = 0; i < m.alpha.length; i++) { const a = m.alpha[i]; if (a >= 30) { hist[a]++; cnt++; } }
    let hi = 255;
    if (cnt) { let acc = 0; for (let a = 0; a < 256; a++) { acc += hist[a]; if (acc >= cnt * 0.9) { hi = a; break; } } }
    const gain = clamp(0.95 * 255 / Math.max(hi, 60), 1.3, 2.4);
    const boosted = new Uint8Array(m.alpha.length);
    for (let i = 0; i < boosted.length; i++) { const v = m.alpha[i] * gain; boosted[i] = v > 255 ? 255 : v; }
    const inkT = DA.trace.traceMask(boosted, m.w, m.h, { sigma: 0.8, eps: 0.35, minArea: 3, maxPoints: 5000 });
    tm.traceInk = Math.round(U().now() - t0);
    await tick();
    const t1 = U().now();
    const silT = DA.trace.traceMask(s.solid || s.alpha, s.w, s.h, { sigma: 1.0, eps: 0.5, minArea: 20, maxPoints: 2000 });
    tm.traceSil = Math.round(U().now() - t1);
    const ink = flatten(inkT.loops.filter(function (l) { return l.pts.length >= 3; }), 1);
    const sil = flatten(silT.loops, k);
    if (!ink.ends.length) throw U().error("no-doodle");
    const bbox = boundsOf(ink.pts);
    const silBox = sil.ends.length ? boundsOf(sil.pts) : bbox;
    silBox.x0 = Math.min(silBox.x0, bbox.x0); silBox.y0 = Math.min(silBox.y0, bbox.y0);
    silBox.x1 = Math.max(silBox.x1, bbox.x1); silBox.y1 = Math.max(silBox.y1, bbox.y1);

    // boil variants: the whole doodle nudged by a smooth random field, 4 different ones
    await tick();
    const t2 = U().now();
    const diag = Math.hypot(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) * F0;
    const amp = clamp(0.003 * diag, 1.5, 4) / F0;
    const inkV = [], silV = [];
    for (let v = 0; v < BOIL_N; v++) {
      const field = makeField(7001 + v * 97, amp, F0);
      inkV.push(nudge(ink.pts, field));
      silV.push(nudge(sil.pts, field));
    }
    tm.boil = Math.round(U().now() - t2);

    await tick();
    const t3 = U().now();
    const reveal = buildReveal(m.alpha, m.w, m.h);
    tm.reveal = Math.round(U().now() - t3);
    tm.total = Math.round(U().now() - t0);

    return {
      _v: 1,
      inkColor: doodle.inkColor,
      w: m.w, h: m.h,
      bbox: bbox, silBox: silBox,
      F0: F0, T0: T0, amp: amp,
      ink: { ends: ink.ends, base: ink.pts, variants: inkV },
      sil: { ends: sil.ends, base: sil.pts, variants: silV },
      reveal: reveal,
      points: { ink: ink.pts.length / 2, sil: sil.pts.length / 2 },
      timings: tm,
      _paths: {}
    };
  }

  // ================= drawing helpers =================
  function buildPath(P, arr, ends) {
    const p = new P();
    let a = 0;
    for (let l = 0; l < ends.length; l++) {
      const e = ends[l];
      p.moveTo(arr[a * 2], arr[a * 2 + 1]);
      for (let i = a + 1; i < e; i++) p.lineTo(arr[i * 2], arr[i * 2 + 1]);
      p.closePath();
      a = e;
    }
    return p;
  }
  function path(prep, which, variant) {
    if (typeof Path2D === "undefined") return null;
    const key = which + (variant < 0 ? "B" : variant);
    let p = prep._paths[key];
    if (!p) {
      const set = prep[which];
      p = prep._paths[key] = buildPath(Path2D, variant < 0 ? set.base : set.variants[variant], set.ends);
    }
    return p;
  }
  function warm(prep) { for (let v = 0; v < BOIL_N; v++) { path(prep, "ink", v); path(prep, "sil", v); } path(prep, "ink", -1); path(prep, "sil", -1); }

  // contour set displaced for the Jelly motion (matte pixels in, matte pixels out). `out` is reused if it is big enough.
  function jellyPoints(prep, which, variant, ps, F, out) {
    const set = prep[which], src = variant < 0 ? set.base : set.variants[variant];
    if (!out || out.length !== src.length) out = new Float32Array(src.length);
    const y0 = prep.bbox.y0, y1 = prep.bbox.y1, hh = Math.max(1, y1 - y0);
    const amp = ps.jelly.amp, ph = ps.jelly.phase;
    for (let i = 0; i < src.length; i += 2) {
      const v = (y1 - src[i + 1]) / hh;
      out[i] = src[i] + jellyShift(v, ph, amp) / F;
      out[i + 1] = src[i + 1];
    }
    return out;
  }

  DA.animate = {
    MOTIONS: MOTIONS, TIMELINE: TIMELINE,
    prepare: prepare,
    normT: normT, introProgress: introProgress, boilIndex: boilIndex, loopPhase: loopPhase,
    pose: pose, jellyShift: jellyShift, jellyPoints: jellyPoints,
    path: path, warm: warm, createReveal: createReveal,
    _buildReveal: buildReveal, _makeField: makeField
  };
})();
