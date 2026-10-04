// Video and sticker out.
//
//   DA.export.support()                       -> Promise<{ video, method: "webcodecs" | "mediarecorder" | null, mime }>
//   DA.export.makeVideo(scene, { onProgress, signal }) -> Promise<File>   6 s, 1080 x 1920, 30 fps, with the mark
//   DA.export.makeSticker(scene)              -> Promise<File>            PNG, doodle + white outline, transparent
//
// The video is drawn frame by frame with scene.drawFrame (the same function as the preview) on a 1080 x 1920 canvas.
// Preferred path: WebCodecs (H.264) + the vendored mp4-muxer, which is faster than real time and gives a true MP4 that
// Instagram accepts. The muxer file is loaded here, only when a video is made. Fallback: canvas.captureStream + MediaRecorder
// (plays in real time, 6 s). Both take a snapshot of the scene when they start.
(function () {
  const DA = (globalThis.DA = globalThis.DA || {});
  const U = function () { return DA.util; };

  const W = 1080, H = 1920, FPS = 30, SECONDS = 6, FRAMES = 180, BITRATE = 4000000, KEY_EVERY = 30;
  // H.264 High / Main / Constrained Baseline, levels 4.0 and 4.2 (1080 x 1920 at 30 fps needs level 4.0 or higher)
  const CODECS = ["avc1.640028", "avc1.64002a", "avc1.4d0028", "avc1.4d002a", "avc1.420028", "avc1.42002a"];
  const MIMES = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  // where this file lives, so the muxer can be found next to it (worked out at load time, only if there is a document)
  let BASE = "src/engine/";
  try {
    if (typeof document !== "undefined" && document.currentScript && document.currentScript.src) {
      BASE = document.currentScript.src.replace(/[^\/]*$/, "");
    } else if (typeof document !== "undefined" && document.scripts) {
      for (let i = 0; i < document.scripts.length; i++) {
        const s = document.scripts[i].src || "";
        if (/\/export\.js(\?|$)/.test(s)) { BASE = s.replace(/[^\/]*$/, ""); break; }
      }
    }
  } catch (e) { /* keep the default */ }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function cancelled() { return U().error("cancelled", { title: "Cancelled.", detail: "Making the video was stopped." }); }
  function failed(e, what) {
    if (typeof console !== "undefined" && e) console.error(e);
    if (what === "sticker") return U().error("video-failed", { title: "Making the doodle file didn’t work.", detail: "Please try again." });
    return U().error("video-failed");
  }
  function throwIfAborted(signal) { if (signal && signal.aborted) throw cancelled(); }
  const sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  let chan = null;
  function yieldNow() { // a quick turn of the event loop (no 4 ms timer clamp) so the page stays alive while encoding
    if (typeof MessageChannel === "undefined") return sleep(0);
    return new Promise(function (res) {
      if (!chan) chan = new MessageChannel();
      chan.port1.onmessage = function () { res(); };
      chan.port2.postMessage(0);
    });
  }

  // ---------- what this browser can do ----------
  let probe = null;
  function getProbe() {
    if (probe) return probe;
    probe = (async function () {
      let wc = null, rec = null;
      try {
        if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined" && VideoEncoder.isConfigSupported) {
          for (let i = 0; i < CODECS.length && !wc; i++) {
            try {
              const r = await VideoEncoder.isConfigSupported({ codec: CODECS[i], width: W, height: H, bitrate: BITRATE, framerate: FPS, avc: { format: "avc" } });
              if (r && r.supported) wc = CODECS[i];
            } catch (e) { /* try the next */ }
          }
        }
      } catch (e) { wc = null; }
      try {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && typeof HTMLCanvasElement !== "undefined" && HTMLCanvasElement.prototype.captureStream) {
          for (let i = 0; i < MIMES.length && !rec; i++) if (MediaRecorder.isTypeSupported(MIMES[i])) rec = MIMES[i];
        }
      } catch (e) { rec = null; }
      return { wc: wc, rec: rec };
    })();
    return probe;
  }
  async function support() {
    const p = await getProbe();
    if (p.wc) return { video: true, method: "webcodecs", mime: "video/mp4" };
    if (p.rec) return { video: true, method: "mediarecorder", mime: /^video\/mp4/.test(p.rec) ? "video/mp4" : "video/webm" };
    return { video: false, method: null, mime: null };
  }

  // ---------- the muxer (loaded only now) ----------
  let muxerPromise = null;
  function loadMuxer() {
    if (globalThis.Mp4Muxer && globalThis.Mp4Muxer.Muxer) return Promise.resolve();
    if (muxerPromise) return muxerPromise;
    muxerPromise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = BASE + "vendor/mp4-muxer.js";
      s.onload = function () { (globalThis.Mp4Muxer && globalThis.Mp4Muxer.Muxer) ? resolve() : (muxerPromise = null, reject(new Error("muxer missing"))); };
      s.onerror = function () { muxerPromise = null; reject(new Error("could not load the muxer")); };
      document.head.appendChild(s);
    });
    return muxerPromise;
  }

  function snapshotOf(scene) {
    if (scene && typeof scene._snapshot === "function") return scene._snapshot();
    return scene;
  }

  // ---------- WebCodecs + MP4 ----------
  async function viaWebCodecs(snap, codec, onProgress, signal) {
    await loadMuxer();
    throwIfAborted(signal);
    const M = globalThis.Mp4Muxer;
    const target = new M.ArrayBufferTarget();
    const muxer = new M.Muxer({
      target: target,
      video: { codec: "avc", width: W, height: H, frameRate: FPS },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset"
    });
    let encError = null;
    const encoder = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { encError = e; }
    });
    encoder.configure({ codec: codec, width: W, height: H, bitrate: BITRATE, framerate: FPS, latencyMode: "quality", avc: { format: "avc" } });
    const canvas = U().createCanvas(W, H);
    const ctx = canvas.getContext("2d", { alpha: false });
    try {
      for (let i = 0; i < FRAMES; i++) {
        throwIfAborted(signal);
        if (encError) throw encError;
        snap.drawFrame(ctx, i / FPS, 1);
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        encoder.encode(frame, { keyFrame: i % KEY_EVERY === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 6) {
          await sleep(2);
          throwIfAborted(signal);
          if (encError) throw encError;
        }
        onProgress(Math.min(0.97, (i + 1) / FRAMES * 0.97));
        await yieldNow();
      }
      await encoder.flush();
      throwIfAborted(signal);
      if (encError) throw encError;
      muxer.finalize();
    } finally {
      try { if (encoder.state !== "closed") encoder.close(); } catch (e) { /* already closed */ }
    }
    const buf = target.buffer;
    if (!buf || buf.byteLength < 2000) throw new Error("empty video");
    onProgress(1);
    return new File([buf], "doodle-alive-" + stamp() + ".mp4", { type: "video/mp4" });
  }

  // ---------- MediaRecorder (real time) ----------
  function viaRecorder(snap, mime, onProgress, signal) {
    return new Promise(function (resolve, reject) {
      const canvas = U().createCanvas(W, H);
      const ctx = canvas.getContext("2d", { alpha: false });
      snap.drawFrame(ctx, 0, 1);
      let rec, stream;
      try {
        stream = canvas.captureStream(FPS);
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE });
      } catch (e) { reject(e); return; }
      const chunks = [];
      let done = false, started = 0, timer = 0, raf = 0;
      function finish(err) {
        if (done) return; done = true;
        if (raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(raf);
        clearTimeout(timer);
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignore */ }
        if (signal) signal.removeEventListener("abort", onAbort);
        if (err) reject(err);
      }
      function onAbort() { finish(cancelled()); try { if (rec.state !== "inactive") rec.stop(); } catch (e) { /* ignore */ } }
      if (signal) signal.addEventListener("abort", onAbort);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function (e) { finish(e && e.error ? e.error : new Error("recorder error")); };
      rec.onstop = function () {
        if (done) return;
        const base = /^video\/mp4/.test(mime) ? "video/mp4" : "video/webm";
        const blob = new Blob(chunks, { type: base });
        finish(null);
        if (blob.size < 2000) { reject(new Error("empty recording")); return; }
        onProgress(1);
        resolve(new File([blob], "doodle-alive-" + stamp() + (base === "video/mp4" ? ".mp4" : ".webm"), { type: base }));
      };
      function frame() {
        if (done) return;
        const el = (performance.now() - started) / 1000;
        if (el >= SECONDS) { try { rec.stop(); } catch (e) { finish(e); } return; }
        snap.drawFrame(ctx, el, 1);
        onProgress(Math.min(0.97, el / SECONDS));
        raf = (typeof document !== "undefined" && document.hidden) ? 0 : requestAnimationFrame(frame);
        if (!raf) timer = setTimeout(frame, 1000 / FPS);
      }
      rec.start(250);
      started = performance.now();
      frame();
    });
  }

  // ---------- public ----------
  async function makeVideo(scene, opts) {
    opts = opts || {};
    const signal = opts.signal || null;
    const onProgress = typeof opts.onProgress === "function" ? function (f) { try { opts.onProgress(f); } catch (e) { /* the site's problem */ } } : function () {};
    throwIfAborted(signal);
    const snap = snapshotOf(scene);
    if (!snap || typeof snap.drawFrame !== "function") throw failed(new Error("no scene"));
    let p = await getProbe();
    if (opts._method === "recorder") p = { wc: null, rec: p.rec };   // for tests only: force the MediaRecorder path
    if (!p.wc && !p.rec) throw U().error("video-unsupported");
    throwIfAborted(signal);
    onProgress(0);
    let lastErr = null;
    if (p.wc) {
      try { return await viaWebCodecs(snap, p.wc, onProgress, signal); }
      catch (e) {
        if (e && e.code === "cancelled") throw e;
        if (signal && signal.aborted) throw cancelled();
        lastErr = e;
        if (!p.rec) throw failed(e);
        onProgress(0);
      }
    }
    try { return await viaRecorder(snap, p.rec, onProgress, signal); }
    catch (e) {
      if (e && e.code === "cancelled") throw e;
      throw failed(e || lastErr);
    }
  }

  async function makeSticker(scene) {
    const snap = snapshotOf(scene);
    try {
      if (!snap || !snap.prep) throw new Error("no doodle");
      const prep = snap.prep, B = prep.silBox;
      const bw = B.x1 - B.x0, bh = B.y1 - B.y0, pad = 0.03 * Math.max(bw, bh) + 4;
      const tw = bw + 2 * pad, th = bh + 2 * pad, s = 1000 / Math.max(tw, th);
      const canvas = U().createCanvas(Math.max(1, Math.round(tw * s)), Math.max(1, Math.round(th * s)));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.scale(canvas.width / tw, canvas.height / th);
      ctx.translate(-(B.x0 - pad), -(B.y0 - pad));
      const A = DA.animate;
      function fill(kind, color) {
        ctx.fillStyle = color;
        const p = A.path(prep, kind, -1);
        if (p) ctx.fill(p, "evenodd");
        else {
          const set = prep[kind];
          ctx.beginPath();
          let a = 0;
          for (let l = 0; l < set.ends.length; l++) {
            const e = set.ends[l];
            ctx.moveTo(set.base[a * 2], set.base[a * 2 + 1]);
            for (let i = a + 1; i < e; i++) ctx.lineTo(set.base[i * 2], set.base[i * 2 + 1]);
            ctx.closePath(); a = e;
          }
          ctx.fill("evenodd");
        }
      }
      fill("sil", "#ffffff");
      fill("ink", snap.resolved.ink);
      const blob = await new Promise(function (res) { canvas.toBlob(res, "image/png"); });
      if (!blob) throw new Error("toBlob gave nothing");
      return new File([blob], "doodle-alive-doodle-" + stamp() + ".png", { type: "image/png" });
    } catch (e) {
      throw failed(e, "sticker");
    }
  }

  DA.export = { support: support, makeVideo: makeVideo, makeSticker: makeSticker, _stamp: stamp, _probe: getProbe };
})();
