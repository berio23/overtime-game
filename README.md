# OVERTIME — incident 4471

A ~15-minute first-person horror game in Three.js, presented as recovered body-worn-camera
footage from one very bad night of overtime.

## Run it

Double-click **run.bat** (starts a local server and opens the browser), or:

```
node server.mjs 8741
```

then open http://localhost:8741. Any static file server works — it just can't be opened
from `file://` (ES modules + audio need http). Three.js is pulled from a CDN, so the first
load needs internet. **Play with headphones.**

## Controls

| Input | Action |
|---|---|
| Mouse | look |
| Right mouse (hold) | lean in / digital zoom |
| W A S D (+Shift) | move |
| E | interact |
| F | phone flashlight (once you have it) |
| Space | stand up (when prompted) |
| Any keys | type, when the terminal wants you to |

## Tech

- **Three.js** (r160) — procedural office, no external models or textures; everything is
  generated geometry and canvas textures.
- **Bodycam pipeline** — custom post shader: barrel distortion, chromatic aberration,
  shadow-weighted sensor grain, digital tear, posterized glitch; DOM HUD with live (and
  occasionally untrustworthy) timestamp; chest-mount look-lag and head bob.
- **All audio generated with ElevenLabs** — 48 assets: 20 voice lines (two characters),
  24 sound effects, 4 music tracks, in `audio/`.
- **Narrative design** — three-act structure ("DEBT / AUDIT / SETTLEMENT") authored as a
  story-skills project in `../story/overtime/` (plot arc, characters, timeline,
  foreshadowing ledger).
- **3D spatial audio** — `THREE.PositionalAudio` (HRTF) everywhere: ceiling PA speakers,
  desk phone, printer, server racks. The boss's recorded voice is degraded *live* through
  a WebAudio waveshaper/bandpass/pitch-warble chain whose drive scales with the narrative,
  and can be attached to a holder that physically orbits the player.
- **Director** — the whole night is one async script over a game-clock scheduler
  (`wait`/`waitFor` with timeout failsafes), so it always moves forward even if you hide
  under a desk.

## Files

```
index.html        shell, HUD, boot/end screens
server.mjs        zero-dependency static server
src/main.js       wiring + loop
src/world.js      the office floor, light zones, elevators, papers
src/director.js   the script of the night
src/bodycam.js    post-processing + HUD camera
src/audiomgr.js   loading, spatialization, distortion chains
src/terminal.js   the claude code session (canvas texture)
src/player.js     controller, collision
src/hud.js        subtitles, objectives, overlays
src/interact.js   raycast interactions
audio/*.mp3       33 generated assets
```
