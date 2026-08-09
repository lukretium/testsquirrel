# TestSquirrel

A clone of the [testweasel.ai](https://testweasel.ai/) landing page, rebranded as **TestSquirrel**:
teal primary colour instead of orange, and squirrel mascot artwork instead of the weasel.

```
index.html                          the landing page (single file, inline CSS/JS)
images/
  mr-testsquirrel-portrait.svg      hero portrait — generated, see build/gen-hero.js
  testsquirrel-logo.svg             header/footer logo mark
  favicon.svg                       simplified head-only mark for tiny sizes
  demo-poster.jpg                   poster frame for the demo video
videos/
  testsquirrel-demo.mp4             the product demo screencast
build/
  gen-hero.js                       regenerates the hero portrait SVG
  render-demo.js                    renders + encodes the demo video
  gen-audio.py                      synthesises the soundtrack and muxes it in
  demo/app.html                     fake TestSquirrel desktop app, seekable animation
  demo/pip.html                     mascot "webcam" overlay, seekable animation
  demo/stage.html                   composites app + webcam into one 1920x1080 frame
```

Open `index.html` directly in a browser — there is no build step for the site itself.

## What changed from the original

- **Primary colour** orange `#f26a1b` → teal `#0e9e86` (dark variant `#0a6f5f`), with every
  derived tint updated: eyebrows, accent words, buttons and their shadows, the dark manifesto
  panel, the full-bleed provocation band, the "how it works" cream section, and focus/hover states.
- **Mascot** weasel → red squirrel, on-model across hero, logo, favicon and video.
- **Copy** TestWeasel → TestSquirrel throughout; contact address `support@testsquirrel.ai`.
- **Outbound links** (imprint, privacy, social profiles, `download/latest.php`) point at
  placeholders rather than the real company's pages. Download CTAs jump to the final CTA section.

Layout, typography, section order, wording, the demo modal and the hidden
`?include-fake-contact-form=true` contact form all match the original.

## Regenerating the artwork

```sh
node build/gen-hero.js      # -> images/mr-testsquirrel-portrait.svg
```

The hero is generated rather than hand-drawn because the fur needs hundreds of tapering
slivers along every silhouette — a clean bezier outline reads as plastic. A seeded PRNG makes
the output byte-identical on every run.

## Regenerating the demo video

Requires `ffmpeg` and `playwright` (system Chrome is used, so no browser download is needed):

```sh
npm i playwright
node build/render-demo.js            # -> videos/testsquirrel-demo.mp4 + images/demo-poster.jpg
node build/render-demo.js --fps 60   # optional
```

The video mirrors the format of the original: a screen recording of the desktop app with the
mascot in a picture-in-picture webcam tile in the bottom-left corner. Rather than screen-record
in real time, `app.html` and `pip.html` each expose a `seek(t)` function that sets their entire
visual state as a pure function of time. `render-demo.js` steps `t` frame by frame and
screenshots, so the result is deterministic and never drops frames.

Consequently neither demo page may use CSS transitions/animations or timers — all motion must be
computed inside `seek(t)`, or it will desync from the frame stepping.

### Soundtrack

```sh
python3 build/gen-audio.py             # -> soundtrack, muxed into the mp4
python3 build/gen-audio.py --wav-only  # just render the wav
```

Requires `numpy`. The track is synthesised from oscillators and shaped noise — an ambient pad
over an Am–F–C–G progression, a sparse bell arpeggio, plus interaction sounds (keystrokes,
clicks, whooshes, step ticks, success chimes). Nothing is sampled from a third-party source, so
there is no licensing question.

The event times at the top of `gen-audio.py` mirror the constants in `demo/app.html`
(`CLICK_TIMES`, `STEP_CHECK`, the typing windows). **If you retime the animation, update them or
the sounds will drift out of sync** — they are duplicated, not derived.

Final loudness is set by `loudnorm=I=-18` at mux time; the Python side deliberately leaves
6 dB of headroom.
