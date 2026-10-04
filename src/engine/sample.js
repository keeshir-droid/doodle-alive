// The built-in sample "photo": a doodle on lined notebook paper, drawn in code (no image file).
//
//   DA.sample.load() -> Promise<ImageData>     always the same picture
//   DA.sample.render(opts) -> ImageData         (for tests) other synthetic photos: faint pencil, shadows, desk, ...
//
// It is made with plain arrays, not a canvas, so it also runs in Node. It is meant to be a fair test, not a
// perfect one: the paper tone is uneven, there is a soft shadow, the ruled lines are slightly tilted, the pen
// has thick filled areas, a second small drawing in blue ballpoint sits in a corner and there is a little dust.
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});

  const INKS = {
    pen: { color: [28, 34, 64], opacity: 0.93, grain: 0.06 },
    marker: { color: [22, 22, 30], opacity: 0.97, grain: 0.04 },
    pencil: { color: [70, 72, 82], opacity: 0.32, grain: 0.4 },
    blue: { color: [30, 70, 170], opacity: 0.88, grain: 0.06 },
    red: { color: [200, 40, 60], opacity: 0.88, grain: 0.06 }
  };

  // ---------- tiny drawing kit ----------
  function Layer(W, H, ink, opacity) {
    const base = INKS[ink] || INKS.pen;
    this.W = W; this.H = H;
    this.color = base.color;
    this.opacity = opacity != null ? opacity : base.opacity;
    this.grain = base.grain;
    this.cov = new Float32Array(W * H);
  }
  Layer.prototype.segment = function (x0, y0, x1, y1, w) {
    const W = this.W, H = this.H, cov = this.cov;
    const r = w / 2 + 1;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r)), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r));
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        let t = l2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const px = x0 + t * dx - x, py = y0 + t * dy - y;
        const c = w / 2 + 0.5 - Math.sqrt(px * px + py * py);
        if (c > 0) { const i = y * W + x, v = c > 1 ? 1 : c; if (v > cov[i]) cov[i] = v; }
      }
    }
  };
  Layer.prototype.disc = function (cx, cy, r) { this.segment(cx, cy, cx, cy, r * 2); };
  Layer.prototype.fill = function (x0, y0, x1, y1, inside) { // supersampled implicit shape
    const W = this.W, cov = this.cov;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.H - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
        let n = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) n++;
        const c = n / 9;
        const i = y * W + x;
        if (c > cov[i]) cov[i] = c;
      }
    }
  };

  // A hand: wobbly, slightly uneven pen for every stroke.
  function Hand(layer, rnd, ox, oy, s, width) {
    this.L = layer; this.rnd = rnd; this.ox = ox; this.oy = oy; this.s = s; this.w = width;
  }
  Hand.prototype.line = function (pts, wMul, closed) {
    const rnd = this.rnd, s = this.s;
    const P = pts.map(function (p) { return [p[0] * s, p[1] * s]; });
    if (closed) P.push(P[0]);
    const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, f1 = 0.018 + rnd() * 0.02, f2 = 0.025 + rnd() * 0.02, amp = 1.4 * Math.max(0.6, s);
    const w0 = this.w * (wMul || 1) * Math.max(0.7, s);
    let dist = 0, px = null, py = null;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / 5));
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, d = dist + len * t;
        const X = this.ox + x + amp * Math.sin(d * f1 + ph1), Y = this.oy + y + amp * Math.sin(d * f2 + ph2);
        const w = w0 * (0.88 + 0.16 * Math.sin(d * 0.05 + ph1));
        if (px !== null) this.L.segment(px, py, X, Y, w);
        px = X; py = Y;
      }
      dist += len;
    }
  };
  Hand.prototype.arc = function (cx, cy, rx, ry, a0, a1, wMul) {
    const pts = [], n = Math.max(12, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * this.s / 6));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    this.line(pts, wMul, false);
  };
  Hand.prototype.rrect = function (x, y, w, h, r, wMul) {
    const pts = [], q = 6;
    function corner(cx, cy, a0) { for (let i = 0; i <= q; i++) { const a = a0 + (Math.PI / 2) * i / q; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } }
    corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
    this.line(pts, wMul, true);
  };
  Hand.prototype.disc = function (cx, cy, r) { this.L.disc(this.ox + cx * this.s, this.oy + cy * this.s, r * Math.max(0.7, this.s)); };
  Hand.prototype.heart = function (cx, cy, size) {
    const s = this.s, X = this.ox + cx * s, Y = this.oy + cy * s, k = size * s / 2.4;
    this.L.fill(X - 1.6 * k, Y - 1.6 * k, X + 1.6 * k, Y + 1.6 * k, function (x, y) {
      const u = (x - X) / k, v = -(y - Y) / k;
      const a = u * u + v * v - 1;
      return a * a * a - u * u * v * v * v <= 0;
    });
  };

  // ---------- the doodles (centre at 0,0, about 500 px tall at scale 1) ----------
  function drawRobot(H) {
    H.rrect(-150, -300, 300, 180, 28);
    H.line([[0, -300], [0, -360]]);
    H.disc(0, -388, 24);
    H.rrect(-178, -245, 26, 60, 8); H.rrect(152, -245, 26, 60, 8);
    H.disc(-62, -228, 20); H.disc(62, -228, 20);
    H.line([[-75, -168], [-50, -150], [-25, -170], [0, -150], [25, -170], [50, -150], [75, -168]]);
    H.line([[-30, -120], [-30, -95]]); H.line([[30, -120], [30, -95]]);
    H.rrect(-130, -95, 260, 255, 20);
    H.heart(0, 5, 100);
    H.arc(-70, 105, 16, 16, 0, 6.28); H.arc(70, 105, 16, 16, 0, 6.28);
    H.line([[-130, -40], [-210, 40], [-190, 100]]); H.line([[130, -40], [215, 25], [245, -25]]);
    H.line([[-60, 160], [-60, 262], [-100, 262]]); H.line([[60, 160], [60, 262], [100, 262]]);
  }
  function drawStar(H) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 36 : 90; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    H.line(pts, 1, true);
    H.arc(0, 130, 40, 24, 3.14, 6.28 + 1.0);
  }
  function drawCat(H) {
    H.arc(0, -100, 95, 85, 0, 6.28);
    H.line([[-80, -150], [-88, -235], [-30, -178]]); H.line([[80, -150], [88, -235], [30, -178]]);
    H.disc(-35, -110, 8); H.disc(35, -110, 8);
    H.line([[-8, -78], [8, -78], [0, -66], [-8, -78]], 0.8);
    H.line([[0, -66], [0, -52]]); H.arc(-14, -52, 14, 10, 0, 3.14); H.arc(14, -52, 14, 10, 0, 3.14);
    H.line([[-100, -85], [-165, -100]]); H.line([[-100, -70], [-165, -65]]); H.line([[100, -85], [165, -100]]); H.line([[100, -70], [165, -65]]);
    H.arc(0, 60, 110, 90, 0, 6.28);
    H.line([[-60, 135], [-60, 175]]); H.line([[60, 135], [60, 175]]);
    H.line([[105, 60], [170, 20], [200, -40], [170, -80]]);
  }
  function drawStick(H) {
    H.arc(0, -150, 42, 42, 0, 6.28);
    H.line([[0, -108], [0, 50]]);
    H.line([[-80, -60], [0, -85], [85, -55]]);
    H.line([[0, 50], [-55, 150]]); H.line([[0, 50], [60, 150]]);
    H.disc(-14, -158, 4); H.disc(14, -158, 4);
    H.arc(0, -138, 16, 10, 0.2, 2.9, 0.8);
  }
  function drawSun(H) {
    H.disc(0, 0, 58);
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      H.line([[Math.cos(a) * 85, Math.sin(a) * 85], [Math.cos(a) * 135, Math.sin(a) * 135]]);
    }
  }
  function drawBlob(H) { // a big coloured-in cloud
    [[-90, 0, 70], [-20, -45, 85], [60, -20, 80], [110, 25, 60], [10, 30, 80], [-60, 40, 55]].forEach(function (d) { H.disc(d[0], d[1], d[2]); });
  }
  const KINDS = { robot: drawRobot, star: drawStar, cat: drawCat, stick: drawStick, sun: drawSun, blob: drawBlob };

  // ---------- the photo ----------
  function render(opts) {
    opts = opts || {};
    const W = opts.w || 1200, H = opts.h || 1600;
    const rnd = DA.util.mulberry32(opts.seed || 20260401);
    const paperKind = opts.paper || "lined";           // "lined" | "grid" | "plain"
    const shadow = opts.shadow || "soft";              // "none" | "soft" | "gradient" | "strong"
    const desk = !!opts.desk;
    const tilt = (opts.tilt != null ? opts.tilt : 1.4) * Math.PI / 180;
    const doodles = opts.doodles || [
      { kind: "robot", x: 600, y: 850, s: 1, ink: "pen" },
      { kind: "star", x: 950, y: 1360, s: 0.9, ink: "blue" }
    ];

    const layers = [];
    doodles.forEach(function (d) {
      const ink = d.ink || "pen";
      const layer = new Layer(W, H, ink, d.opacity);
      layers.push(layer);
      const wid = (ink === "marker" ? 11 : (ink === "pencil" ? 4.5 : 7.5)) * (d.width || 1);
      KINDS[d.kind](new Hand(layer, rnd, d.x, d.y, d.s || 1, wid));
    });

    // dust and a fibre or two (dark dots, tiny)
    const dust = new Layer(W, H, "pen", 0.45);
    const dustN = opts.dust == null ? 14 : opts.dust;
    for (let i = 0; i < dustN; i++) dust.disc(60 + rnd() * (W - 120), 60 + rnd() * (H - 120), 1 + rnd() * 1.6);
    layers.push(dust);

    // low-frequency unevenness of the paper tone
    const G = 56, gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2;
    const lump = new Float32Array(gw * gh);
    for (let i = 0; i < lump.length; i++) lump[i] = rnd() * 2 - 1;

    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const spacing = 62, v0 = 230, marginU = 175;
    const paperRGB = opts.paperColor || [239, 235, 224];
    const lineRGB = [118, 160, 226], marginRGB = [226, 105, 105];
    const out = new Uint8ClampedArray(W * H * 4);

    // the paper on a desk: a rotated rectangle
    const pr = 0.075, deskTilt = tilt * 1.6, cD = Math.cos(deskTilt), sD = Math.sin(deskTilt);
    const pcx = W / 2, pcy = H / 2, phw = W * (0.5 - pr), phh = H * (0.5 - pr);

    for (let y = 0; y < H; y++) {
      const gy = y / G, gyi = gy | 0, fy = gy - gyi;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const gx = x / G, gxi = gx | 0, fx = gx - gxi;
        const l00 = lump[gyi * gw + gxi], l10 = lump[gyi * gw + gxi + 1], l01 = lump[(gyi + 1) * gw + gxi], l11 = lump[(gyi + 1) * gw + gxi + 1];
        const lm = (l00 * (1 - fx) + l10 * fx) * (1 - fy) + (l01 * (1 - fx) + l11 * fx) * fy;
        let illum = 1 + lm * 0.012;
        if (shadow !== "none") {
          const gd = (x / W) * 0.5 + (y / H) * 0.8;
          illum *= shadow === "gradient" ? 1.06 - 0.36 * gd : 1.0 - 0.10 * gd;
          if (shadow === "soft") {
            const dx = (x - W * 0.2) / 330, dy = (y - H * 0.16) / 260;
            illum *= 1 - 0.2 * Math.exp(-(dx * dx + dy * dy));
          } else if (shadow === "strong") {
            const dd = (x * 0.6 + y * 0.8) - 900; // a diagonal shadow edge through the drawing
            illum *= 1 - 0.34 / (1 + Math.exp(dd / 14));
          }
        }
        let r, g, b;
        let onPaper = true;
        if (desk) {
          const ux = (x - pcx) * cD + (y - pcy) * sD, uy = -(x - pcx) * sD + (y - pcy) * cD;
          const ex = phw - Math.abs(ux), ey = phh - Math.abs(uy);
          if (ex < 0 || ey < 0) {
            onPaper = false;
            const grain = 0.5 + 0.5 * Math.sin(y * 0.35 + 3 * Math.sin(x * 0.012) + lm * 3);
            const wood = 0.78 + 0.22 * grain + (rnd() - 0.5) * 0.08;
            r = 122 * wood * illum; g = 84 * wood * illum; b = 52 * wood * illum;
            const sd = Math.max(-ex, -ey); // soft shadow of the paper on the desk
            if (sd < 14) { const k = 1 - 0.3 * (1 - sd / 14); r *= k; g *= k; b *= k; }
          } else {
            const edge = Math.min(ex, ey);
            if (edge < 5) illum *= 0.9 + 0.02 * edge;
          }
        }
        if (onPaper) {
          const nz = (rnd() - 0.5) * 7;
          r = paperRGB[0] * illum + nz; g = paperRGB[1] * illum + nz; b = paperRGB[2] * illum + nz * 1.2;
          // printed lines
          if (paperKind !== "plain") {
            const v = y * cosT - x * sinT, u = x * cosT + y * sinT;
            let d = (v - v0) % spacing; if (d < 0) d += spacing; if (d > spacing / 2) d -= spacing;
            let la = Math.max(0, Math.min(1, 1.1 + 0.5 - Math.abs(d))) * 0.55;
            if (paperKind === "grid") {
              let e = (u - marginU) % spacing; if (e < 0) e += spacing; if (e > spacing / 2) e -= spacing;
              la = Math.max(la, Math.max(0, Math.min(1, 1.1 + 0.5 - Math.abs(e))) * 0.5);
            }
            if (la > 0) { r = r * (1 - la) + lineRGB[0] * illum * la; g = g * (1 - la) + lineRGB[1] * illum * la; b = b * (1 - la) + lineRGB[2] * illum * la; }
            if (paperKind === "lined") {
              const m = Math.max(0, Math.min(1, 1.1 + 0.5 - Math.abs(u - marginU))) * 0.5;
              if (m > 0) { r = r * (1 - m) + marginRGB[0] * illum * m; g = g * (1 - m) + marginRGB[1] * illum * m; b = b * (1 - m) + marginRGB[2] * illum * m; }
            }
          }
          // ink
          for (let li = 0; li < layers.length; li++) {
            const L = layers[li];
            const c = L.cov[y * W + x];
            if (c <= 0) continue;
            const a = c * L.opacity * (1 - L.grain * (rnd() * 2 - 0.4) * (L.grain > 0.2 ? 2 : 1));
            const aa = a < 0 ? 0 : (a > 1 ? 1 : a);
            r = r * (1 - aa) + L.color[0] * illum * aa; g = g * (1 - aa) + L.color[1] * illum * aa; b = b * (1 - aa) + L.color[2] * illum * aa;
          }
        }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
    }
    return DA.util.makeImageData(W, H, out);
  }

  // Harder stand-in photos for checking cleanup (tests only): ?photo=sample:<name> on tests/cleanup.html
  const CASES = {
    "faint-pencil": { paper: "lined", shadow: "gradient", doodles: [{ kind: "cat", x: 600, y: 800, s: 1.1, ink: "pencil", opacity: 0.22 }] },
    "strong-shadow": { paper: "plain", shadow: "strong", doodles: [{ kind: "robot", x: 560, y: 820, s: 1, ink: "pen" }] },
    "desk": { desk: true, paper: "lined", doodles: [{ kind: "stick", x: 600, y: 800, s: 1.5, ink: "pen" }] },
    "several": { paper: "plain", doodles: [{ kind: "sun", x: 350, y: 380, s: 0.9, ink: "marker" }, { kind: "cat", x: 800, y: 900, s: 0.9, ink: "pen" }, { kind: "stick", x: 330, y: 1300, s: 0.7, ink: "blue" }] },
    "grid-blob": { paper: "grid", doodles: [{ kind: "blob", x: 600, y: 800, s: 1.7, ink: "marker" }, { kind: "star", x: 300, y: 1350, s: 0.8, ink: "red" }] },
    "blank": { paper: "lined", doodles: [], dust: 10 },
    "very-faint": { paper: "plain", doodles: [{ kind: "cat", x: 600, y: 800, s: 1, ink: "pencil", opacity: 0.07 }] }
  };

  let cache = null;
  async function load() {
    if (!cache) cache = render({});
    // hand out a copy, so nobody can change the original
    return DA.util.makeImageData(cache.width, cache.height, new Uint8ClampedArray(cache.data));
  }

  DA.sample = { load: load, render: render, CASES: CASES };
})();
