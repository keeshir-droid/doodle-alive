// Small shared helpers for the doodle engine (no browser features at load time, so it runs in Node too).
//
//   DA.util.error(code, overrides?)      -> Error carrying {code, title, detail} (throw it)
//   DA.util.errorInfo(code, overrides?)  -> plain {code, title, detail} (put it in a result)
//   DA.util.median / percentile / clamp / smoothstep / mulberry32 / now
//   DA.util.makeImageData(w, h, data)    -> an ImageData (or a look-alike object in Node)
//   DA.util.createCanvas(w, h)           -> a canvas (browser only, called at run time)
//   DA.util.boxBlur / distanceToMask / labelBlobs   -> image helpers used by cleanup and animate
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});

  // ---------- friendly messages (tone: DESIGN.md section 7) ----------
  const MESSAGES = {
    "not-image": { title: "That doesn’t look like a photo.", detail: "Choose a picture (a JPG or PNG), or take a new photo." },
    "heic": { title: "Your phone saved this in a format I can’t read.", detail: "Take a screenshot of it and use that." },
    "unreadable": { title: "I couldn’t open that picture.", detail: "Try a different photo, or take a screenshot of it and use that." },
    "no-doodle": { title: "Hmm, I couldn’t find a doodle.", detail: "Try a darker pen, more light, or get a bit closer." },
    "too-faint": { title: "That doodle is too faint for me to see.", detail: "Go over it with a darker pen, or take the photo in brighter light." },
    "video-unsupported": { title: "This browser can’t make videos.", detail: "You can still save your doodle on its own!" },
    "video-failed": { title: "Making the video didn’t work.", detail: "Please try again. You can still save your doodle on its own." }
  };

  function errorInfo(code, overrides) {
    const m = MESSAGES[code] || { title: "Something went wrong.", detail: "Please try again." };
    const o = overrides || {};
    return { code: code, title: o.title || m.title, detail: o.detail || m.detail };
  }
  function makeError(code, overrides) {
    const info = errorInfo(code, overrides);
    const e = new Error(info.title);
    e.code = info.code; e.title = info.title; e.detail = info.detail;
    return e;
  }

  // ---------- numbers ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function median(arr) {
    if (!arr.length) return 0;
    const a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function percentile(arr, p) {
    if (!arr.length) return 0;
    const a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  // ---------- images and canvases (only touched when called) ----------
  function makeImageData(w, h, data) {
    if (typeof ImageData !== "undefined") {
      try { return new ImageData(data, w, h); } catch (e) { /* fall through */ }
    }
    return { width: w, height: h, data: data, colorSpace: "srgb" };
  }
  function createCanvas(w, h) {
    if (typeof document !== "undefined" && document.createElement) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    throw new Error("No canvas available here");
  }

  // ---------- image helpers ----------

  // Separable box blur of a Float32 field, edges averaged over the pixels that exist. Returns a new array.
  // (edge pixels are repeated outwards; works row by row so it stays fast on big photos)
  function boxBlur(src, w, h, r, passes) {
    passes = passes || 1;
    const inv = 1 / (2 * r + 1);
    let cur = src;
    const tmp = new Float32Array(w * h);
    const colSum = new Float64Array(w);
    for (let p = 0; p < passes; p++) {
      const out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) { // horizontal
        const row = y * w, last = row + w - 1;
        let sum = cur[row] * (r + 1);
        for (let i = 1; i <= r; i++) sum += cur[row + (i < w ? i : w - 1)];
        for (let x = 0; x < w; x++) {
          tmp[row + x] = sum * inv;
          const add = x + r + 1, rem = x - r;
          sum += cur[add < w ? row + add : last] - cur[rem > 0 ? row + rem : row];
        }
      }
      // vertical: a running sum of whole rows
      for (let x = 0; x < w; x++) colSum[x] = tmp[x] * (r + 1);
      for (let i = 1; i <= r; i++) { const o = (i < h ? i : h - 1) * w; for (let x = 0; x < w; x++) colSum[x] += tmp[o + x]; }
      for (let y = 0; y < h; y++) {
        const o = y * w, addRow = (y + r + 1 < h ? y + r + 1 : h - 1) * w, remRow = (y - r > 0 ? y - r : 0) * w;
        for (let x = 0; x < w; x++) {
          const s = colSum[x];
          out[o + x] = s * inv;
          colSum[x] = s + tmp[addRow + x] - tmp[remRow + x];
        }
      }
      cur = out;
    }
    return cur;
  }

  // Distance (in pixels) from every pixel to the nearest non-zero pixel of mask. Two-pass "chamfer" 5-7
  // approximation of the true distance (within about 4%), which is plenty for a rounded sticker outline and is
  // many times faster than the exact version.
  function distanceToMask(mask, w, h) {
    const INF = 1000000000;
    const d = new Int32Array(w * h);
    for (let i = 0, n = w * h; i < n; i++) d[i] = mask[i] ? 0 : INF;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let v = d[i];
        if (v === 0) continue;
        let t;
        if (x > 0) { t = d[i - 1] + 5; if (t < v) v = t; }
        if (y > 0) {
          t = d[i - w] + 5; if (t < v) v = t;
          if (x > 0) { t = d[i - w - 1] + 7; if (t < v) v = t; }
          if (x < w - 1) { t = d[i - w + 1] + 7; if (t < v) v = t; }
        }
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      const row = y * w;
      for (let x = w - 1; x >= 0; x--) {
        const i = row + x;
        let v = d[i];
        if (v === 0) continue;
        let t;
        if (x < w - 1) { t = d[i + 1] + 5; if (t < v) v = t; }
        if (y < h - 1) {
          t = d[i + w] + 5; if (t < v) v = t;
          if (x < w - 1) { t = d[i + w + 1] + 7; if (t < v) v = t; }
          if (x > 0) { t = d[i + w - 1] + 7; if (t < v) v = t; }
        }
        d[i] = v;
      }
    }
    const out = new Float32Array(w * h);
    for (let i = 0, n = w * h; i < n; i++) out[i] = d[i] >= INF ? 1e6 : d[i] / 5;
    return out;
  }

  // Exact 2x downscale (average of 2x2 blocks) of a Uint8 field; output is ceil(w/2) x ceil(h/2).
  function halfU8(src, w, h) {
    const dw = (w + 1) >> 1, dh = (h + 1) >> 1, out = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const y0 = y * 2, y1 = y0 + 1 < h ? y0 + 1 : y0;
      const r0 = y0 * w, r1 = y1 * w;
      for (let x = 0; x < dw; x++) {
        const x0 = x * 2, x1 = x0 + 1 < w ? x0 + 1 : x0;
        out[y * dw + x] = (src[r0 + x0] + src[r0 + x1] + src[r1 + x0] + src[r1 + x1]) >> 2;
      }
    }
    return out;
  }

  // Connected blobs of a binary mask (8-neighbours). comps[i] describes label i + 1.
  function labelBlobs(mask, w, h) {
    const labels = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    let id = 0;
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || labels[start]) continue;
      id++;
      let sp = 0;
      stack[sp++] = start;
      labels[start] = id;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
      while (sp > 0) {
        const p = stack[--sp];
        const py = (p / w) | 0, px = p - py * w;
        area++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        const ya = py > 0 ? py - 1 : 0, yb = py < h - 1 ? py + 1 : h - 1;
        const xa = px > 0 ? px - 1 : 0, xb = px < w - 1 ? px + 1 : w - 1;
        for (let ny = ya; ny <= yb; ny++) {
          for (let nx = xa; nx <= xb; nx++) {
            const q = ny * w + nx;
            if (mask[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; }
          }
        }
      }
      comps.push({ id: id, x0: x0, y0: y0, x1: x1, y1: y1, area: area, start: start });
    }
    return { labels: labels, comps: comps };
  }

  // Area-average downscale of a Uint8 field (used to keep the doodle matte at a sensible size).
  function resizeU8(src, sw, sh, dw, dh) {
    const out = new Uint8Array(dw * dh);
    const kx = sw / dw, ky = sh / dh;
    for (let y = 0; y < dh; y++) {
      const ya = Math.floor(y * ky), yb = Math.max(ya + 1, Math.min(sh, Math.ceil((y + 1) * ky)));
      for (let x = 0; x < dw; x++) {
        const xa = Math.floor(x * kx), xb = Math.max(xa + 1, Math.min(sw, Math.ceil((x + 1) * kx)));
        let s = 0;
        for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) s += src[yy * sw + xx];
        out[y * dw + x] = Math.round(s / ((yb - ya) * (xb - xa)));
      }
    }
    return out;
  }

  DA.util = {
    error: makeError, errorInfo: errorInfo, MESSAGES: MESSAGES,
    clamp: clamp, smoothstep: smoothstep, median: median, percentile: percentile, mulberry32: mulberry32, now: now,
    makeImageData: makeImageData, createCanvas: createCanvas,
    boxBlur: boxBlur, distanceToMask: distanceToMask, labelBlobs: labelBlobs, resizeU8: resizeU8, halfU8: halfU8
  };
})();
