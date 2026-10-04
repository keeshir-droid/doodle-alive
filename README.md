# Doodle Alive

**Snap a doodle. Watch it come alive.** Photograph a doodle from your notebook margin, a napkin or a sticky note. Doodle Alive lifts the ink off the paper, puts it on a cute background, makes it wobble like a hand-drawn cartoon, and turns it into a 6-second story video you can post in a couple of taps. Free, no account, no AI, and your photo never leaves your phone.

Built for people who doodle in the margins and like to share the little things they make.

**Live:** not deployed yet. Intended address: `https://doodle-alive.vercel.app`

*Demo GIF / screenshots: to be added after the first real-phone test.*

## The story

Day 3 of *21 Days of Creative Tech*. Everyone doodles while they're on a call or procrastinating, and almost nobody posts those doodles: a notebook photo looks flat, grey and crooked on a story. This is a painkiller for doodles people already make, not a reason to make one. No prompts, no challenges, no feed.

## How it works

1. **Snap.** The phone camera (or a photo from the gallery) brings the doodle in.
2. **Lift.** The page works out what blank paper would look like at every spot, so shadows and uneven light disappear, then keeps only what's darker: the ink. Ruled and grid lines are found and wiped, while pen that crosses a line is kept. Dust is dropped, and the biggest doodle is chosen.
3. **Come alive.** The outline is traced and redrawn with a tiny hand-drawn "boil" wobble and one of six motions (Wiggle, Bounce, Float, Sway, Jelly, Shiver). It draws itself in the first second, then loops.
4. **Backgrounds.** Ten backgrounds drawn in code (notebook, gingham, wavy checks, graph paper, dot journal, polaroid, strawberries, collage, watercolour, night neon), with a white die-cut outline around the doodle on the busy ones. Optional text, in one of three fonts.
5. **Share.** The video makes itself in the background (a real MP4, 1080×1920, about 3 MB). **Share to your story** opens the phone's share sheet. A doodle-only PNG with a transparent background can be saved too.

Everything happens in the browser on the phone. There is no server, no API key and no AI model. It is plain HTML, CSS and JavaScript with no build step. The only library is a small MIT-licensed MP4 muxer (`mp4-muxer`), loaded only when a video is made.

## What broke (honest notes)

- **Day 2's ink mask hollowed out thick lines.** It compares each pixel with its neighbours, which is right for thin handwriting but empties out marker strokes and filled areas. Doodle Alive estimates the blank paper brightness instead.
- **Shadows became doodles.** Early cleanup mistook soft hand shadows for ink; they're now rejected by edge sharpness.
- **Faint pencil falls apart into dots.** It's detected as a special case, with a lower threshold, and the outline still looks grainy.
- **Headless-browser testing can't be narrower than about 500 px,** so phone-size screenshots were taken through a 390 px frame.
- **Not yet tested on real photos or real phones** when this was written (see below).

## Limits and next steps

- The doodle moves as one piece. No individual limbs.
- Faint pencil next to dark pen is ignored on purpose (ink strength is set per photo).
- The first second of the draw-itself intro is a soft wipe along the pen, not a stroke-by-stroke trace.
- Not today: several doodles at once, a doodle on your own photo, music, more fonts, square (feed) format, GIF export, custom backgrounds.

## Testing

- `node tests/smoke.js`: every function the site relies on exists.
- `node tests/page-check.js`: loads the site in headless Edge, makes a real video, fails on any console error.
- `node tests/engine/loop-test.js`, `node tests/engine/cleanup-test.js`, `node tests/engine/backgrounds-test.js`
- `tests/cleanup.html?photo=sample` shows every cleanup stage for one photo. Real photos go in `tests/real/` (gitignored).
- Run the site locally with `python -m http.server 8000`, then open `http://localhost:8000`.

**Still to confirm by hand on real devices:** camera capture, the share sheet and posting to Instagram, saving to Photos on iPhone, Add to Home Screen, phone speed. See `VERIFY.md`.

## Links

- Reel: to be added.
- More from the maker: [Handwriting → Font](https://handwriting-font-converter.vercel.app) (Day 2).

## Credits

Fonts: Caveat, Fredoka and Pacifico, SIL Open Font License (`fonts/OFL.txt`). Video muxer: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) by Vanilagy, MIT (`src/engine/vendor/LICENSE-mp4-muxer.txt`).
