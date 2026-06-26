# Arthur's Big Walk — Build Spec

A browser-based endless side-scrolling runner starring Arthur the dog. This document is the build brief for Claude Code. It is intentionally prescriptive about scope and numbers so the first build is playable and shippable, with later features layered in cleanly.

---

## 1. Goal & guiding principles

Build a polished, single-file HTML5 canvas game that runs entirely in the browser with **no backend**, deployable for free to GitHub Pages.

Principles, in priority order:
1. **Ship a fun MVP first.** Phase 1 must be fully playable on its own before any later phase is started.
2. **Single deployable artifact.** One `index.html` plus an optional `assets/` folder. No build step, no framework, no npm install required to run.
3. **Placeholder art is fine.** Use simple shapes/emoji as stand-ins so the game is playable before real Arthur art exists. Keep all art behind a thin abstraction so a real sprite can be swapped in by changing one module.
4. **Desktop-first.** Keyboard play is the primary experience; size HUD, text, and the game-feel tuning for a desktop browser. Touch/mobile must still work (controls in §5), but where layout or tuning decisions conflict, desktop wins.

---

## 2. Tech stack & constraints

- **Vanilla JavaScript + HTML5 `<canvas>`.** No React, no game framework, no bundler.
- Single `index.html` containing the canvas, CSS, and JS. JS may be inline in a `<script>` or in a sibling `game.js` — your call, but keep it to a tiny number of files.
- **`localStorage`** is permitted and expected (for the high score). Note: this works on GitHub Pages but NOT inside a Claude artifact, so do not test final persistence in an artifact preview.
- Target **60 FPS** using `requestAnimationFrame`. Use a fixed-timestep or delta-time update so physics are frame-rate independent.
- No external network calls at runtime. No analytics, no CDNs required for core gameplay (a web-font link is acceptable but optional).

---

## 3. Game world

- **Logical resolution:** 960 × 540 (16:9). Scale the canvas to fit the viewport while preserving aspect ratio (letterbox if needed). All gameplay coordinates are in logical space.
- **Camera:** fixed. The world scrolls right-to-left past a stationary Arthur. Arthur's x-position is fixed at ~180px; only his y changes (jump/duck).
- **Ground line** at y = 460. Arthur and ground obstacles rest on it.
- **Parallax background, 3 layers**, scrolling at different speeds for depth:
  - Far layer (sky/skyline): 0.2× scroll speed.
  - Mid layer (buildings/trees): 0.5× scroll speed.
  - Near layer (ground detail/bushes): 1.0× scroll speed.
- **Three neighborhood zones** that loop westward every ~500m of distance: `West Hollywood` → `Beverly Hills` → `Beach (Santa Monica)`. (Supersedes the original `sidewalk → park → boardwalk` biome plan; a fourth `Hollywood` zone was built then cut on 2026-06-16, with its downtown skyline + power poles moved into Beverly Hills.) Each zone swaps all three parallax tiles for its own scenery and landmark (rainbow crosswalk / Beverly Hills shield / pier ferris wheel); zones crossfade per-layer near the boundary. Mechanics are identical across zones; obstacles are universal for now, with zone-themed reskins (render-only, same hitboxes) planned. All built (`ZONES`/`ZONE_ORDER` in game.js).
- **Palette:** bright LA daytime — clear blue sky, warm sunlight, palm greens, sandy/sidewalk neutrals. Scenery is LA-themed (palm-lined sidewalks, hills on the horizon, Venice-style boardwalk). Keep it readable — obstacles must contrast clearly against the background.

---

## 4. Core loop & objectives

The world auto-scrolls and speeds up over time. The player keeps Arthur moving as far as possible.

- **Primary objective:** maximize distance (meters). `meters = floor(totalScrollPixels / 50)`.
- **Secondary objective:** collect treats. Treats come in tiers worth different score (see §7), and (Phase 2) every treat regardless of tier is **banked as one unit of distract ammo** — see §8.
- **Final score** = meters + total treat score. Persist the best score to `localStorage` under key `arthur_highscore`.
- **Run ends** when Arthur hits a hard obstacle (Phase 1) and additionally when the Calm meter empties (Phase 2).

---

## 5. Player actions (controls)

Two movement verbs in Phase 1, plus a third action (**distract**) introduced in Phase 2 alongside the Calm meter. Map keyboard and touch:

| Action | Keyboard | Touch | Phase | Effect |
|--------|----------|-------|-------|--------|
| Jump | Space / ↑ / W | Tap upper 2/3 of screen | 1 | Clears low-to-mid obstacles (hydrant, trash can, puddle) |
| Duck | ↓ / S | Swipe down OR tap lower 1/3 | 1 | Shrinks Arthur's hitbox to pass under high obstacles (branch, awning) |
| Distract | Shift | Dedicated on-screen button (bottom corner) | 2 | Spends one banked treat to neutralize the nearest approaching trigger, preventing the calm hit (see §8) |

