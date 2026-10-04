// Matte -> contours. Copied from Day 2's tracer (blur, marching squares, simplify) with the font parts dropped.
//
//   DA.trace.traceMask(alphaU8, w, h, opts?) -> { loops: [{ pts:[[x,y],...], area, hole }], points, outer, holes }
//     Coordinates are in mask pixels (pixel centres at +0.5). Ink is where alpha >= 128.
//     opts: sigma (blur, default 1), eps (simplify tolerance in px, default 0.6), minArea (default 6),
//           maxPoints (if exceeded, simplifies more; default 4000)
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});

  const PAD = 3;

  function blur(field, W, H, sigma) {
    const rad = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(rad * 2 + 1);
    let sum = 0;
    for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + rad]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) {
          const xx = x + i;
          if (xx >= 0 && xx < W) s += field[y * W + xx] * k[i + rad];
        }
        tmp[y * W + x] = s;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) {
          const yy = y + i;
          if (yy >= 0 && yy < H) s += tmp[yy * W + x] * k[i + rad];
        }
        out[y * W + x] = s;
      }
    }
    return out;
  }

  // Marching squares at level 0.5; segments are directed so ink is always on the same side.
  function marchingSquares(f, W, H) {
    const HW = W * H;
    const next = new Int32Array(2 * HW).fill(-1);
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const vA = f[j * W + i], vB = f[j * W + i + 1], vC = f[(j + 1) * W + i + 1], vD = f[(j + 1) * W + i];
        const code = (vA >= 0.5 ? 8 : 0) | (vB >= 0.5 ? 4 : 0) | (vC >= 0.5 ? 2 : 0) | (vD >= 0.5 ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const T = j * W + i, B = (j + 1) * W + i, L = HW + j * W + i, R = HW + j * W + i + 1;
        switch (code) {
          case 8: next[L] = T; break;
          case 4: next[T] = R; break;
          case 2: next[R] = B; break;
          case 1: next[B] = L; break;
          case 12: next[L] = R; break;
          case 6: next[T] = B; break;
          case 3: next[R] = L; break;
          case 9: next[B] = T; break;
          case 14: next[L] = B; break;
          case 7: next[T] = L; break;
          case 11: next[R] = T; break;
          case 13: next[B] = R; break;
          case 10:
            if ((vA + vB + vC + vD) / 4 >= 0.5) { next[R] = T; next[L] = B; } else { next[L] = T; next[R] = B; }
            break;
          case 5:
            if ((vA + vB + vC + vD) / 4 >= 0.5) { next[T] = L; next[B] = R; } else { next[T] = R; next[B] = L; }
            break;
        }
      }
    }
    function pos(id) {
      if (id < HW) {
        const j = (id / W) | 0, i = id - j * W;
        const a = f[id], b = f[id + 1];
        return [i + (0.5 - a) / (b - a), j];
      }
      const id2 = id - HW, j = (id2 / W) | 0, i = id2 - j * W;
      const a = f[id2], b = f[id2 + W];
      return [i, j + (0.5 - a) / (b - a)];
    }
    const used = new Uint8Array(2 * HW);
    const loops = [];
    for (let s = 0; s < 2 * HW; s++) {
      if (next[s] < 0 || used[s]) continue;
      const loop = [];
      let cur = s;
      while (cur >= 0 && !used[cur]) {
        used[cur] = 1;
        loop.push(pos(cur));
        cur = next[cur];
      }
      if (cur === s && loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  function polyArea(p) { // signed (shoelace)
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const u = p[i], v = p[(i + 1) % n];
      a += u[0] * v[1] - v[0] * u[1];
    }
    return a / 2;
  }

  function rdp(arr, from, to, eps) {
    const keep = new Uint8Array(arr.length);
    keep[from] = 1; keep[to] = 1;
    const stack = [[from, to]];
    while (stack.length) {
      const seg = stack.pop();
      const a = arr[seg[0]], b = arr[seg[1]];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      let worst = -1, wd = eps;
      for (let i = seg[0] + 1; i < seg[1]; i++) {
        const p = arr[i];
        const d = len > 1e-9 ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len : Math.hypot(p[0] - a[0], p[1] - a[1]);
        if (d > wd) { wd = d; worst = i; }
      }
      if (worst >= 0) { keep[worst] = 1; stack.push([seg[0], worst], [worst, seg[1]]); }
    }
    const out = [];
    for (let i = from; i <= to; i++) if (keep[i]) out.push(arr[i]);
    return out;
  }

  function simplifyClosed(pts, eps) {
    const n = pts.length;
    if (n < 6) return pts;
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) {
      const d = (pts[i][0] - pts[0][0]) * (pts[i][0] - pts[0][0]) + (pts[i][1] - pts[0][1]) * (pts[i][1] - pts[0][1]);
      if (d > fd) { fd = d; far = i; }
    }
    const arr = pts.concat([pts[0]]);
    const h1 = rdp(arr, 0, far, eps);
    const h2 = rdp(arr, far, n, eps);
    return h1.concat(h2.slice(1, h2.length - 1));
  }

  function pointInPoly(x, y, pts) { // pts: [[x,y],...]
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function traceMask(alpha, w, h, opts) {
    opts = opts || {};
    const sigma = opts.sigma == null ? 1.0 : opts.sigma;
    let eps = opts.eps == null ? 0.6 : opts.eps;
    const minArea = opts.minArea == null ? 6 : opts.minArea;
    const maxPoints = opts.maxPoints || 4000;
    const W = w + PAD * 2, H = h + PAD * 2;
    const field = new Float32Array(W * H);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) field[(y + PAD) * W + x + PAD] = alpha[y * w + x] / 255;
    }
    const smooth = sigma > 0 ? blur(field, W, H, sigma) : field;
    const raw = marchingSquares(smooth, W, H).filter(function (l) { return Math.abs(polyArea(l)) >= minArea; });
    if (!raw.length) return { loops: [], points: 0, outer: 0, holes: 0 };

    // Ink is on the same side of every directed loop, so the sign of the area tells outer shapes from holes.
    let big = raw[0], bigA = Math.abs(polyArea(raw[0]));
    raw.forEach(function (l) { const a = Math.abs(polyArea(l)); if (a > bigA) { bigA = a; big = l; } });
    const outerSign = polyArea(big) > 0 ? 1 : -1;

    let loops, points, tries = 0;
    do {
      loops = []; points = 0;
      raw.forEach(function (l) {
        const s = simplifyClosed(l, eps);
        const a = polyArea(s);
        if (s.length < 3 || Math.abs(a) < minArea) return;
        const pts = s.map(function (p) { return [p[0] - PAD + 0.5, p[1] - PAD + 0.5]; });
        loops.push({ pts: pts, area: Math.abs(a), hole: (a > 0 ? 1 : -1) !== outerSign });
        points += pts.length;
      });
      eps *= 1.5; tries++;
    } while (points > maxPoints && tries < 6);
    let outer = 0, holes = 0;
    loops.forEach(function (l) { if (l.hole) holes++; else outer++; });
    return { loops: loops, points: points, outer: outer, holes: holes };
  }

  DA.trace = {
    traceMask: traceMask,
    blur: blur, marchingSquares: marchingSquares, polyArea: polyArea, rdp: rdp, simplifyClosed: simplifyClosed, pointInPoly: pointInPoly
  };
})();
