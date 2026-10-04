// Cleanup: photo -> doodles. Everything runs on plain arrays (no browser features), so it also runs in Node.
//
//   DA.cleanup.findDoodles(imageData, opts?) -> Promise<CleanupResult>     (ENGINE.md section 4)
//   DA.cleanup.doodleAt(result, x, y)        -> index in result.doodles, or -1
//
// How it works (TECH.md section 3), in plain words:
//  1. Work out what the blank paper would look like at every spot (uneven light and shadows included): take the
//     brightest typical value in small blocks, then "close" it (grow bright, shrink back) so dark ink thinner than
//     about a tenth of the photo disappears from the estimate while shadows stay. Unlike Day 2's local average this
//     does not hollow out thick strokes or coloured-in areas.
//  2. Ink amount = how much darker than the paper estimate a pixel is (relative to the paper brightness), with
//     the noise level measured from the photo itself. The soft matte ramps from "just above noise" to "clearly ink",
//     and the top of the ramp follows how dark this photo's ink really is, so light pencil survives.
//  3. Ruled and grid lines: long, thin, parallel bands (found per part of the page so a tilted or slightly fanned
//     page still works). Where ink crosses a line we keep pixels clearly darker than the line and bridge the gap.
//  4. Despeckle, group nearby blobs into doodles, pick the biggest by ink, crop, measure the pen colour, and build
//     the white sticker silhouette (outline + filled small holes).
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});
  const U = function () { return DA.util; };

  const MAX_MATTE = 900;       // long side of the stored matte
  const STORY_BOX_W = 840, STORY_BOX_H = 900; // DESIGN.md section 8: the doodle box in the story

  // ================= paper brightness estimate =================

  function morph(src, W, H, R, wantMax) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const xa = x - R < 0 ? 0 : x - R, xb = x + R >= W ? W - 1 : x + R;
        let m = src[y * W + xa];
        for (let xx = xa + 1; xx <= xb; xx++) { const v = src[y * W + xx]; if (wantMax ? v > m : v < m) m = v; }
        tmp[y * W + x] = m;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const ya = y - R < 0 ? 0 : y - R, yb = y + R >= H ? H - 1 : y + R;
        let m = tmp[ya * W + x];
        for (let yy = ya + 1; yy <= yb; yy++) { const v = tmp[yy * W + x]; if (wantMax ? v > m : v < m) m = v; }
        out[y * W + x] = m;
      }
    }
    return out;
  }

  // What would blank paper look like here? Returns a full-size Float32 map of expected paper brightness.
  function paperEstimate(gray, w, h) {
    const long = Math.max(w, h);
    const f = Math.max(2, Math.round(long / 200));
    const lw = Math.ceil(w / f), lh = Math.ceil(h / f);
    const low = new Float32Array(lw * lh);
    const step = Math.max(1, Math.round(f / 3)), buf = new Uint8Array(64);
    for (let by = 0; by < lh; by++) {
      for (let bx = 0; bx < lw; bx++) {
        let n = 0;
        const ye = Math.min(h, (by + 1) * f), xe = Math.min(w, (bx + 1) * f);
        for (let y = by * f; y < ye; y += step) {
          for (let x = bx * f; x < xe; x += step) {
            const v = gray[y * w + x];
            let j = n++;
            while (j > 0 && buf[j - 1] > v) { buf[j] = buf[j - 1]; j--; }
            buf[j] = v;
          }
        }
        low[by * lw + bx] = buf[Math.floor(0.8 * (n - 1))];
      }
    }
    const R =Math.max(2, Math.min(Math.round(0.11 * long / f), Math.floor(Math.min(lw, lh) / 2)));
    // Pad the edges first: where the light fades towards a border, carry the fade on outwards (never brighten),
    // otherwise "closing" would leave the paper estimate too bright along that border.
    const PW = lw + 2 * R, PH = lh + 2 * R;
    const pad = new Float32Array(PW * PH);
    function sideSlope(get, n) { // average fade per block, outward; only the darkening kind is used
      let a = 0, b = 0;
      for (let i = 0; i < n; i++) { a += (get(i, 0) + get(i, 1) + get(i, 2)) / 3; b += (get(i, 3) + get(i, 4) + get(i, 5)) / 3; }
      const s = (a - b) / n / 3;
      return s < 0 ? Math.max(s, -3) : 0;
    }
    if (lw > 8 && lh > 8) {
      const sT = sideSlope(function (i, k) { return low[k * lw + i]; }, lw);
      const sB = sideSlope(function (i, k) { return low[(lh - 1 - k) * lw + i]; }, lw);
      const sL = sideSlope(function (i, k) { return low[i * lw + k]; }, lh);
      const sR = sideSlope(function (i, k) { return low[i * lw + (lw - 1 - k)]; }, lh);
      for (let y = 0; y < PH; y++) {
        for (let x = 0; x < PW; x++) {
          const ix = x - R, iy = y - R;
          const cx = ix < 0 ? 0 : (ix >= lw ? lw - 1 : ix), cy = iy < 0 ? 0 : (iy >= lh ? lh - 1 : iy);
          let v = low[cy * lw + cx];
          if (iy < 0) v += sT * -iy; else if (iy >= lh) v += sB * (iy - lh + 1);
          if (ix < 0) v += sL * -ix; else if (ix >= lw) v += sR * (ix - lw + 1);
          pad[y * PW + x] = v < 0 ? 0 : v;
        }
      }
    } else {
      for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) pad[y * PW + x] = low[Math.min(lh - 1, Math.max(0, y - R)) * lw + Math.min(lw - 1, Math.max(0, x - R))];
    }
    const closedPad = morph(morph(pad, PW, PH, R, true), PW, PH, R, false); // close: grow bright, shrink back
    let closed = new Float32Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) closed[y * lw + x] = closedPad[(y + R) * PW + x + R];
    closed =U().boxBlur(closed, lw, lh, 2, 2);
    // bilinear back up to full size
    const est = new Float32Array(w * h);
    const x0s = new Int32Array(w), fxs = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const g = Math.min(lw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const i = Math.min(lw - 2 < 0 ? 0 : lw - 2, g | 0);
      x0s[x] = i; fxs[x] = lw > 1 ? g - i : 0;
    }
    // interpolate along x once per block row, then blend two such lines for every output row
    function lineFor(j, out) {
      const base = j * lw;
      for (let x = 0; x < w; x++) { const i = x0s[x], fx = fxs[x]; out[x] = closed[base + i] + (closed[base + (i + 1 < lw ? i + 1 : i)] - closed[base + i]) * fx; }
    }
    let la = new Float32Array(w), lb = new Float32Array(w), ja = -1, jb = -1;
    for (let y = 0; y < h; y++) {
      const g = Math.min(lh - 1, Math.max(0, (y + 0.5) / f - 0.5));
      const j = Math.min(lh - 2 < 0 ? 0 : lh - 2, g | 0), fy = lh > 1 ? g - j : 0;
      const j1 = Math.min(lh - 1, j + 1);
      if (ja !== j) { if (jb === j) { const t = la; la = lb; lb = t; ja = jb; jb = -1; } else { lineFor(j, la); ja = j; } }
      if (jb !== j1) { lineFor(j1, lb); jb = j1; }
      const o = y * w, fy0 = 1 - fy;
      for (let x = 0; x < w; x++) est[o + x] = la[x] * fy0 + lb[x] * fy;
    }
    return { est: est, low: closed, lw: lw, lh: lh, f: f };
  }

  // ================= finding the paper on a table (from Day 2) =================

  function paperRegion(gray, w, h) {
    const f = 8;
    const lw = Math.floor(w / f), lh = Math.floor(h / f);
    if (lw < 20 || lh < 20) return null;
    let cur = new Float32Array(lw * lh);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        let s = 0;
        for (let dy = 0; dy < f; dy += 2) for (let dx = 0; dx < f; dx += 2) s += gray[(y * f + dy) * w + x * f + dx];
        cur[y * lw + x] = s / ((f / 2) * (f / 2));
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const nxt = new Float32Array(lw * lh);
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          let s = 0, c = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const yy = y + dy, xx = x + dx;
              if (yy < 0 || yy >= lh || xx < 0 || xx >= lw) continue;
              s += cur[yy * lw + xx]; c++;
            }
          }
          nxt[y * lw + x] = s / c;
        }
      }
      cur = nxt;
    }
    const hist = new Float64Array(256);
    for (let i = 0; i < cur.length; i++) hist[Math.min(255, Math.max(0, cur[i] | 0))]++;
    const total = cur.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let wB = 0, sumB = 0, best = -1, thr = 128, gap = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; gap = mF - mB; }
    }
    if (gap < 45) return null;
    const bright = new Uint8Array(lw * lh);
    for (let i = 0; i < bright.length; i++) bright[i] = cur[i] > thr ? 1 : 0;
    let borderBright = 0, borderTotal = 0;
    for (let x = 0; x < lw; x++) { borderBright += bright[x] + bright[(lh - 1) * lw + x]; borderTotal += 2; }
    for (let y = 1; y < lh - 1; y++) { borderBright += bright[y * lw] + bright[y * lw + lw - 1]; borderTotal += 2; }
    if (borderBright / borderTotal > 0.5) return null;
    const seen = new Uint8Array(lw * lh), stack = new Int32Array(lw * lh);
    let bestList = null;
    for (let s0 = 0; s0 < bright.length; s0++) {
      if (!bright[s0] || seen[s0]) continue;
      const list = [];
      let sp = 0;
      stack[sp++] = s0; seen[s0] = 1;
      while (sp) {
        const p = stack[--sp];
        list.push(p);
        const py = (p / lw) | 0, px = p - py * lw;
        if (px > 0 && bright[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (px < lw - 1 && bright[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (py > 0 && bright[p - lw] && !seen[p - lw]) { seen[p - lw] = 1; stack[sp++] = p - lw; }
        if (py < lh - 1 && bright[p + lw] && !seen[p + lw]) { seen[p + lw] = 1; stack[sp++] = p + lw; }
      }
      if (!bestList || list.length > bestList.length) bestList = list;
    }
    if (!bestList) return null;
    const frac = bestList.length / (lw * lh);
    if (frac < 0.25 || frac > 0.96) return null;
    let page = new Uint8Array(lw * lh);
    bestList.forEach(function (p) { page[p] = 1; });
    const outside = new Uint8Array(lw * lh);
    let osp = 0;
    function pushOutside(p) { if (!page[p] && !outside[p]) { outside[p] = 1; stack[osp++] = p; } }
    for (let x = 0; x < lw; x++) { pushOutside(x); pushOutside((lh - 1) * lw + x); }
    for (let y = 0; y < lh; y++) { pushOutside(y * lw); pushOutside(y * lw + lw - 1); }
    while (osp) {
      const p = stack[--osp];
      const py = (p / lw) | 0, px = p - py * lw;
      if (px > 0) pushOutside(p - 1);
      if (px < lw - 1) pushOutside(p + 1);
      if (py > 0) pushOutside(p - lw);
      if (py < lh - 1) pushOutside(p + lw);
    }
    for (let i = 0; i < page.length; i++) page[i] = outside[i] ? 0 : 1;
    for (let pass = 0; pass < 3; pass++) { // shrink so the paper edge and its shadow line are left out
      const nxt = new Uint8Array(lw * lh);
      for (let y = 1; y < lh - 1; y++) {
        for (let x = 1; x < lw - 1; x++) {
          const i = y * lw + x;
          if (page[i] && page[i - 1] && page[i + 1] && page[i - lw] && page[i + lw]) nxt[i] = 1;
        }
      }
      page = nxt;
    }
    let x0 = lw, y0 = lh, x1 = -1, y1 = -1;
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (page[y * lw + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    return { page: page, lw: lw, lh: lh, f: f, bbox: { x0: x0 * f, y0: y0 * f, x1: Math.min(w - 1, (x1 + 1) * f - 1), y1: Math.min(h - 1, (y1 + 1) * f - 1) } };
  }

  // ================= ruled and grid lines =================

  // Finds long, thin, parallel bands, per part of the page, and wipes them from `rel` (the ink amount).
  // Returns the bands found; marks wiped pixels in lineMask.
  function removeLines(rel, lineMask, w, h, lo, bbox, S, img, est, kc) {
    const data = img.data;
    const bands = [];
    const PROF = {};
    const Tmax =Math.max(7, Math.round(10 * S));

    function family(fam) {
      const nA = fam === 0 ? w : h, nB = fam === 0 ? h : w;
      const sA = fam === 0 ? 1 : w, sB = fam === 0 ? w : 1;
      const a0 = fam === 0 ? bbox.x0 : bbox.y0, a1 = fam === 0 ? bbox.x1 : bbox.y1;
      const b0 = fam === 0 ? bbox.y0 : bbox.x0, b1 = fam === 0 ? bbox.y1 : bbox.x1;
      const E = a1 - a0 + 1;
      if (E < 160 * S) return;
      // candidate pixels (every second column of the family direction)
      const P0 = U().now();
      const CAP = 400000;
      const ca = new Int32Array(CAP), cb = new Int32Array(CAP);
      let nc = 0;
      // (only light-to-medium marks: dark solid pen areas must not steer the tilt search)
      const top = 0.5;
      if (fam === 0) {
        for (let b = b0; b <= b1 && nc < CAP; b++) { const row = b * w; for (let a = a0; a <= a1; a += 2) { const r = rel[row + a]; if (r > lo && r <= top && nc < CAP) { ca[nc] = a; cb[nc] = b; nc++; } } }
      } else {
        for (let a = a0; a <= a1 && nc < CAP; a += 2) { const row = a * w; for (let b = b0; b <= b1; b++) { const r = rel[row + b]; if (r > lo && r <= top && nc < CAP) { ca[nc] = a; cb[nc] = b; nc++; } } }
      }
      PROF.scan = (PROF.scan || 0) + U().now() - P0;
      if (nc < 300) return;
      let Wl = Math.round(0.36 * E);
      Wl = Math.min(E, Math.max(Wl, Math.round(240 * S)));
      // windows: overlapping parts of the page (copes with a tilted or fanned page), plus the whole length
      // (copes with lines hidden behind a big solid doodle in some parts)
      const wins = [];
      if (Wl < E) wins.push([a0, a1 + 1]);                 // the whole length goes first: its tilt is the hint
      for (let s = a0; s + Wl <= a1 + 1; s += Math.round(Wl / 2)) wins.push([s, s + Wl]);
      if (wins.length === (Wl < E ? 1 : 0) || wins[wins.length - 1][1] < a1 - 8) wins.push([Math.max(a0, a1 + 1 - Wl), a1 + 1]);
      const nV = nA + nB + 4;
      const hist = new Float32Array(nV);
      let hint = null;

      wins.forEach(function (win, wi) {
        const ws = win[0], we = win[1], Wl = we - ws;
        const Q0 = U().now();
        let np = 0;
        for (let i = 0; i < nc; i++) if (ca[i] >= ws && ca[i] < we) np++;
        if (np < 150) return;
        const pa = new Int32Array(np), pb = new Int32Array(np);
        for (let i = 0, j = 0; i < nc; i++) if (ca[i] >= ws && ca[i] < we) { pa[j] = ca[i]; pb[j] = cb[i]; j++; }
        // search with at most ~12000 points; the final histogram uses all of them
        const sub = Math.max(1, Math.ceil(np / 12000));
        function score(deg, stride) {
          const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
          hist.fill(0);
          for (let i = 0; i < np; i += stride) hist[((pb[i] * c - pa[i] * s) + nA) | 0]++;
          let sum = 0;
          for (let i = 0; i < nV; i++) sum += hist[i] * hist[i];
          return sum;
        }
        let best = 0, bestS = -1;
        if (hint === null || (Wl >= E)) {
          for (let d = -24; d <= 24; d += 2) { const sc = score(d, sub); if (sc > bestS) { bestS = sc; best = d; } }
          let c0 = best;
          for (let d = c0 - 2; d <= c0 + 2; d += 0.5) { const sc = score(d, sub); if (sc > bestS) { bestS = sc; best = d; } }
        } else {
          for (let d = hint - 3; d <= hint + 3; d += 0.5) { const sc = score(d, sub); if (sc > bestS) { bestS = sc; best = d; } }
        }
        let c0 = best;
        for (let d = c0 - 0.5; d <= c0 + 0.5; d += 0.125) { const sc = score(d, sub); if (sc > bestS) { bestS = sc; best = d; } }
        if (wi === 0) hint = best;
        const theta = best * Math.PI / 180, cosT = Math.cos(theta), sinT = Math.sin(theta);
        score(best, 1);
        PROF.search = (PROF.search || 0) + U().now() - Q0;
        const Q1 = U().now();
        const ncols = Math.ceil(Wl / 2), need = 0.42 * ncols;
        // runs of "busy" rows (bins), allowing a one-bin gap
        const runs = [];
        let i = 0;
        while (i < nV) {
          if (hist[i] < need) { i++; continue; }
          let j = i, last = i;
          while (j + 1 < nV && (hist[j + 1] >= need || (j + 2 < nV && hist[j + 2] >= need))) { j++; if (hist[j] >= need) last = j; }
          runs.push([i, last]);
          i = last + 1;
        }
        const cands = [];
        runs.forEach(function (r) {
          const T = r[1] - r[0] + 1;
          if (T > Tmax) return;
          cands.push({ v0: r[0] - nA - 0.5, v1: r[1] - nA + 1.5, T: T });
        });
        if (!cands.length) return;
        // is it ruled paper (regular spacing)?
        let periodic = false;
        if (cands.length >= 3) {
          const cen = cands.map(function (c) { return (c.v0 + c.v1) / 2; }).sort(function (x, y) { return x - y; });
          const gaps = [];
          for (let k = 1; k < cen.length; k++) gaps.push(cen[k] - cen[k - 1]);
          const m = U().median(gaps);
          let ok = 0;
          gaps.forEach(function (g) { const q = g / m; if (m > 8 * S && Math.abs(q - Math.round(q)) <= 0.2) ok++; });
          periodic = ok >= gaps.length - 1 && ok >= 2;
        }
        const vbuf = new Float32Array((Math.ceil(Wl / 3) + 2) * (Tmax + 8));
        cands.forEach(function (c) {
          // how dark and what colour is this line? (sampled on every third column)
          let nv = 0, dR = 0, dG = 0, dB = 0;
          const v0 = c.v0, v1 = c.v1;
          for (let a = ws; a < we; a += 3) {
            const bl = Math.max(0, Math.floor((v0 + a * sinT) / cosT) - 1), bh = Math.min(nB - 1, Math.ceil((v1 + a * sinT) / cosT) + 1);
            for (let b = bl; b <= bh; b++) {
              const v = b * cosT - a * sinT;
              if (v < v0 || v > v1) continue;
              const idx = a * sA + b * sB, r = rel[idx];
              if (r > lo && nv < vbuf.length) {
                vbuf[nv++] = r;
                const p = est[idx], o = idx * 4;
                dR += p * kc[0] - data[o]; dG += p * kc[1] - data[o + 1]; dB += p * kc[2] - data[o + 2];
              }
            }
          }
          if (nv < 20) return;
          const med = U().median(vbuf.subarray(0, nv));
          const mx = Math.max(dR, dG, dB), mn = Math.min(dR, dG, dB);
          const colourness = mx > 1 ? (mx - mn) / mx : 0;
          if (med > 0.5) return;                      // a dark pen stroke, not printed ruling
          if (!periodic && colourness < 0.3) return;  // a single grey line may be the doodle's own
          const band = { fam: fam, a0: ws, a1: we, theta: theta, v0: c.v0 - 1.2, v1: c.v1 + 1.2, med: med, colour: colourness, periodic: periodic, nA: nA, nB: nB };
          bands.push(band);
          const thr = med * 1.45 + 0.03, bv0 = band.v0, bv1 = band.v1;
          for (let a = ws; a < we; a++) {
            const bl = Math.max(0, Math.floor((bv0 + a * sinT) / cosT) - 1), bh = Math.min(nB - 1, Math.ceil((bv1 + a * sinT) / cosT) + 1);
            for (let b = bl; b <= bh; b++) {
              const v = b * cosT - a * sinT;
              if (v < bv0 || v > bv1) continue;
              const idx = a * sA + b * sB;
              if (rel[idx] <= thr) { rel[idx] = 0; lineMask[idx] = 1; }
            }
          }
        });
        PROF.apply = (PROF.apply || 0) + U().now() - Q1;
      });
    }
    family(0);
    family(1);
    if (DA.cleanup) DA.cleanup._internals.linesProf = PROF;
    return bands;
  }

  // Where a pen or pencil stroke crossed a wiped line, the stroke may have a gap: bridge it.
  function bridgeLines(alpha, lineMask, w, h, bands) {
    bands.forEach(function (bd) {
      const fam = bd.fam, nB = bd.nB;
      const sA = fam === 0 ? 1 : w, sB = fam === 0 ? w : 1;
      const cosT = Math.cos(bd.theta), sinT = Math.sin(bd.theta);
      for (let a = bd.a0 + 2; a < bd.a1 - 2; a++) {
        const bLo = Math.floor((bd.v0 + a * sinT) / cosT), bHi = Math.ceil((bd.v1 + a * sinT) / cosT);
        const up = bLo - 3, dn = bHi + 3;
        if (up < 0 || dn >= nB) continue;
        let aboveInk = false, belowInk = false;
        for (let d = -2; d <= 2; d++) {
          if (alpha[(a + d) * sA + up * sB] > 128) aboveInk = true;
          if (alpha[(a + d) * sA + dn * sB] > 128) belowInk = true;
        }
        if (!(aboveInk && belowInk)) continue;
        for (let b = Math.max(0, bLo); b <= Math.min(nB - 1, bHi); b++) {
          const idx = a * sA + b * sB;
          if (lineMask[idx] && alpha[idx] < 230) alpha[idx] = 230;
        }
      }
    });
  }

  // ================= small helpers =================

  function dilateBin(src, W, H, r) { // box dilation with prefix sums
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    const pre = new Int32Array(Math.max(W, H) + 1);
    for (let y = 0; y < H; y++) {
      pre[0] = 0;
      for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + (src[y * W + x] ? 1 : 0);
      for (let x = 0; x < W; x++) tmp[y * W + x] = pre[Math.min(W, x + r + 1)] - pre[Math.max(0, x - r)] > 0 ? 1 : 0;
    }
    for (let x = 0; x < W; x++) {
      pre[0] = 0;
      for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + tmp[y * W + x];
      for (let y = 0; y < H; y++) out[y * W + x] = pre[Math.min(H, y + r + 1)] - pre[Math.max(0, y - r)] > 0 ? 1 : 0;
    }
    return out;
  }

  function toHex(r, g, b) {
    function h(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }
    return "#" + h(r) + h(g) + h(b);
  }
  // pen colour as seen in the photo, slightly darker and more saturated so it reads on screen
  function polishInk(r, g, b) {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
    let l = (mx + mn) / 2, s = 0, hh = 0;
    const d = mx - mn;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      const R = r / 255, G = g / 255, B = b / 255;
      if (mx === R) hh = ((G - B) / d + (G < B ? 6 : 0)); else if (mx === G) hh = (B - R) / d + 2; else hh = (R - G) / d + 4;
      hh /= 6;
    }
    s = Math.min(1, s * 1.3 + (s > 0.05 ? 0.05 : 0));
    l = Math.min(l * 0.85, 0.42);
    function hue2(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    if (s < 1e-6) return toHex(l * 255, l * 255, l * 255);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return toHex(hue2(p, q, hh + 1 / 3) * 255, hue2(p, q, hh) * 255, hue2(p, q, hh - 1 / 3) * 255);
  }

  // histogram helpers on Float values
  function histPercentile(hist, total, p, binW, min) {
    const target = p * total;
    let acc = 0;
    for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= target) return min + (i + 0.5) * binW; }
    return min + hist.length * binW;
  }

  // ================= the main job =================

  function analyse(img, opts) {
    const T = {}; let tm = U().now();
    function lap(name) { const t = U().now(); T[name] = Math.round(t - tm); tm = t; }
    const w = img.width, h = img.height, N = w * h, data = img.data;
    const S = Math.max(w, h) / 1600;
    const debug = !!(opts && opts.debug);
    const warnings = [];
    const dbg = debug ? { w: w, h: h, timings: T } : null;

    // 1. grey
    const gray = new Uint8Array(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) gray[i] = (data[j] * 77 + data[j + 1] * 151 + data[j + 2] * 28) >> 8;
    lap("grey");

    // 2. the paper: where it is, and what blank paper would look like
    const region = paperRegion(gray, w, h);
    lap("page");
    const pe = paperEstimate(gray, w, h);
    const est = pe.est;
    lap("paperEstimate");
    // paper colour ratios (paper is not pure grey)
    let sR = 0, sG = 0, sB = 0, sL = 0;
    for (let i = 0; i < N; i += 17) {
      if (gray[i] >= est[i] * 0.94) { const o = i * 4; sR += data[o]; sG += data[o + 1]; sB += data[o + 2]; sL += gray[i]; }
    }
    const kc = sL > 0 ? [sR / sL, sG / sL, sB / sL] : [1, 1, 1];
    let paperLevel = 0;
    paperLevel = U().median(pe.low);
    lap("paper colour");
    if (paperLevel < 55) return { ok: false, error: U().errorInfo("too-faint") };

    // 3. ink amount relative to the paper estimate (0 = paper, 1 = black)
    const rel = new Float32Array(N);
    const BIN = 0.002, HMIN = -0.3, HN = 750;
    const nhist = new Float64Array(HN);
    let nCount = 0;
    const sampIdx = new Int32Array(h * Math.ceil(w / 3) + 16); // pixels (on the page) used to measure the noise
    const inPageX = new Int32Array(w);
    if (region) for (let x = 0; x < w; x++) inPageX[x] = Math.min(region.lw - 1, (x / region.f) | 0);
    lap("alloc");
    const kc0 = kc[0], kc1 = kc[1], kc2 = kc[2];
    // first, every third pixel on the page: the paper's usual level (base) and its noise (sigma)
    let cnt = 0; // (a plain local: much faster in a hot loop than a variable other functions also use)
    for (let y = 0; y < h; y++) {
      const ly = region ? Math.min(region.lh - 1, (y / region.f) | 0) * region.lw : 0;
      for (let x = 0; x < w; x += 3) {
        if (region && !region.page[ly + inPageX[x]]) continue;
        const i = y * w + x, p = est[i], o = i * 4;
        let d = p - gray[i];
        let dm = p * kc0 - data[o];
        const dg = p * kc1 - data[o + 1], db = p * kc2 - data[o + 2];
        if (dg > dm) dm = dg; if (db > dm) dm = db;
        dm *= 0.8;
        if (dm > d) d = dm;
        const r = d / (p > 60 ? p : 60);
        let bi = ((r - HMIN) * (1 / BIN)) | 0;
        bi = bi < 0 ? 0 : (bi >= HN ? HN - 1 : bi);
        nhist[bi]++; sampIdx[cnt++] = i;
      }
    }
    nCount = cnt;
    if (nCount < 100) return { ok: false, error: U().errorInfo("no-doodle") };
    const base = histPercentile(nhist, nCount, 0.5, BIN, HMIN);
    // noise = robust spread of the paper (median absolute deviation)
    const dev = new Float64Array(HN);
    for (let i = 0; i < HN; i++) { const v = HMIN + (i + 0.5) * BIN; dev[Math.min(HN - 1, Math.round(Math.abs(v - base) / BIN))] += nhist[i]; }
    const sigma = Math.max(0.004, histPercentile(dev, nCount, 0.5, BIN, 0) * 1.4826);
    lap("noise sample");
    // then every pixel
    for (let i = 0, o = 0; i < N; i++, o += 4) {
      const p = est[i];
      let d = p - gray[i];
      let dm = p * kc0 - data[o];
      const dg = p * kc1 - data[o + 1], db = p * kc2 - data[o + 2];
      if (dg > dm) dm = dg; if (db > dm) dm = db;
      dm *= 0.8;
      if (dm > d) d = dm;
      rel[i] = d / (p > 60 ? p : 60) - base;
    }
    lap("ink full");
    if (region) { // outside the paper (a table around it) there is no ink
      for (let y = 0; y < h; y++) {
        const ly = Math.min(region.lh - 1, (y / region.f) | 0) * region.lw;
        for (let x = 0; x < w; x++) if (!region.page[ly + inPageX[x]]) rel[y * w + x] = 0;
      }
    }
    const lo =Math.max(0.04, Math.min(0.22, 4.2 * sigma));
    lap("ink amount");

    const relPre = debug ? rel.slice() : null;

    // 4. ruled and grid lines
    const bbox = region ? region.bbox : { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    const lineMask = new Uint8Array(N);
    const bands = removeLines(rel, lineMask, w, h, lo, bbox, S, img, est, kc);
    lap("lines");
    if (bands.length) warnings.push({ code: "lines-removed", title: "Notebook lines removed.", detail: "I wiped " + bands.length + " ruled-line pieces off the page." });

    // 5. the matte: soft alpha from "just above noise" to "clearly ink"
    function makeAlpha(loV, relArr) {
      const HB = 300, BW = 0.005;
      const ih = new Float64Array(HB);
      let n = 0;
      for (let i = 0; i < N; i += 2) {
        const r = relArr[i];
        if (r > loV) { ih[Math.min(HB - 1, (r / BW) | 0)]++; n++; }
      }
      const p90 = n > 50 ? histPercentile(ih, n, 0.9, BW, 0) : loV + 0.1;
      const hiV = Math.max(loV + 0.05, Math.min(0.65, 0.8 * p90));
      const a = new Uint8Array(N);
      const k = 255 / (hiV - loV);
      for (let i = 0; i < N; i++) {
        const v = (relArr[i] - loV) * k;
        a[i] = v <= 0 ? 0 : (v >= 255 ? 255 : v);
      }
      return { alpha: a, hi: hiV, p90: p90, n: n };
    }
    let relUse = rel, loUse = lo, sigmaUse = sigma;
    let A = makeAlpha(lo, rel);
    let faintMode = false;
    // Light ink (pencil): smooth the ink amount a little (thin strokes survive, paper noise drops a lot),
    // take out anything broad and smooth (a leftover shadow: pencil strokes are thin, so a wide local average
    // removes patches of uneven light but leaves strokes), and measure the noise again.
    function denoised() {
      const r2 = U().boxBlur(rel, w, h, 1, 1);
      // the broad level, measured without the wiped line pixels (otherwise they leave stripes in a shadow)
      const keepRel = new Float32Array(N), keepOne = new Float32Array(N);
      for (let i = 0; i < N; i++) { if (!lineMask[i]) { keepRel[i] = rel[i]; keepOne[i] = 1; } }
      const rb = Math.max(8, Math.round(0.025 * Math.max(w, h)));
      const num = U().boxBlur(keepRel, w, h, rb, 2), den = U().boxBlur(keepOne, w, h, rb, 2);
      const broad = num;
      for (let i = 0; i < N; i++) broad[i] = num[i] / (den[i] > 0.05 ? den[i] : 0.05);
      for (let i = 0; i < N; i++) r2[i] = lineMask[i] ? 0 : r2[i] - broad[i];
      const nh2 = new Float64Array(HN);
      for (let k = 0; k < nCount; k++) { let bi = Math.floor((r2[sampIdx[k]] - HMIN) / BIN); bi = bi < 0 ? 0 : (bi >= HN ? HN - 1 : bi); nh2[bi]++; }
      const base2 = histPercentile(nh2, nCount, 0.5, BIN, HMIN);
      const dev2 = new Float64Array(HN);
      for (let i = 0; i < HN; i++) { const v = HMIN + (i + 0.5) * BIN; dev2[Math.min(HN - 1, Math.round(Math.abs(v - base2) / BIN))] += nh2[i]; }
      const s2 = Math.max(0.003, histPercentile(dev2, nCount, 0.5, BIN, 0) * 1.4826);
      for (let i = 0; i < N; i++) r2[i] -= base2;
      return { rel: r2, sigma: s2 };
    }
    let dn = null;
    if (A.p90 < 0.28) {
      dn = denoised();
      relUse = dn.rel; sigmaUse = dn.sigma;
      loUse = Math.max(0.03, Math.min(lo, 4.2 * sigmaUse));
      A = makeAlpha(loUse, relUse);
      faintMode = true;
    }
    bridgeLines(A.alpha, lineMask, w, h, bands);
    if (debug) {
      dbg.alphaPre = faintMode ? makeAlpha(loUse, U().boxBlur(relPre, w, h, 1, 1)).alpha : makeAlpha(lo, relPre).alpha;
      dbg.est = est; dbg.region = region; dbg.bands = bands; dbg.lineMask = lineMask; dbg.faintMode = faintMode;
    }
    lap("matte");

    // 6. blobs, despeckle, doodles
    // Blobs are found on a half-size copy of the matte (4x less work); the final matte stays full size.
    function detect(alphaFull, loV, hiV) {
      const D = Math.max(w, h) > 900 ? 2 : 1;
      if (D === 1) { const f = extractDoodles(alphaFull, w, h, S, loV, hiV, true); f.D = 1; f.sw = w; f.sh = h; return f; }
      const sw = (w + 1) >> 1, sh = (h + 1) >> 1, sm = U().halfU8(alphaFull, w, h);
      const f = extractDoodles(sm, sw, sh, S / D, loV, hiV, false);
      f.D = D; f.sw = sw; f.sh = sh;
      f.allGroups.forEach(function (g) { g.x0 *= D; g.y0 *= D; g.x1 = (g.x1 + 1) * D - 1; g.y1 = (g.y1 + 1) * D - 1; });
      return f;
    }
    let found = detect(A.alpha, loUse, A.hi);
    if (!found.groups.length) {
      // nothing at the normal threshold: is there something very faint, or truly nothing?
      if (!dn) dn = denoised();
      const lo2 = Math.max(0.02, 2.6 * dn.sigma);
      if (lo2 < loUse || !faintMode) {
        const A2 = makeAlpha(lo2, dn.rel);
        const f2 = detect(A2.alpha, lo2, A2.hi);
        const real = f2.groups.some(function (g) { return Math.max(g.x1 - g.x0, g.y1 - g.y0) >= 0.08 * Math.max(w, h) && g.ink >= 300 * S * S; });
        if (real) {
          const out = { ok: false, error: U().errorInfo("too-faint") };
          if (debug) out.debug = { retryGroups: f2.groups.map(function (g) { return { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, ink: g.ink, area: g.area, meanAlpha: g.meanAlpha }; }), alpha: A2.alpha, lo: lo2, hi: A2.hi, w: w, h: h };
          return out;
        }
      }
      return { ok: false, error: U().errorInfo("no-doodle") };
    }
    lap("blobs");
    if (faintMode) warnings.push({ code: "faint", title: "Your pencil is pretty light.", detail: "A darker pen shows up even better." });

    // 7. build every doodle's matte, colour and sticker silhouette
    const doodles = found.groups.map(function (g, gi) { return buildDoodle(g, gi, found, A.alpha, img, w, h); });
    lap("doodles");
    if (debug) {
      dbg.alpha = A.alpha; dbg.lo = loUse; dbg.hi = A.hi; dbg.p90 = A.p90; dbg.sigma = sigmaUse; dbg.base = base; dbg.paperLevel = paperLevel;
      dbg.groups = found.allGroups; dbg.dropped = found.dropped; dbg.kc = kc;
    }
    const result = { ok: true, photo: { w: w, h: h }, doodles: doodles, warnings: warnings };
    if (debug) result.debug = dbg;
    return result;
  }

  // ================= blobs -> doodles =================

  function extractDoodles(alpha, w, h, S, loV, hiV, blurIt) {
    const N = w * h;
    // Find blobs on a lightly blurred matte so grainy pencil strokes stay in one piece
    // (a half-size matte is already averaged, so it skips the extra blur).
    const hard = new Uint8Array(N);
    if (blurIt) {
      const aF = new Float32Array(N);
      for (let i = 0; i < N; i++) aF[i] = alpha[i];
      const aS = U().boxBlur(aF, w, h, 1, 1);
      for (let i = 0; i < N; i++) hard[i] = aS[i] >= 30 ? 1 : 0;
    } else {
      for (let i = 0; i < N; i++) hard[i] = alpha[i] >= 30 ? 1 : 0;
    }
    const lab = U().labelBlobs(hard, w, h);
    const comps = lab.comps, labels = lab.labels;
    const nc = comps.length;
    const inkSum = new Float64Array(nc + 1);
    for (let i = 0; i < N; i++) { const l = labels[i]; if (l) inkSum[l] += alpha[i]; }

    // How sharp is each blob's edge? Ink changes from paper to ink within a few pixels; a leftover shadow
    // fades over dozens. (edge steepness relative to the blob's own strength)
    const gSum = new Float64Array(nc + 1), gCnt = new Int32Array(nc + 1);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!hard[i] || (hard[i - 1] && hard[i + 1] && hard[i - w] && hard[i + w])) continue;
        const gx = Math.abs(alpha[i + 1] - alpha[i - 1]), gy = Math.abs(alpha[i + w] - alpha[i - w]);
        const l = labels[i];
        gSum[l] += (gx > gy ? gx : gy) / 510; gCnt[l]++;
      }
    }

    const minBlob = Math.max(6, Math.round(20 * S * S));
    const long = Math.max(w, h);
    const span = hiV - loV;
    const keep = new Uint8Array(nc + 1);
    const ok =new Uint8Array(nc + 1); // real-looking blob (not a ruled-line remnant or a soft shadow)
    comps.forEach(function (c) {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      const longDim = Math.max(bw, bh), shortDim = Math.min(bw, bh);
      if (longDim >= 0.3 * long && longDim / shortDim >= 8) return;      // leftover ruled line
      if (c.area >= 4 * minBlob && gCnt[c.id] > 0) {
        // in "ink amount" units (not the stretched matte): edge steepness / the blob's own mean strength
        const sharp = ((gSum[c.id] / gCnt[c.id]) * span) / (loV + (inkSum[c.id] / c.area / 255) * span);
        c.sharp = sharp;
        if (sharp < 0.05) return;                                         // soft shadow, not ink
        c.fill = c.area / (bw * bh); c.meanRel = loV + (inkSum[c.id] / c.area / 255) * span;
      }
      if (c.area >= 3) ok[c.id] = 1;
    });
    // tiny pieces: keep them when they sit next to a real stroke or in a crowd of pieces (grainy pencil),
    // drop them when they float alone (dust)
    const near = 8 * S + 2, K8 = 8, gw8 = Math.ceil(w / K8), gh8 = Math.ceil(h / K8);
    const cellCnt = new Int32Array(gw8 * gh8);
    const big = [];
    comps.forEach(function (c) {
      if (!ok[c.id]) return;
      const sx = c.start % w, sy = (c.start / w) | 0;
      cellCnt[(sy >> 3) * gw8 + (sx >> 3)]++;
      if (c.area >= 6 * minBlob) big.push(c);
    });
    comps.forEach(function (c) {
      if (!ok[c.id]) return;
      if (c.area >= minBlob) { keep[c.id] = 1; return; }
      const sx = c.start % w, sy = (c.start / w) | 0, cx = sx >> 3, cy = sy >> 3;
      let crowd = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && Y >= 0 && X < gw8 && Y < gh8) crowd += cellCnt[Y * gw8 + X];
      }
      if (crowd >= 4) { keep[c.id] = 1; return; }
      for (let i = 0; i < big.length; i++) {
        const b = big[i];
        if (c.x0 <= b.x1 + near && c.x1 >= b.x0 - near && c.y0 <= b.y1 + near && c.y1 >= b.y0 - near) { keep[c.id] = 1; return; }
      }
    });

    // group blobs that are close together (gap smaller than ~3.5% of the photo) using a coarse picture
    const K = 4, cw = Math.ceil(w / K), ch = Math.ceil(h / K);
    const coarse = new Uint8Array(cw * ch);
    for (let y = 0; y < h; y++) {
      const row = y * w, crow = (y >> 2) * cw;
      for (let x = 0; x < w; x++) { const l = labels[row + x]; if (l && keep[l]) coarse[crow + (x >> 2)] = 1; }
    }
    const gapC = Math.max(1, Math.ceil((0.035 * long) / (2 * K)));
    const dil = dilateBin(coarse, cw, ch, gapC);
    const clab = U().labelBlobs(dil, cw, ch);
    const byId = new Map();
    comps.forEach(function (c) {
      if (!keep[c.id]) return;
      const sx = c.start % w, sy = (c.start / w) | 0;
      const gid = clab.labels[(sy >> 2) * cw + (sx >> 2)];
      let g = byId.get(gid);
      if (!g) { g = { blobs: [], x0: w, y0: h, x1: 0, y1: 0, ink: 0, area: 0 }; byId.set(gid, g); }
      g.blobs.push(c.id);
      g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1);
      g.ink += inkSum[c.id] / 255; g.area += c.area;
      if (c.sharp !== undefined && c.area > (g.sharpArea || 0)) { g.sharpArea = c.area; g.sharp = c.sharp; g.fill = c.fill; g.meanRel = c.meanRel; }
    });
    const all = Array.from(byId.values()).sort(function (a, b) { return b.ink - a.ink; });

    // Dust floating near a doodle: a small, lonely blob that is not inside the doodle's body (the body = its
    // main strokes, grown a little, with enclosed gaps filled so eyes inside a face are safe) is dropped.
    const blobGroup = new Int32Array(nc + 1).fill(-1);
    all.forEach(function (g, gi) { g.blobs.forEach(function (id) { blobGroup[id] = gi; }); });
    const compById = new Array(nc + 1);
    comps.forEach(function (c) { compById[c.id] = c; });
    all.forEach(function (g, gi) {
      const mainIds = g.blobs.filter(function (id) { return compById[id].area >= 15 * minBlob; });
      const smallIds = g.blobs.filter(function (id) { return compById[id].area < 15 * minBlob; });
      if (!mainIds.length || !smallIds.length) return;
      const gdim = Math.max(g.x1 - g.x0 + 1, g.y1 - g.y0 + 1);
      const rD = Math.max(2, Math.ceil((0.025 * gdim) / K));
      const gx0 = (g.x0 >> 2) - rD - 1, gy0 = (g.y0 >> 2) - rD - 1;
      const gw = ((g.x1 >> 2) - gx0) + rD + 2, gh = ((g.y1 >> 2) - gy0) + rD + 2;
      const loc = new Uint8Array(gw * gh);
      const isMain = new Uint8Array(nc + 1);
      mainIds.forEach(function (id) { isMain[id] = 1; });
      for (let y = g.y0; y <= g.y1; y++) {
        for (let x = g.x0; x <= g.x1; x++) {
          const l = labels[y * w + x];
          if (l && isMain[l]) loc[((y >> 2) - gy0) * gw + (x >> 2) - gx0] = 1;
        }
      }
      const body = dilateBin(loc, gw, gh, rD);
      // fill enclosed gaps: flood the outside from the border, everything not reached is body
      const out = new Uint8Array(gw * gh), st = [];
      function push(i) { if (!body[i] && !out[i]) { out[i] = 1; st.push(i); } }
      for (let x = 0; x < gw; x++) { push(x); push((gh - 1) * gw + x); }
      for (let y = 0; y < gh; y++) { push(y * gw); push(y * gw + gw - 1); }
      while (st.length) {
        const p = st.pop(), py = (p / gw) | 0, px = p - py * gw;
        if (px > 0) push(p - 1); if (px < gw - 1) push(p + 1); if (py > 0) push(p - gw); if (py < gh - 1) push(p + gw);
      }
      let dropAny = false;
      smallIds.forEach(function (id) {
        const c = compById[id], sx = c.start % w, sy = (c.start / w) | 0;
        const cx = (sx >> 2) - gx0, cy = (sy >> 2) - gy0;
        if (out[cy * gw + cx]) { keep[id] = 0; blobGroup[id] = -1; dropAny = true; }
      });
      if (dropAny) {
        const rest = g.blobs.filter(function (id) { return keep[id]; });
        g.blobs = rest; g.x0 = w; g.y0 = h; g.x1 = 0; g.y1 = 0; g.ink = 0; g.area = 0;
        rest.forEach(function (id) {
          const c = compById[id];
          g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1);
          g.ink += inkSum[id] / 255; g.area += c.area;
        });
      }
    });
    all.sort(function (a, b) { return b.ink - a.ink; });
    // a doodle must be a real size (not dust), and not tiny next to the biggest one
    const bigDim = all.length ? Math.max(all[0].x1 - all[0].x0 + 1, all[0].y1 - all[0].y0 + 1) : 0;
    const groups = [], dropped = [];
    all.forEach(function (g) {
      const dim = Math.max(g.x1 - g.x0 + 1, g.y1 - g.y0 + 1);
      g.meanAlpha = g.ink / Math.max(1, g.area);
      const tinyNextToBig = g.ink < 0.03 * all[0].ink && dim < 0.15 * bigDim;
      if (dim < 0.04 * long || g.ink < 120 * S * S || tinyNextToBig || g.meanAlpha < 0.3) dropped.push(g); else groups.push(g);
    });
    const groupOfLabel = new Int32Array(nc + 1).fill(-1);
    groups.forEach(function (g, gi) { g.blobs.forEach(function (id) { groupOfLabel[id] = gi; }); });
    return { groups: groups, dropped: dropped, allGroups: all, labels: labels, groupOfLabel: groupOfLabel, nBlobs: nc, nKept: keep.reduce(function (a, b) { return a + b; }, 0) };
  }

  function buildDoodle(g, gi, found, alpha, img, w, h) {
    const labels = found.labels, gol = found.groupOfLabel, data = img.data, D = found.D, lsw = found.sw;
    const bw = g.x1 - g.x0 + 1, bh = g.y1 - g.y0 + 1, maxdim = Math.max(bw, bh);

    // outline size: scaled with the doodle's size on the story (DESIGN.md section 11: 16-22 px)
    function outlineFor(k) {
      const mw = bw * k, mh = bh * k;
      const F = Math.min(STORY_BOX_W / mw, STORY_BOX_H / mh);
      const Tpx = Math.max(16, Math.min(22, 0.026 * Math.max(mw * F, mh * F)));
      return { F: F, T: Tpx, r: Tpx / F };
    }
    const kEst = Math.min(1, MAX_MATTE / (maxdim * 1.3));
    const oEst = outlineFor(kEst);
    const margin = Math.ceil(oEst.r / kEst) + Math.ceil(0.03 * maxdim) + 8;
    const cx0 = g.x0 - margin, cy0 = g.y0 - margin, cw = bw + 2 * margin, ch = bh + 2 * margin;

    // this doodle's ink only, plus a 2 px fringe of soft edge pixels
    let BT = U().now(); const BP = DA.cleanup._internals.buildProf = DA.cleanup._internals.buildProf || {};
    function bl(n) { const t = U().now(); BP[n] = (BP[n] || 0) + t - BT; BT = t; }
    let own = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const py = cy0 + y;
      if (py < 0 || py >= h) continue;
      for (let x = 0; x < cw; x++) {
        const px = cx0 + x;
        if (px < 0 || px >= w) continue;
        const l = labels[((py / D) | 0) * lsw + ((px / D) | 0)];
        if (l && gol[l] === gi) own[y * cw + x] = 1;
      }
    }
    bl("own");
    for (let pass = 0; pass < 2; pass++) {
      const nxt = own.slice();
      for (let y = 1; y < ch - 1; y++) {
        const py = cy0 + y;
        if (py < 0 || py >= h) continue;
        for (let x = 1; x < cw - 1; x++) {
          const i = y * cw + x;
          if (own[i]) continue;
          const px = cx0 + x;
          if (px < 0 || px >= w) continue;
          const pi = py * w + px;
          if (alpha[pi] > 0 && labels[((py / D) | 0) * lsw + ((px / D) | 0)] === 0 && (own[i - 1] || own[i + 1] || own[i - cw] || own[i + cw])) nxt[i] = 1;
        }
      }
      own = nxt;
    }
    bl("fringe");
    let matte = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const py = cy0 + y;
      if (py < 0 || py >= h) continue;
      for (let x = 0; x < cw; x++) {
        const px = cx0 + x;
        if (px < 0 || px >= w) continue;
        if (own[y * cw + x]) matte[y * cw + x] = alpha[py * w + px];
      }
    }
    bl("matte");
    let mwid = cw, mhei = ch, k = 1;
    if (Math.max(cw, ch) > MAX_MATTE) {
      k = MAX_MATTE / Math.max(cw, ch);
      mwid = Math.max(1, Math.round(cw * k)); mhei = Math.max(1, Math.round(ch * k));
      matte = U().resizeU8(matte, cw, ch, mwid, mhei);
      k = mwid / cw;
    }

    bl("resize");
    // pen colour: median colour where the matte is strongest
    const strong = [];
    let mxA = 0;
    for (let i = 0; i < matte.length; i++) if (matte[i] > mxA) mxA = matte[i];
    const thrS = mxA >= 230 ? 230 : Math.round(mxA * 0.85);
    const stride = Math.max(1, Math.floor(matte.length / 20000));
    for (let i = 0; i < matte.length; i += stride) {
      if (matte[i] < thrS) continue;
      const mx = i % mwid, my = (i / mwid) | 0;
      const px = Math.floor(cx0 + (mx + 0.5) / k), py = Math.floor(cy0 + (my + 0.5) / k);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      strong.push(py * w + px);
    }
    let ink = "#2a2f45";
    if (strong.length) {
      const st = Math.max(1, Math.floor(strong.length / 3000));
      const R = [], G = [], B = [];
      for (let i = 0; i < strong.length; i += st) { const o = strong[i] * 4; R.push(data[o]); G.push(data[o + 1]); B.push(data[o + 2]); }
      ink = polishInk(U().median(R), U().median(G), U().median(B));
    }

    bl("pen");
    // sticker silhouette: grow the ink by the outline, fill small holes
    // (worked out at up to half the matte's size: the outline is a smooth shape and it gets traced anyway)
    const o = outlineFor(k);
    const kS = Math.max(mwid, mhei) > 520 ? 0.5 : 1;
    const swid = kS === 1 ? mwid : (mwid + 1) >> 1, shei = kS === 1 ? mhei : (mhei + 1) >> 1;
    const mS = kS === 1 ? matte : U().halfU8(matte, mwid, mhei);
    const r = o.r * (swid / mwid);                 // outline radius in silhouette pixels
    const feat = new Uint8Array(mS.length);
    for (let i = 0; i < mS.length; i++) feat[i] = mS[i] >= 77 ? 1 : 0;
    bl("feat");
    const dist = U().distanceToMask(feat, swid, shei);
    bl("edt");
    const sil = new Uint8Array(mS.length);
    const bg = new Uint8Array(mS.length);
    for (let i = 0; i < mS.length; i++) {
      const c = r + 0.5 - dist[i];
      sil[i] = c <= 0 ? 0 : (c >= 1 ? 255 : Math.round(c * 255));
      bg[i] = c >= 1 ? 0 : 1;
    }
    const holeMax = Math.PI * (3 * r) * (3 * r);
    bl("silmask");
    const hl = U().labelBlobs(bg, swid, shei);
    bl("holes");
    const fillId = new Uint8Array(hl.comps.length + 1), closedId = new Uint8Array(hl.comps.length + 1);
    hl.comps.forEach(function (c) {
      const touches = c.x0 === 0 || c.y0 === 0 || c.x1 === swid - 1 || c.y1 === shei - 1;
      if (!touches) { closedId[c.id] = 1; if (c.area <= holeMax) fillId[c.id] = 1; }
    });
    let filled = 0;
    // "solid" variant: every enclosed gap filled (a classic die-cut sticker); the main session picks which to use
    const solid = sil.slice();
    for (let i = 0; i < sil.length; i++) {
      const l = hl.labels[i];
      if (!l) continue;
      if (fillId[l]) { sil[i] = 255; filled++; }
      if (closedId[l]) solid[i] = 255;
    }

    bl("rest");
    DA.cleanup._internals.buildProf = BP;
    return {
      id: "d" + gi,
      box: { x: g.x0, y: g.y0, w: bw, h: bh },
      inkColor: ink,
      // private: the engine's own fields (the site must not read or change these)
      _matte: { w: mwid, h: mhei, alpha: matte },
      // _sil is stored at k = swid / mwid times the matte's size (1 or about 0.5); r is in its own pixels
      _sil: { w: swid, h: shei, k: swid / mwid, alpha: sil, r: r, filledHoleArea: filled, solid: solid },
      _crop: { x: cx0, y: cy0, w: cw, h: ch, k: k },
      _story: { fit: o.F, outline: o.T },
      _inkArea: g.ink
    };
  }

  // ================= public =================

  async function findDoodles(imageData, opts) {
    await new Promise(function (res) { setTimeout(res, 0); }); // let the page paint a "peeling..." message first
    const t0 = U().now();
    let result;
    try {
      result = analyse(imageData, opts);
    } catch (e) {
      if (e && e.code) return { ok: false, error: { code: e.code, title: e.title, detail: e.detail } };
      throw e;
    }
    if (result.debug && result.debug.timings) result.debug.timings.total = Math.round(U().now() - t0);
    return result;
  }

  function doodleAt(result, x, y) {
    if (!result || !result.ok) return -1;
    const tol = 0.02 * Math.max(result.photo.w, result.photo.h);
    let best = -1, bestArea = Infinity;
    result.doodles.forEach(function (d, i) {
      const b = d.box;
      if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) {
        // prefer a doodle that is really under the finger, then the smallest box
        const inside = x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
        const area = (inside ? 0 : 1e12) + b.w * b.h;
        if (area < bestArea) { bestArea = area; best = i; }
      }
    });
    return best;
  }

  DA.cleanup = { findDoodles: findDoodles, doodleAt: doodleAt, _internals: { paperEstimate: paperEstimate, paperRegion: paperRegion } };
})();