Rules:
- Jump applies an upward impulse; gravity pulls Arthur back. No double-jump in v1.
- Duck holds while the key/touch is held, with a short minimum duck duration so taps register. Releasing returns Arthur to standing.
- Ducking mid-air should fast-fall (optional polish, not required for Phase 1).
- **Distract is the same single action on both platforms** — a dedicated key on desktop (default `Shift`; there's one on each side, so it works under both arrow-key and WASD grips, and keeps both hands on the keyboard) and an on-screen button for touch. The on-screen button only needs to render on touch devices. Make the key easy to change in the constants block.
- Distract does nothing if the treat bank is empty; reflect this by disabling/greying the on-screen button when treats = 0 so the player can read their ammo at a glance.

---

## 6. Physics constants (use these as starting values)

```
GRAVITY            = 0.8    // px per frame^2 at 60fps
JUMP_VELOCITY      = -15    // initial upward impulse
ARTHUR_X           = 180
GROUND_Y           = 460
ARTHUR_W           = 64
ARTHUR_H_STAND     = 56
ARTHUR_H_DUCK      = 32     // shorter hitbox while ducking
BASE_SCROLL_SPEED  = 6      // px/frame
SPEED_RAMP         = +0.5   // every 500m
MAX_SCROLL_SPEED   = 14
```

Tune to feel during playtest, but ship with values close to these — they produce a roughly 0.6s jump arc that clears single obstacles comfortably.

---

## 7. Entities

**Arthur (player).** States: `running`, `jumping`, `ducking`, `bolting` (game-over animation). Hitbox shrinks when ducking.

**Hard obstacles** (collision = damage/game-over). Spawn from the right edge at ground level or as overheads. **The shipped roster is an LA sidewalk lineup** (this supersedes the original hydrant/trashcan/puddle/branch set):
- `escooter` — dumped Lime e-scooter, jump over.
- `cone` — orange traffic cone, jump over.
- `servebot` — Serve delivery robot, jump over.
- `palmfrond` / `awning` — overhead, must duck under.

Obstacle spawning must be **fair**: enforce a minimum horizontal gap between obstacles computed from current scroll speed so every obstacle is always clearable with a single well-timed input. Never spawn a jump-obstacle and a duck-obstacle so close that they're impossible to chain.

**Treats** (collectible, beneficial). Float at jump-reachable or run height. Three tiers, differing in sprite, rarity, and score — but **every treat counts as exactly one unit of distract ammo** (Phase 2), keeping the economy simple:

| Treat | Rarity | Score |
|---|---|---|
| `green_ball` | Common | +5 |
| `fish` | Uncommon | +10 |
| `taco` | Uncommon | +15 |
| `chicken_bone` | Rare | +25 |

No penalty for missing them. Spawn weighting roughly 60/25/11/4.

**Triggers** (Phase 2 only — see §8). Things that stress Arthur. Tiered by severity — each type must be **visually distinct at a glance**, and the worst threats must read as such instantly:

| Trigger | Calm cost | Frequency | Notes |
|---|---|---|---|
| `human_runner` | −15 | Common | Jogger passing by |
| `small_dog` | −15 | Common | |
| `large_dog` | −25 | Uncommon | Visibly bigger sprite |
| `skateboard` | −40 | Rare | The big threat. Moves faster than the scroll speed so it arrives with urgency — shrinking the distract reaction window is part of what makes it the scariest trigger |

Triggers don't end the run on contact; they drain calm if they reach Arthur undefused (§8).

---

## 8. The Calm meter & distract action (Phase 2 system)

Arthur's signature mechanic and the thing that makes this *his* game. The design hinges on a treat economy: treats are the resource you spend to keep him calm.

- A meter from 0–100, starts at 100, shown as a bar (e.g. a bone or paw-print gauge) top-left. Show the **treat count** (distract ammo) next to it.
- **Triggers** scroll in like obstacles but don't end the run on contact. If a trigger reaches Arthur's x-position undefused, calm drops by its **tier cost** (−15 to −40, table in §7).
- **Distract** is how you defend calm: pressing it (default `Shift` / on-screen button) spends **one banked treat** to neutralize the nearest approaching trigger before it reaches Arthur — Arthur munches the treat, the trigger veers off, no calm lost.
- The tiered costs are what make the spend decision interesting: a treat spent on a jogger or small dog (−15) is usually a waste; a skateboard (−40) bearing down while your bank is empty is a disaster — and since skateboards move faster than the scroll, the reaction window is tight. Players learn to save ammo for skateboards and large dogs.
- **Recovery:** a slow passive regen of **+2/sec** lets calm climb back during clean stretches. This is the pressure valve for when you've run dry on treats — survive, stay clean, and Arthur settles.
- When calm reaches **0**, Arthur bolts → run ends (a distinct game-over from a collision).
- Telegraph triggers clearly — they must be visible far enough out to give a fair reaction window for the distract press.

**Tuning levers** (leave as `// TODO: tune`): per-tier trigger calm costs (§7 table), passive regen rate (+2/sec), and whether picking up a treat should also grant a small immediate calm bump (e.g. +5) if playtesting shows the meter is too punishing when ammo is scarce. Start with no on-pickup calm so the distract decision stays sharp.

Keep this layer strictly additive to Phase 1: in Phase 1 the meter, triggers, and distract simply don't exist. Phase 2 introduces them without touching the existing obstacle/collision code.

---

## 9. Difficulty

Difficulty escalates through three independent layers, so the pressure grows without ever resorting to unfair spawns.

**1. Speed — continuous.** The primary engine. Scroll speed starts at `BASE_SCROLL_SPEED` (6) and rises by `SPEED_RAMP` (+0.5) every 500m, capped at `MAX_SCROLL_SPEED` (14). Faster scroll = less reaction time per obstacle. This ramps smoothly across the whole run.

**2. Complexity / variety — stepped.** New obstacle *types* unlock at distance gates, so the player must read more threats and switch verbs more often: first 300m only `escooter` (jump); `awning`/`palmfrond` duck-obstacles unlock at 300m; `cone` and `servebot` thereafter. In Phase 2, triggers begin at 500m — once the player has the movement down — adding the entire calm-management layer on top of dodging.

**3. Density — bounded.** Spawn frequency tightens gently as speed rises, but the fair-spawning rule (§7) keeps every obstacle clearable with a single well-timed input. Difficulty rises through pressure and cognitive load, never through impossible spawns.

**How the distract economy adds its own curve.** As triggers grow more frequent deeper into a run, the treat supply can't keep pace, forcing the player to choose which triggers to spend ammo on and which to absorb. That's a difficulty curve on the calm side running in parallel to the speed curve on the dodging side — two simultaneous, escalating demands.

**Late-game note.** Pure-speed difficulty plateaus once scroll speed hits its cap (~8km in, at the values above). Most runs end well before that, so it's fine to ship as-is. If sustained late-game pressure is ever wanted, the cleanest lever is to keep ramping **trigger frequency** past the speed cap rather than pushing speed into pixel-perfect territory.

---

## 10. Game states & screens

A simple state machine: `MENU → PLAYING → GAME_OVER → (restart) PLAYING`.

- **Menu:** title "Arthur's Big Walk", a Play button, brief controls hint, the current high score, and **a real photo of Arthur** as the hero image.
- **Playing:** HUD shows distance, treat count, and (Phase 2) the Calm meter.
- **Game over:** show final score and a Restart prompt, with **a real Arthur photo** (a sad/dramatic one). Cause of death (hit obstacle vs. bolted) shown as flavor text.
- **New high score:** when the run beats the saved best, the game-over screen swaps to celebration mode — **a different (proud/happy) Arthur photo**, "NEW BEST!" banner, and the score.

**Photo plumbing:** load photos from `assets/photos/` with three documented filenames — `menu.jpg`, `gameover.jpg`, `highscore.jpg`. Until the files exist, fall back gracefully to the placeholder emoji/shape so Phase 1 ships without them. Display at a fixed max size with rounded corners so any aspect ratio looks intentional.

Pause on tab blur / `visibilitychange` so it doesn't run in the background.

---

## 11. Art & audio approach

**Art direction: pixel art.** Retro side-scroller aesthetic, in keeping with the genre. Concretely:
- Arthur is a **64×64 sprite** (matching `ARTHUR_W`); obstacles, treats, and triggers at sizes proportionate to their hitboxes. Chunky, readable pixels — design at 1× and scale up with `ctx.imageSmoothingEnabled = false` so pixels stay crisp, never blurry.
- Animation budget is small and that's fine: 2–4 frames for Arthur's run cycle, 1–2 for jump/duck.
- The parallax background layers and the daytime LA palette (§3) should follow the same pixel style — simple blocky silhouettes work great for skylines and palm trees.
- Wrap all drawing in a small `render` layer with named functions (`drawArthur`, `drawObstacle`, `drawBackground`). Phase 1 uses primitive shapes or emoji (🐕 for Arthur, 🎾 for treats) as placeholders — but structure the render layer for sprite-sheet drawing from the start so swapping in real pixel art touches one module only.
- Provide a single, documented sprite-sheet seam: expected frame size 64×64, with a comment listing required frames (run×4, jump, duck, bolt) so the eventual Arthur asset can be produced to spec (e.g. in Piskel or Aseprite). Real Arthur **photos** (§10) are the exception to the pixel style — they display as-is on menu/game-over/high-score screens.
- **Reference photos (local-only):** the owner will place photos of the real Arthur in `assets/reference/` for use as visual reference when designing the pixel sprite (coat color, ear shape, build, markings). This folder **must be listed in `.gitignore`** so reference photos are never pushed to the public repo. The display photos in `assets/photos/` (§10) ARE meant to be deployed; only `assets/reference/` stays local.
- **Audio is optional and Phase 3.** If added: a soft jump blip, a treat chime, a game-over sound (ideally a real recording of Arthur's bark for the distract moment). Use the Web Audio API or small base64-embedded clips; everything must remain offline-capable. Respect a mute toggle.

---

## 12. Build phases (do these in order)

**Phase 1 — Playable MVP.** Scrolling world with one parallax pass, Arthur running, jump + duck, hard obstacles with fair spawning, collision → game over, distance score, high-score persistence, menu + game-over screens, keyboard + touch. *This phase alone is a complete, shippable game.*

**Phase 2 — Arthur's heart.** Add the Calm meter, trigger entities, the treat bank, and the **distract action** (costed by treats, per §8 — build the meter and triggers first so you can feel the unmanaged version, then add distract as the final sub-step). Add the bolt game-over and the HUD (meter + treat count). Add biome cycling and full 3-layer parallax if not already done.

**Phase 3 — Polish & stretch.** Sound effects + mute, real Arthur sprite swap, particle/juice effects (dust on landing, treat sparkle, a little Arthur head-turn on a successful distract), a difficulty-tuning pass using the levers in §8 and §9, and **unlockable accessories**:
- Cosmetic items Arthur wears in-game: e.g. `red_scarf` (50 lifetime treats), `bow_tie` (150), `bandana` (300). Numbers are `// TODO: tune`.
- Track **lifetime treats collected** across all runs in `localStorage` (`arthur_lifetime_treats`), plus the selected accessory (`arthur_accessory`).
- A simple "Closet" screen reachable from the menu: shows each item as unlocked/locked with its treat requirement, click to equip. Equipped item renders on Arthur during runs.
- Purely cosmetic — no gameplay effect — so it can't unbalance anything.

Ship Phase 1 to GitHub Pages before starting Phase 2.

---

## 13. Suggested file structure

```
arthurs-big-walk/
├─ index.html        # canvas + minimal CSS + game bootstrap
├─ game.js           # constants, game loop, state machine, entities, render layer
├─ assets/
│  ├─ photos/        # menu.jpg, gameover.jpg, highscore.jpg (deployed; game falls back if absent)
│  ├─ sprites/       # arthur.png sprite sheet (deployed; game falls back to shapes if absent)
│  └─ reference/     # LOCAL-ONLY: Arthur photos + sprite/sheet generator scripts — gitignored
├─ .gitignore        # must include assets/reference/
└─ README.md         # how to run locally + full GitHub Pages deploy walkthrough
```

Keep it runnable by simply opening `index.html` (or via any static server).

**README must include a complete GitHub Pages walkthrough** written for someone doing it for the first time: create the repo, push the files, enable Pages (Settings → Pages → deploy from `main` branch root), the resulting `https://<username>.github.io/<repo>/` URL, and how to update the live site (just push). Also note the practical caveats: the site and repo are public, content (including the Arthur photos) is publicly accessible, and `localStorage` data (high score, unlocks) is per-browser/per-device and won't sync between machines.

---

## 14. Acceptance criteria ("done" for Phase 1)

- Loads and runs at ~60fps in current Chrome/Safari/Firefox, desktop and mobile.
- Arthur can jump and duck via both keyboard and touch; inputs feel responsive.
- Obstacles are always fairly clearable; no impossible spawns across a 5-minute run.
- Collision ends the run and shows a game-over screen with final score.
- High score persists across page reloads via `localStorage`.
- No console errors; no runtime network dependency.
- Deployable to GitHub Pages with no modifications.

---

## 15. Notes for the builder

- Favor readability and small, well-named functions over cleverness — this is a hobby project that will be extended by hand.
- Put all tunable constants in one clearly labeled block at the top so balancing is a one-stop edit.
- Comment the sprite-swap seam and the constants block especially well.
- When unsure about a feel decision, pick the simpler option and leave a `// TODO: tune` marker.
