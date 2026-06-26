"use strict";

/* ============================================================
   Arthur's Big Walk — Phase 1

   Scrolling world, sprite Arthur with jump + duck, five obstacle
   types with fair spawning, treats, collision -> game over,
   composite score, high-score persistence.

   All gameplay coordinates are in logical 960x540 space; the
   canvas is scaled to fit the viewport. Physics run on a fixed
   1/60s timestep, so the constants below are in px-per-frame
   terms exactly as in the spec.
   ============================================================ */

// ---------------- Tunable constants (one-stop balancing) ----------------
const VIEW_W = 960;
const VIEW_H = 540;
const GROUND_Y = 460;

const GRAVITY = 0.8;              // px per frame^2
const JUMP_VELOCITY = -15;        // initial upward impulse (apex ~141px; tallest jump obstacle is 50px) // TODO: tune (user feedback 2026-06-19: jump higher/easier to clear the scooter)
const ARTHUR_X = 180;
const ARTHUR_W = 64;
const ARTHUR_H_STAND = 56;
const ARTHUR_H_DUCK = 32;

const BASE_SCROLL_SPEED = 5;      // px per frame // TODO: tune (user feedback 2026-06-21: slower start)
const SPEED_RAMP = 0.5;           // added every RAMP_INTERVAL_M meters
const RAMP_INTERVAL_M = 300;      // TODO: tune (was 500; user feedback 2026-06-12: ramp felt too slow)
const MAX_SCROLL_SPEED = 14;

// A jump pressed this many frames before landing still fires on touchdown,
// so slightly-early presses don't get eaten. // TODO: tune
const JUMP_BUFFER_FRAMES = 8;

// Touch (spec §5): tap the upper TOUCH_JUMP_FRACTION of the canvas to jump,
// the lower part to duck. A duck holds for at least MIN_DUCK_FRAMES so a quick
// tap still produces a visible duck instead of a single-frame flicker.
const TOUCH_JUMP_FRACTION = 2 / 3;
const MIN_DUCK_FRAMES = 10;       // ~0.17s // TODO: tune
const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches;

// Parallax factors per background layer (spec §3)
const PARALLAX_FAR = 0.2;
const PARALLAX_MID = 0.5;
const PARALLAX_NEAR = 1.0;

const PX_PER_METER = 50;
const HITBOX_INSET = 6;           // collision forgiveness margin // TODO: tune

// ---- Neighborhood zones (the walk loops west through LA) ----
// Each zone swaps all three parallax tiles; layers crossfade together near
// the boundary. Lineup loops westward: weho -> beverly -> beach (the old
// Hollywood zone was cut; its skyline + power poles moved to Beverly).
// Obstacles stay universal across zones for now; zone-themed reskins
// (render-only, same hitboxes) are planned polish.
const ZONE_LEN_M = 500;           // TODO: tune
const ZONE_FADE_PX = 800;         // scroll px of crossfade before a boundary // TODO: tune

// ---- Fair spawning (spec §7: every obstacle clearable with one input) ----
// The gap to the next obstacle is computed in frames of travel: time to see
// and react, plus the full jump arc, plus extra recovery when the required
// verb changes (jump <-> duck), plus a random breather. Frames scale with
// speed, so the rule stays fair as the game accelerates.
const REACTION_FRAMES = 45;       // TODO: tune
const VERB_SWITCH_FRAMES = 20;    // TODO: tune
const EXTRA_GAP_FRAMES = 60;      // random extra, up to this many frames // TODO: tune
const JUMP_AIRTIME_FRAMES = (2 * Math.abs(JUMP_VELOCITY)) / GRAVITY;

// Gentler opening: every gap gets up to EARLY_GAP_FRAMES of extra breathing
// room, fading linearly to zero by EARLY_GAP_EASE_M, so early obstacles are
// sparse while the player warms up.
const EARLY_GAP_FRAMES = 90;      // TODO: tune (user feedback 2026-06-21: fewer obstacles early)
const EARLY_GAP_EASE_M = 400;     // TODO: tune

// Overhead obstacles leave this much room underneath: a ducking Arthur
// (32px box) fits, a standing one (56px) does not. // TODO: tune
const OVERHEAD_CLEARANCE = 44;

// Obstacle roster — an LA sidewalk lineup (Gemini art in assets/sprites/obstacles.png).
// Box sizes match the sprite art so the hitbox is fair. unlockM gates types by
// distance (spec §9); user feedback 2026-06-21 wanted variety from the start, so
// every type now spawns from 0m. Fair-spawning keeps each one clearable and the
// jump<->duck verb switch is already budgeted into the gap. overhead = "duck under it".
const OBSTACLE_TYPES = {
  escooter: { w: 54, h: 50, overhead: false, unlockM: 0, msg: "tripped over a scooter" },
  awning: { w: 110, h: 38, overhead: true, unlockM: 0, msg: "ran into an awning" },
  palmfrond: { w: 96, h: 42, overhead: true, unlockM: 0, msg: "got smacked by a palm frond" },
  cone: { w: 38, h: 44, overhead: false, unlockM: 0, msg: "knocked over a cone" },
  servebot: { w: 48, h: 48, overhead: false, unlockM: 0, msg: "collided with a delivery robot" },
};

// ---- Treats (spec §7): collectible score, no penalty for missing ----
// Every treat also banks one unit of distract ammo in Phase 2; track count
// and score separately so that layer can drop in without rework.
const TREAT_TIERS = {
  green_ball: { score: 5, weight: 60 },
  fish: { score: 10, weight: 25 },
  taco: { score: 15, weight: 11 },
  chicken_bone: { score: 25, weight: 4 },
};
const TREAT_SIZE = 28;                 // square hitbox centered on the sprite
const TREAT_GAP_MIN_PX = 600;          // TODO: tune (user feedback 2026-06-11: was 360/900, too frequent)
const TREAT_GAP_MAX_PX = 1400;         // TODO: tune
const TREAT_RUN_Y = GROUND_Y - 38;     // center height: grabbable while running
const TREAT_JUMP_Y = GROUND_Y - 115;   // center height: needs a jump // TODO: tune
const TREAT_JUMP_CHANCE = 0.4;         // share of treats placed at jump height

// ---- Sprite sheet (assets/sprites/arthur.png) ----
// 7 frames of 64x64 in one row: run0 run1 run2 run3 jump duck bolt.
// Regenerate with assets/reference/sprite-drafts/generate_sprite_sheet.py.
// The game falls back to placeholder shapes if the file is missing.
const SPRITE_FRAME = 64;
const SPRITE_FOOT_Y = 54;         // paw line inside a frame (grid row 27 at 2x)
const SPRITE_JUMP = 4;
const SPRITE_DUCK = 5;
const SPRITE_BOLT = 6;             // unused on death now — Arthur runs off instead (see OUTRO)
const RUN_ANIM_SCROLL_PX = 36;    // scroll px per run frame, so legs speed up with the world // TODO: tune
const OUTRO_RUN_SPEED = 12;       // px/frame Arthur pulls ahead as he bolts off after a hit // TODO: tune

// Dev helper: open the game with ?start=600 to begin runs at 600m, to test
// distance-gated unlocks without playing there manually.
const DEBUG_START_M = Number(new URLSearchParams(location.search).get("start")) || 0;
// Dev helper: ?allobstacles ignores the unlockM gates so every obstacle type can
// spawn from 0m (for testing Arthur's jump/duck clearance against each).
const DEBUG_ALL_OBSTACLES = new URLSearchParams(location.search).has("allobstacles");
// Dev helper: ?tour disables every obstacle, treat, and collision so the run
// becomes a hands-off scenery scan through all three zones (combine with
// ?start= to jump straight to Beverly Hills ~700 or the Beach ~1200).
const DEBUG_TOUR = new URLSearchParams(location.search).has("tour");

const HIGHSCORE_KEY = "arthur_highscore";

// ---------------- Canvas setup ----------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = VIEW_W;
canvas.height = VIEW_H;
ctx.imageSmoothingEnabled = false;

// On phones the screen is far wider than the game's 16:9, so a plain "contain"
// fit leaves big side bars and a small scene. On touch devices we zoom past
// contain to fill the screen, capped two ways so the zoom is always safe:
//   - never wider than the viewport, so upcoming obstacles on the right are
//     never cropped (which would be unfair);
//   - never so tall that we hide more than the empty street below Arthur, so
//     the top HUD and Arthur himself always stay on screen.
// The CSS top-anchors the canvas on touch (see index.html) so all of the
// vertical overflow is cropped off the bottom street, never the HUD.
const SAFE_VISIBLE_H = 475; // keep y=0 (HUD) .. y=475 (just below Arthur's feet) visible

function fitCanvas() {
  const contain = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  let scale = contain;
  if (IS_TOUCH) {
    const fill = Math.min(window.innerWidth / VIEW_W, window.innerHeight / SAFE_VISIBLE_H);
    scale = Math.max(contain, fill);
  }
  canvas.style.width = `${Math.floor(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * scale)}px`;
}
window.addEventListener("resize", fitCanvas);
// Mobile browsers fire orientationchange and (on URL-bar show/hide) a
// visualViewport resize without always firing a window resize — refit on both.
window.addEventListener("orientationchange", fitCanvas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", fitCanvas);
fitCanvas();

// In portrait the 16:9 game letterboxes to a thin strip, so the HTML overlay in
// index.html asks the player to rotate. Pause an in-progress run while portrait
// so Arthur can't die unseen behind the overlay.
const portraitMQ = window.matchMedia("(orientation: portrait) and (pointer: coarse)");
function syncPortraitPause() {
  if (portraitMQ.matches && state === STATE.PLAYING) state = STATE.PAUSED;
}
portraitMQ.addEventListener("change", syncPortraitPause);

// ---------------- Background layers (parallax, daytime LA) ----------------
// Each layer is pre-rendered once into an offscreen canvas and then drawn as
// a repeating tile at its parallax factor — no per-frame shape generation.
// Shapes snap to a 4px grid so the scenery reads as chunky pixel art.

function mulberry32(seed) {
  // tiny seeded PRNG so the generated skyline is identical every load
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Backdrop tiles are pre-rendered once. We keep each tile's paint closure so
// the whole set can be re-baked when the scenery atlas finishes loading (the
// canvas objects stay stable, so ZONES keeps pointing at them).
const sceneryLayers = [];
function makeLayer(width, height, paint) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  c._repaint = () => {
    g.clearRect(0, 0, width, height);
    paint(g, width, height);
  };
  c._repaint();
  sceneryLayers.push(c);
  return c;
}

// ---- Scenery sprite atlas (AI-generated backdrop objects) ----
// Built by import_gemini_scenery.py; rects mirror its printout. Each draw*()
// blits its rect bottom-anchored at the same (x, baseY) it drew procedurally,
// falling back to the code-drawn art until the atlas loads.
const SCENERY_SPRITES = {
  cafe_a: [618, 0, 166, 136], cafe_b: [784, 0, 166, 136], cafe_c: [0, 250, 166, 136],
  cafe_table: [128, 496, 40, 52],
  pdc: [428, 0, 190, 168],
  salt_straw: [712, 250, 150, 120],
  jacaranda1: [918, 250, 64, 110], jacaranda2: [0, 386, 64, 110], jacaranda3: [64, 386, 64, 110],
  house1: [166, 250, 182, 128], house2: [348, 250, 182, 128], house3: [530, 250, 182, 128],
  hedge: [682, 496, 120, 26],
  fountain: [602, 386, 96, 70],
  shield: [388, 386, 96, 88],
  tallpalm: [0, 0, 56, 250],
  pole: [356, 0, 72, 176],
  skyline: [56, 0, 300, 184],
  lifeguard: [484, 386, 118, 88],
  net: [544, 496, 92, 40],
  pier: [128, 386, 260, 96],
  beach_palm: [862, 250, 56, 120],
  umbrella_coral: [958, 386, 48, 58], umbrella_blue: [0, 496, 48, 58],
  // background people & pets (one figure each, bottom-anchored)
  ppl_couple: [168, 496, 58, 52], ppl_dogwalker_w: [226, 496, 48, 50],
  ppl_cyclist: [432, 496, 56, 48], ppl_matcha: [274, 496, 36, 50],
  ppl_dogwalker_b: [310, 496, 48, 50], ppl_phone: [358, 496, 34, 50],
  ppl_yoga: [392, 496, 40, 50], ppl_childbike: [636, 496, 46, 40],
  ppl_swimcouple: [488, 496, 56, 48], ppl_surfer: [78, 496, 50, 54],
  ppl_unicycle: [48, 496, 30, 56], ppl_dog: [802, 496, 32, 26],
  // banner plane for the sky (far layer, all zones); flies left -- never flip it
  plane_banner: [698, 386, 260, 64],
};
const scenerySprite = new Image();
let scenerySpriteReady = false;
scenerySprite.onload = () => {
  scenerySpriteReady = true;
  for (const c of sceneryLayers) c._repaint(); // swap procedural art for sprites
};
scenerySprite.src = "assets/sprites/scenery.png";

// blit a scenery rect; dw/dh default to the sprite's box size
function blitScenery(g, name, dx, dy, dw, dh) {
  const r = SCENERY_SPRITES[name];
  g.drawImage(scenerySprite, r[0], r[1], r[2], r[3],
    Math.round(dx), Math.round(dy), Math.round(dw ?? r[2]), Math.round(dh ?? r[3]));
}

// ---- Background people & pets ----
// Sparse mid-layer figures standing on the storefront baseline. Each blits its
// atlas rect bottom-anchored at (x, baseY); flip mirrors a walker to face left.
// They live in the mid layer (0.5x parallax) so they recede behind the gameplay.
function drawFigure(g, name, x, baseY, flip) {
  const r = SCENERY_SPRITES[name];
  const fw = r ? r[2] : 24;
  const fh = r ? r[3] : 46;
  if (scenerySpriteReady && r) {
    if (flip) {
      g.save();
      g.translate(Math.round(x) + fw, 0);
      g.scale(-1, 1);
      blitScenery(g, name, 0, baseY - fh);
      g.restore();
    } else {
      blitScenery(g, name, x, baseY - fh);
    }
    return;
  }
  // muted placeholder silhouette until the atlas loads
  g.fillStyle = "#9a958c";
  g.fillRect(Math.round(x + fw * 0.3), baseY - fh, Math.round(fw * 0.4), fh);
  g.fillStyle = "#b3a290";
  g.fillRect(Math.round(x + fw * 0.3), baseY - fh, Math.round(fw * 0.4), Math.round(fh * 0.22));
}

// figs: array of [spriteName, x, flip] placed along baseY
function drawPedestrians(g, baseY, figs) {
  for (const [name, x, flip] of figs) drawFigure(g, name, x, baseY, flip);
}

// Banner plane drifting high in the sky (far layer, every zone). The sprite
// flies left with the banner streaming right; never h-flip it (reverses text).
function drawBannerPlane(g, x, y) {
  if (scenerySpriteReady) {
    blitScenery(g, "plane_banner", x, y);
    return;
  }
  g.fillStyle = "#3f4a63"; // plane on the left, nose left
  g.fillRect(x, y + 16, 44, 16);
  g.fillRect(x + 32, y + 8, 12, 24);
  g.fillStyle = "#e6ddca"; // banner streaming right
  g.fillRect(x + 74, y + 12, 180, 26);
}

function drawRidgeline(g, w, h, peakH, color, seed) {
  // broad sine swells plus small jitter read as distant peaks (a random walk
  // clamps into boxy plateaus); whole sine cycles across the tile keep the
  // horizontal repeat seamless
  const rng = mulberry32(seed);
  g.fillStyle = color;
  const step = 16;
  const cycles = 3 + Math.floor(rng() * 2);
  const phase = rng() * Math.PI * 2;
  for (let x = 0; x < w; x += step) {
    const t = x / w;
    const swell =
      Math.sin(t * Math.PI * 2 * cycles + phase) * 0.5 +
      Math.sin(t * Math.PI * 2 * (cycles + 2) + phase * 1.7) * 0.3;
    let y = h - peakH * (0.55 + swell * 0.4) + (rng() - 0.5) * 12;
    y = Math.max(h - peakH, Math.min(h - 16, y));
    const qy = Math.round(y / 4) * 4;
    g.fillRect(x, qy, step, h - qy);
  }
}

function drawPixelPalm(g, x, baseY, hgt, rng) {
  if (scenerySpriteReady) {
    const r = SCENERY_SPRITES.beach_palm;
    const dw = r[2] * (hgt / r[3]);
    blitScenery(g, "beach_palm", x - dw / 2 + 10, baseY - hgt, dw, hgt);
    return;
  }
  const lean = 12 + Math.floor(rng() * 3) * 4;
  const segs = 7;
  let tx = x;
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    tx = x + Math.round((lean * t * t) / 4) * 4;
    g.fillStyle = i % 2 ? "#94745c" : "#84684f"; // alternating ring shading
    g.fillRect(tx, Math.round((baseY - (hgt / segs) * (i + 1)) / 4) * 4, 8, Math.ceil(hgt / segs) + 4);
  }
  const cx = tx + 4;
  const cy = baseY - hgt;
  const dirs = [[-1, -0.4], [-1, 0.1], [-0.6, -0.8], [0.2, -1], [0.8, -0.6], [1, 0], [1, 0.3], [-0.8, 0.5]];
  for (let d = 0; d < dirs.length; d++) {
    g.fillStyle = d % 2 ? "#3f7a4e" : "#558f5e";
    for (let s = 1; s <= 5; s++) {
      const fx = cx + Math.round((dirs[d][0] * s * 7) / 4) * 4;
      const fy = cy + Math.round((dirs[d][1] * s * 5 + s * s * 0.9) / 4) * 4; // fronds droop
      g.fillRect(fx, fy, 8, 4);
    }
  }
  g.fillStyle = "#5f4632"; // coconuts
  g.fillRect(cx - 4, cy, 4, 4);
  g.fillRect(cx + 4, cy + 4, 4, 4);
}

function drawPowerPole(g, x, baseY) {
  if (scenerySpriteReady) {
    // sprite trunk is centered in its 72px box; align to the procedural trunk
    blitScenery(g, "pole", x - 32, baseY - SCENERY_SPRITES.pole[3]);
    return;
  }
  const top = baseY - 172;
  g.fillStyle = "#6b5942";
  g.fillRect(x, top, 8, 172);
  g.fillRect(x - 20, top + 8, 48, 6);  // crossarm
  g.fillRect(x - 12, top + 28, 32, 6); // lower arm
  g.fillStyle = "#8d8d8d"; // insulators
  g.fillRect(x - 18, top + 2, 4, 6);
  g.fillRect(x + 22, top + 2, 4, 6);
}

function drawSaggingWire(g, x1, x2, y, sag, tileW) {
  // parabola sampled in chunky 8px segments; segments past the tile edge
  // wrap back so the seam-crossing span lines up with the repeat
  g.fillStyle = "#4d4d52";
  for (let fx = x1; fx <= x2; fx += 8) {
    const t = (fx - x1) / (x2 - x1);
    const fy = Math.round((y + sag * 4 * t * (1 - t)) / 2) * 2;
    const dx = fx >= tileW ? fx - tileW : fx;
    g.fillRect(dx, fy, 8, 2);
    if (dx + 8 > tileW) g.fillRect(dx - tileW, fy, 8, 2); // edge segment shows on both sides
  }
}

function drawSkyline(g, x, h) {
  if (scenerySpriteReady) {
    blitScenery(g, "skyline", x, h - SCENERY_SPRITES.skyline[3]);
    return;
  }
  // downtown cluster on the far ridge: hazy blue-gray towers a shade darker
  // than the back ridge, with a couple of recognizable LA silhouettes
  const towers = [
    { dx: 0, w: 56, hgt: 96, top: "flat" },
    { dx: 64, w: 48, hgt: 148, top: "spire" },  // Wilshire Grand-ish
    { dx: 120, w: 64, hgt: 120, top: "step" },
    { dx: 196, w: 40, hgt: 160, top: "round" }, // US Bank Tower-ish
    { dx: 244, w: 56, hgt: 84, top: "flat" },
  ];
  towers.forEach((t, i) => {
    const tx = x + t.dx;
    const ty = h - t.hgt;
    g.fillStyle = i % 2 ? "#94a9bc" : "#8ba1b5";
    g.fillRect(tx, ty, t.w, t.hgt);
    if (t.top === "step") {
      g.fillRect(tx + 8, ty - 12, t.w - 16, 12);
      g.fillRect(tx + 16, ty - 20, t.w - 32, 8);
    } else if (t.top === "round") {
      g.fillRect(tx + 4, ty - 8, t.w - 8, 8);
      g.fillRect(tx + 12, ty - 12, t.w - 24, 4);
    } else if (t.top === "spire") {
      g.fillRect(tx + t.w / 2 - 2, ty - 24, 4, 24);
    }
    g.fillStyle = "#a9bccb"; // sparse window columns, barely lighter than the wall
    for (let wx = tx + 8; wx + 4 <= tx + t.w - 8; wx += 16) {
      g.fillRect(wx, ty + 12, 4, t.hgt - 36);
    }
  });
}

// static sky + sun (doesn't scroll)
const skyLayer = makeLayer(VIEW_W, GROUND_Y, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#6cb2e8");
  grad.addColorStop(1, "#d2eaf6");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const sx = w - 150;
  const sy = 80;
  for (const [r, a] of [[44, 0.18], [34, 0.3]]) {
    g.fillStyle = `rgba(255, 246, 200, ${a})`;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#fff8d7";
  g.beginPath();
  g.arc(sx, sy, 26, 0, Math.PI * 2);
  g.fill();
});

// ============ Beach zone (Santa Monica) ============

function drawFerrisWheel(g, cx, cy, r) {
  // pixel ring + spokes; muted steel so it reads as a distant landmark
  const q = (v) => Math.round(v / 4) * 4;
  g.fillStyle = "#8a8398";
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    g.fillRect(cx + q(Math.cos(a) * r), cy + q(Math.sin(a) * r), 4, 4);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.fillRect(cx + q(Math.cos(a) * r * 0.4), cy + q(Math.sin(a) * r * 0.4), 4, 4);
    g.fillRect(cx + q(Math.cos(a) * r * 0.7), cy + q(Math.sin(a) * r * 0.7), 4, 4);
  }
  g.fillRect(cx - 2, cy - 2, 8, 8); // hub
  g.fillRect(cx - 12, cy + 4, 6, r); // A-frame legs
  g.fillRect(cx + 10, cy + 4, 6, r);
}

function drawPier(g, x, horizon) {
  if (scenerySpriteReady) {
    // anchor the pile bottoms to ~horizon+44 (where the procedural piles end)
    blitScenery(g, "pier", x, horizon + 44 - SCENERY_SPRITES.pier[3]);
    return;
  }
  // dark deck band on the waterline with piles, ferris wheel on top
  g.fillStyle = "#6b6470";
  g.fillRect(x, horizon + 8, 260, 8);
  for (let px = x + 8; px < x + 260; px += 28) g.fillRect(px, horizon + 16, 4, 28);
  drawFerrisWheel(g, x + 150, horizon - 36, 40);
}

function drawLifeguardTower(g, x, baseY) {
  if (scenerySpriteReady) {
    // sprite includes the access ramp on its left; align the cabin to x
    blitScenery(g, "lifeguard", x - 48, baseY - SCENERY_SPRITES.lifeguard[3]);
    return;
  }
  g.fillStyle = "#b56a52"; // roof
  g.fillRect(x - 4, baseY - 84, 56, 8);
  g.fillStyle = "#8ab0bc"; // pastel-blue cabin
  g.fillRect(x, baseY - 76, 48, 30);
  g.fillStyle = "#5f8895";
  g.fillRect(x + 8, baseY - 68, 16, 14); // window
  g.fillStyle = "#a08456"; // stilts
  g.fillRect(x + 4, baseY - 46, 6, 46);
  g.fillRect(x + 38, baseY - 46, 6, 46);
  for (let i = 0; i < 6; i++) { // access ramp down to the sand
    g.fillRect(x - 10 - i * 8, baseY - 42 + i * 7, 12, 4);
  }
}

function drawUmbrella(g, x, baseY, color) {
  if (scenerySpriteReady) {
    const name = color === "#6a93a8" ? "umbrella_blue" : "umbrella_coral";
    blitScenery(g, name, x - SCENERY_SPRITES[name][2] / 2, baseY - SCENERY_SPRITES[name][3]);
    return;
  }
  g.fillStyle = "#8a7a66";
  g.fillRect(x - 2, baseY - 40, 4, 40); // pole
  const rows = [[20, 0], [32, 6], [44, 12], [48, 18]]; // dome widths/offsets
  rows.forEach(([rw, dy], i) => {
    g.fillStyle = i % 2 ? "#ece6d8" : color;
    g.fillRect(x - rw / 2, baseY - 58 + dy, rw, 6);
  });
}

function drawVolleyballNet(g, x, baseY) {
  if (scenerySpriteReady) {
    blitScenery(g, "net", x, baseY - SCENERY_SPRITES.net[3]);
    return;
  }
  g.fillStyle = "#8a7a66";
  g.fillRect(x, baseY - 38, 4, 38);
  g.fillRect(x + 88, baseY - 38, 4, 38);
  g.fillStyle = "#e8e2d4";
  g.fillRect(x + 4, baseY - 36, 84, 3); // top tape
  for (let nx = x + 10; nx < x + 88; nx += 10) g.fillRect(nx, baseY - 33, 2, 12);
  g.fillRect(x + 4, baseY - 22, 84, 2); // bottom tape
}

// far: open ocean to the horizon, sun sparkle, Catalina, and the pier
const beachFar = makeLayer(1920, GROUND_Y, (g, w, h) => {
  const rng = mulberry32(31);
  const horizon = h - 150;
  g.fillStyle = "#7fa6bf";
  g.fillRect(0, horizon, w, 30);
  g.fillStyle = "#6e97b2";
  g.fillRect(0, horizon + 30, w, 44);
  g.fillStyle = "#5e88a4";
  g.fillRect(0, horizon + 74, w, h - horizon - 74);
  g.fillStyle = "#c4dbe6"; // sparkle dashes, denser toward the horizon
  for (let i = 0; i < 120; i++) {
    const y = horizon + 4 + Math.floor((rng() * rng()) * (h - horizon - 12) / 4) * 4;
    g.fillRect(Math.floor((rng() * w) / 8) * 8, y, 8, 2);
  }
  g.fillStyle = "#9eb4c8"; // Catalina, hazy on the horizon
  g.fillRect(320, horizon - 8, 96, 8);
  g.fillRect(344, horizon - 12, 40, 4);
  drawPier(g, 1180, horizon);
  drawBannerPlane(g, 300, 46);
});

// mid: deep sand with lifeguard towers, umbrellas, a volleyball net, palms
const beachMid = makeLayer(1920, GROUND_Y, (g, w, h) => {
  const rng = mulberry32(37);
  const sandTop = h - 64;
  g.fillStyle = "#ddcda6";
  g.fillRect(0, sandTop, w, 64);
  g.fillStyle = "#f0e8d4"; // bright wet-sand line where the water laps
  g.fillRect(0, sandTop, w, 4);
  g.fillStyle = "#cdbc94";
  for (let i = 0; i < 150; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, sandTop + 8 + Math.floor(rng() * 14) * 4, 4, 4);
  }
  drawLifeguardTower(g, 240, h - 8);
  drawLifeguardTower(g, 1480, h - 8);
  drawUmbrella(g, 660, h - 10, "#c47a6a");
  drawUmbrella(g, 1100, h - 18, "#6a93a8");
  drawVolleyballNet(g, 800, h - 6);
  drawPixelPalm(g, 60, h - 4, 104, rng);
  drawPixelPalm(g, 1330, h - 4, 120, rng);
  // beachgoers on the sand
  drawPedestrians(g, h - 6, [
    ["ppl_swimcouple", 520, false],
    ["ppl_surfer", 940, false],
    ["ppl_unicycle", 1240, true],
    ["ppl_dog", 1600, false],
  ]);
});

// near: the Strand bike path with sand spilling over instead of curb+asphalt
const beachNear = makeLayer(640, VIEW_H - GROUND_Y, (g, w, h) => {
  const rng = mulberry32(41);
  g.fillStyle = "#d8d2c0"; // path concrete
  g.fillRect(0, 0, w, 30);
  g.fillStyle = "#c9c2ae";
  for (let i = 0; i < 50; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 4 + Math.floor(rng() * 6) * 4, 4, 4);
  }
  g.fillStyle = "#aaa490";
  g.fillRect(0, 0, w, 3); // path top edge
  for (let jx = 0; jx < w; jx += 160) g.fillRect(jx, 4, 3, 26); // joints
  g.fillStyle = "#b8a14f"; // bike-path center line
  for (let lx = 40; lx < w; lx += 160) g.fillRect(lx, 14, 48, 3);
  g.fillStyle = "#e0d0a8"; // sand below the path
  g.fillRect(0, 30, w, h - 30);
  g.fillStyle = "#cfbe96";
  for (let i = 0; i < 70; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 34 + Math.floor(rng() * 11) * 4, 4, 4);
  }
  g.fillStyle = "#e0d0a8"; // sand drifting onto the path's bottom edge
  for (let i = 0; i < 22; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 26, 4, 4);
  }
  g.fillStyle = "#f0e8d4"; // a few shells
  for (let i = 0; i < 8; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 38 + Math.floor(rng() * 9) * 4, 4, 2);
  }
});

// ============ West Hollywood zone (chic storefronts) ============

function drawCafe(g, x, baseY, rng) {
  if (scenerySpriteReady) {
    // one of three palette variants
    const v = ["cafe_a", "cafe_b", "cafe_c"][Math.floor(rng() * 3)];
    blitScenery(g, v, x, baseY - SCENERY_SPRITES[v][3]);
    return;
  }
  // two-tone boutique/cafe: lit face + shadowed parapet, sign band, big
  // window, striped awning over outdoor seating. Muted jewel tones; red is
  // reserved for the deadly awning obstacle, so cafes use teal/plum/mustard.
  const palettes = [
    { wall: "#cfc4d0", shade: "#b6abba", sign: "#4a6e72", awn: "#6e9b8e" },
    { wall: "#d6c8b8", shade: "#bcae9e", sign: "#6e5168", awn: "#9c7fa0" },
    { wall: "#c8cdcf", shade: "#aeb4b8", sign: "#7a6a44", awn: "#c4a85c" },
  ];
  const p = palettes[Math.floor(rng() * palettes.length)];
  const w = 150 + Math.floor(rng() * 3) * 16;
  const hgt = 120 + Math.floor(rng() * 2) * 16;
  g.fillStyle = p.wall;
  g.fillRect(x, baseY - hgt, w, hgt);
  g.fillStyle = p.shade; // shadow side gives the flat wall some depth
  g.fillRect(x + w - 14, baseY - hgt, 14, hgt);
  g.fillStyle = "#a89c92";
  g.fillRect(x - 4, baseY - hgt - 8, w + 8, 8); // parapet cap
  g.fillStyle = p.sign;
  g.fillRect(x + 10, baseY - hgt + 12, w - 20, 16);
  g.fillStyle = "#ece6d8";
  for (let lx = x + 18; lx + 6 < x + w - 18; lx += 14) g.fillRect(lx, baseY - hgt + 17, 6, 6);
  // upper-floor windows
  g.fillStyle = "#8fa6b2";
  for (let wx = x + 14; wx + 16 < x + w - 14; wx += 30) g.fillRect(wx, baseY - hgt + 40, 16, 22);
  // striped storefront awning
  for (let i = 0; i * 14 < w - 20; i++) {
    g.fillStyle = i % 2 ? "#ece6d8" : p.awn;
    g.fillRect(x + 10 + i * 14, baseY - hgt + 72, Math.min(14, w - 20 - i * 14), 12);
  }
  // ground floor: glass + door
  g.fillStyle = "#9fb4c0";
  g.fillRect(x + 10, baseY - hgt + 86, w - 50, hgt - 90);
  g.fillStyle = "#b6c6cf";
  g.fillRect(x + 16, baseY - hgt + 92, 6, hgt - 100);
  g.fillStyle = "#5a4a40";
  g.fillRect(x + w - 32, baseY - 34, 22, 34);
}

function drawPDC(g, x, baseY) {
  // Pacific Design Center "Blue Whale" — the WeHo landmark (the procedural
  // body below is a marquee-shaped fallback for when the atlas is absent).
  if (scenerySpriteReady) {
    blitScenery(g, "pdc", x, baseY - SCENERY_SPRITES.pdc[3]);
    return;
  }
  const hgt = 132;
  g.fillStyle = "#b6aea4";
  g.fillRect(x, baseY - hgt, 130, hgt);
  g.fillStyle = "#9c948a";
  g.fillRect(x + 116, baseY - hgt, 14, hgt);
  g.fillStyle = "#3c4654"; // marquee board jutting out
  g.fillRect(x - 12, baseY - hgt + 24, 150, 30);
  g.fillStyle = "#e8c75a"; // bulb dots around the board
  for (let bx = x - 8; bx < x + 134; bx += 12) {
    g.fillRect(bx, baseY - hgt + 26, 4, 4);
    g.fillRect(bx, baseY - hgt + 48, 4, 4);
  }
  g.fillStyle = "#ece6d8";
  for (let lx = x + 4; lx < x + 120; lx += 12) g.fillRect(lx, baseY - hgt + 36, 6, 6);
  // vertical blade sign
  g.fillStyle = "#a8455a";
  g.fillRect(x + 52, baseY - hgt - 40, 22, 44);
  g.fillStyle = "#e8c75a";
  for (let by = baseY - hgt - 34; by < baseY - hgt; by += 10) g.fillRect(x + 60, by, 6, 6);
  g.fillStyle = "#5a4a40";
  g.fillRect(x + 50, baseY - 34, 26, 34);
}

function drawSaltStraw(g, x, baseY) {
  // Salt & Straw ice-cream shop — a named WeHo storefront
  if (scenerySpriteReady) {
    blitScenery(g, "salt_straw", x, baseY - SCENERY_SPRITES.salt_straw[3]);
    return;
  }
  // fallback: a plain cream storefront with a dusty-rose (never red) awning
  const w = 150, hgt = 120;
  g.fillStyle = "#e6ddca";
  g.fillRect(x, baseY - hgt, w, hgt);
  g.fillStyle = "#d2c8b2";
  g.fillRect(x, baseY - hgt, 8, hgt);
  g.fillRect(x + w - 8, baseY - hgt, 8, hgt);
  for (let i = 0; i * 14 < w - 16; i++) {
    g.fillStyle = i % 2 ? "#ece6d8" : "#c0707a";
    g.fillRect(x + 8 + i * 14, baseY - hgt + 14, Math.min(14, w - 16 - i * 14), 14);
  }
  g.fillStyle = "#9c7a4c";
  g.fillRect(x + 8, baseY - hgt + 30, w - 16, 20); // sign band
  g.fillStyle = "#33363d";
  g.fillRect(x + 12, baseY - 56, w - 24, 56); // glass front
}

function drawStringLights(g, x1, x2, y, tileW) {
  // sagging catenary of warm bulbs strung between buildings
  for (let fx = x1; fx <= x2; fx += 8) {
    const t = (fx - x1) / (x2 - x1);
    const fy = Math.round(y + 22 * 4 * t * (1 - t) / 4) * 4;
    const dx = fx >= tileW ? fx - tileW : fx;
    g.fillStyle = "#5a5048";
    g.fillRect(dx, fy, 8, 2);
    if ((fx - x1) % 24 === 0) {
      g.fillStyle = "#f0d878";
      g.fillRect(dx + 2, fy + 2, 4, 4);
    }
  }
}

// far: Hollywood Hills — soft green slopes
const wehoFar = makeLayer(1920, GROUND_Y, (g, w, h) => {
  drawRidgeline(g, w, h, 130, "#9bb59a", 17);
  drawRidgeline(g, w, h, 78, "#86a578", 6);
  drawBannerPlane(g, 1180, 40);
});

// mid: chic boutiques and cafes, a marquee landmark, string lights, jacaranda
const wehoMid = makeLayer(1920, GROUND_Y, (g, w, h) => {
  const rng = mulberry32(59);
  const baseY = h - 20;
  g.fillStyle = "#7fa15e"; // parkway grass
  g.fillRect(0, baseY, w, 20);
  g.fillStyle = "#6f9050";
  for (let i = 0; i < 110; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, baseY + Math.floor(rng() * 5) * 4, 4, 4);
  }
  drawCafe(g, 80, baseY, rng);
  drawCafe(g, 380, baseY, rng);
  drawPDC(g, 720, baseY);
  drawSaltStraw(g, 980, baseY); // named storefront in the old cafe slot
  drawCafe(g, 1320, baseY, rng);
  drawCafe(g, 1640, baseY, rng);
  // jacarandas in purple bloom between the storefronts
  const jacVariants = ["jacaranda1", "jacaranda2", "jacaranda3"];
  for (let ji = 0; ji < 4; ji++) {
    const [jx, jh] = [[330, 96], [660, 110], [1280, 100], [1880, 104]][ji];
    if (scenerySpriteReady) {
      const name = jacVariants[ji % jacVariants.length];
      const sw = SCENERY_SPRITES[name][2] * (jh / SCENERY_SPRITES[name][3]);
      blitScenery(g, name, jx + 4 - sw / 2, baseY - jh, sw, jh);
      continue;
    }
    g.fillStyle = "#6b5942";
    g.fillRect(jx, baseY - jh, 8, jh);
    const cx = jx + 4, cy = baseY - jh;
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const rr = rng() * 30;
      g.fillStyle = rng() < 0.5 ? "#8d6fae" : "#a98cc4";
      g.fillRect(cx + Math.round(Math.cos(a) * rr / 4) * 4, cy + Math.round((Math.sin(a) * rr - 16) / 4) * 4, 6, 6);
    }
  }
  // string lights spanning a couple of storefront gaps
  drawStringLights(g, 230, 720, baseY - 150, w);
  drawStringLights(g, 1130, 1640, baseY - 150, w);
  // pedestrians scattered along the sidewalk between storefronts
  drawPedestrians(g, baseY, [
    ["ppl_couple", 250, false],
    ["ppl_matcha", 600, true],
    ["ppl_cyclist", 1160, false],
    ["ppl_dogwalker_w", 1520, false],
  ]);
});

// near: sidewalk with WeHo's rainbow crosswalk striping the street
const wehoNear = makeLayer(960, VIEW_H - GROUND_Y, (g, w, h) => {
  const rng = mulberry32(61);
  g.fillStyle = "#d6d2ca";
  g.fillRect(0, 0, w, 28);
  g.fillStyle = "#c7c3ba";
  for (let i = 0; i < 60; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 4 + Math.floor(rng() * 5) * 4, 4, 4);
  }
  g.fillStyle = "#aaa496";
  g.fillRect(0, 0, w, 3);
  for (let jx = 0; jx < w; jx += 160) g.fillRect(jx, 4, 3, 24);
  g.fillStyle = "#b4b1a8"; // curb
  g.fillRect(0, 28, w, 8);
  g.fillStyle = "#908d84";
  g.fillRect(0, 28, w, 2);
  g.fillStyle = "#54565c"; // asphalt
  g.fillRect(0, 36, w, h - 36);
  g.fillStyle = "#62646a";
  for (let i = 0; i < 50; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 40 + Math.floor(rng() * 9) * 4, 4, 4);
  }
  // rainbow crosswalk: muted bands so it reads as scenery, not a pickup
  const bands = ["#b06a6a", "#bd8f5e", "#c4b86a", "#6f9a6f", "#5f7fa8", "#7d6a9c"];
  const bw = 14;
  bands.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(300 + i * bw, 38, bw, h - 38);
  });
});

// ============ Beverly Hills zone (residential) ============

function drawTallPalm(g, x, baseY, hgt, rng) {
  if (scenerySpriteReady) {
    const r = SCENERY_SPRITES.tallpalm;
    const dw = r[2] * (hgt / r[3]); // scale the palm to the requested height
    blitScenery(g, "tallpalm", x + 3 - dw / 2, baseY - hgt, dw, hgt);
    return;
  }
  // Washingtonia: very tall skinny trunk, small frond crown — the iconic
  // Beverly Hills street palm
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    g.fillStyle = i % 2 ? "#9a7c62" : "#8a6e54";
    g.fillRect(x, baseY - (hgt / segs) * (i + 1), 6, Math.ceil(hgt / segs) + 4);
  }
  const cx = x + 2, cy = baseY - hgt;
  g.fillStyle = "#7a5c40"; // shaggy frond-boot collar under the crown
  g.fillRect(x - 2, cy + 6, 10, 14);
  const dirs = [[-1, -0.5], [-0.6, -0.9], [0, -1], [0.6, -0.9], [1, -0.5], [-0.9, 0], [0.9, 0]];
  for (let d = 0; d < dirs.length; d++) {
    g.fillStyle = d % 2 ? "#3f7a4e" : "#4f9059";
    for (let s = 1; s <= 4; s++) {
      g.fillRect(cx + Math.round(dirs[d][0] * s * 6 / 4) * 4, cy + Math.round((dirs[d][1] * s * 5 + s * s) / 4) * 4, 6, 4);
    }
  }
}

function drawSpanishHouse(g, x, baseY, rng) {
  if (scenerySpriteReady) {
    const v = ["house1", "house2", "house3"][Math.floor(rng() * 3)];
    blitScenery(g, v, x, baseY - SCENERY_SPRITES[v][3]);
    return;
  }
  // white/cream stucco, red clay tile roof, arched windows — the most "LA
  // residential" silhouette there is
  const walls = ["#efe6d6", "#ece2d0", "#f2ecdf"];
  const w = 150 + Math.floor(rng() * 3) * 20;
  const hgt = 88 + Math.floor(rng() * 2) * 16;
  g.fillStyle = walls[Math.floor(rng() * walls.length)];
  g.fillRect(x, baseY - hgt, w, hgt);
  g.fillStyle = "#dcd0bc"; // shadow side
  g.fillRect(x + w - 16, baseY - hgt, 16, hgt);
  // clay tile roof: sloped band + ridge, warm terracotta
  g.fillStyle = "#b9613e";
  g.fillRect(x - 8, baseY - hgt - 14, w + 16, 14);
  g.fillStyle = "#9c4f34";
  for (let rx = x - 8; rx < x + w + 8; rx += 10) g.fillRect(rx, baseY - hgt - 14, 4, 14); // tile ribs
  g.fillStyle = "#c9714a";
  g.fillRect(x - 8, baseY - hgt - 16, w + 16, 4); // ridge cap
  // arched windows: square body + a tile-colored arch cap
  g.fillStyle = "#8a9aa2";
  for (let wx = x + 16; wx + 18 < x + w - 16; wx += 40) {
    g.fillRect(wx, baseY - hgt + 30, 18, 24);
    g.fillStyle = "#9c4f34";
    g.fillRect(wx + 2, baseY - hgt + 26, 14, 4);
    g.fillStyle = "#8a9aa2";
  }
  // arched door
  g.fillStyle = "#6e5440";
  g.fillRect(x + Math.round(w / 2) - 10, baseY - 36, 20, 36);
  g.fillStyle = "#9c4f34";
  g.fillRect(x + Math.round(w / 2) - 8, baseY - 40, 16, 4);
}

function drawHedge(g, x, baseY, len) {
  if (scenerySpriteReady) {
    const dh = SCENERY_SPRITES.hedge[3];
    blitScenery(g, "hedge", x, baseY - dh, len, dh); // stretched to length
    return;
  }
  g.fillStyle = "#4f7a44";
  g.fillRect(x, baseY - 20, len, 20);
  g.fillStyle = "#5e8a50"; // rounded clipped top
  for (let hx = x; hx < x + len; hx += 8) g.fillRect(hx, baseY - 24, 6, 6);
}

function drawFountain(g, x, baseY) {
  if (scenerySpriteReady) {
    blitScenery(g, "fountain", x, baseY - SCENERY_SPRITES.fountain[3]);
    return;
  }
  // grand two-tier estate fountain, ~96x64 footprint (matches the scenery
  // sprite box). next neighbor is the shield berm at x+120, so it stays clear.
  const cx = x + 48;
  g.fillStyle = "#cdbfae"; // wide stone basin
  g.fillRect(x, baseY - 20, 96, 20);
  g.fillStyle = "#b6a892";
  g.fillRect(x, baseY - 20, 96, 4); // basin rim
  g.fillStyle = "#9ab6c4"; // lower water
  g.fillRect(x + 8, baseY - 14, 80, 8);
  g.fillStyle = "#cdbfae"; // pedestal
  g.fillRect(cx - 6, baseY - 44, 12, 26);
  g.fillRect(cx - 22, baseY - 50, 44, 8); // upper bowl
  g.fillStyle = "#b6a892";
  g.fillRect(cx - 22, baseY - 50, 44, 3);
  g.fillStyle = "#9ab6c4"; // upper water
  g.fillRect(cx - 16, baseY - 47, 32, 3);
  g.fillStyle = "#b6c8d2"; // spout + falling arcs
  g.fillRect(cx - 2, baseY - 64, 4, 14);
  g.fillRect(cx - 10, baseY - 58, 4, 8);
  g.fillRect(cx + 6, baseY - 58, 4, 8);
}

function drawShieldSign(g, x, baseY) {
  if (scenerySpriteReady) {
    blitScenery(g, "shield", x, baseY - SCENERY_SPRITES.shield[3]);
    return;
  }
  // Beverly Hills shield on a low lawn berm — the landmark
  g.fillStyle = "#5e8a50";
  g.fillRect(x - 10, baseY - 14, 96, 14); // lawn berm
  g.fillStyle = "#6e5440"; // posts
  g.fillRect(x + 8, baseY - 50, 6, 38);
  g.fillRect(x + 62, baseY - 50, 6, 38);
  // shield: cream rounded plaque
  const sx = x + 6, sy = baseY - 88, sw = 64;
  g.fillStyle = "#ece2cc";
  g.fillRect(sx + 4, sy, sw - 8, 38);
  g.fillRect(sx, sy + 6, sw, 26);
  g.fillStyle = "#3f5a3f"; // green point at the bottom
  g.fillRect(sx + 12, sy + 38, sw - 24, 8);
  g.fillRect(sx + 24, sy + 46, sw - 48, 4);
  g.fillStyle = "#7a6a4c"; // "BEVERLY HILLS" suggested as text bars
  g.fillRect(sx + 12, sy + 10, sw - 24, 4);
  g.fillRect(sx + 16, sy + 18, sw - 32, 3);
  g.fillRect(sx + 20, sy + 24, sw - 40, 3);
}

// far: gentle estate hills with the downtown skyline rising between the
// ridgelines (rehomed from the old Hollywood zone); the front ridge nestles
// the skyline's base into the slope
const beverlyFar = makeLayer(1920, GROUND_Y, (g, w, h) => {
  drawRidgeline(g, w, h, 108, "#a8c0a0", 23);
  drawSkyline(g, 1300, h);
  drawRidgeline(g, w, h, 60, "#93b184", 9);
  drawBannerPlane(g, 520, 56); // clear of the skyline at 1300
});

// mid: Spanish Colonial homes, hedges, a fountain, the shield, tall palms
const beverlyMid = makeLayer(1920, GROUND_Y, (g, w, h) => {
  const rng = mulberry32(71);
  const baseY = h - 20;
  g.fillStyle = "#83a85f"; // manicured lawn
  g.fillRect(0, baseY, w, 20);
  g.fillStyle = "#74974f";
  for (let i = 0; i < 90; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, baseY + Math.floor(rng() * 5) * 4, 4, 4);
  }
  drawSpanishHouse(g, 120, baseY, rng);
  drawHedge(g, 320, baseY, 90);
  drawSpanishHouse(g, 470, baseY, rng);
  drawFountain(g, 700, baseY);
  drawShieldSign(g, 820, baseY);
  drawSpanishHouse(g, 980, baseY, rng);
  drawHedge(g, 1200, baseY, 110);
  drawSpanishHouse(g, 1360, baseY, rng);
  drawSpanishHouse(g, 1660, baseY, rng);
  // rows of tall skinny Washingtonia palms
  for (const [px, ph] of [[60, 230], [430, 250], [660, 210], [950, 240], [1320, 230], [1620, 250], [1860, 220]]) {
    drawTallPalm(g, px, baseY, ph, rng);
  }
  // utility poles + sagging lines, rehomed from the old Hollywood street.
  // 640 spacing divides the 1920 tile so the seam-crossing wire span lines up.
  const poles = [160, 800, 1440];
  for (const px of poles) drawPowerPole(g, px, baseY);
  for (let i = 0; i < poles.length; i++) {
    const x1 = poles[i];
    const x2 = i + 1 < poles.length ? poles[i + 1] : poles[0] + w;
    drawSaggingWire(g, x1 + 4, x2 + 4, baseY - 164, 16, w);
    drawSaggingWire(g, x1 + 4, x2 + 4, baseY - 144, 12, w);
  }
  // residents out on the sidewalk
  drawPedestrians(g, baseY, [
    ["ppl_dogwalker_b", 300, false],
    ["ppl_phone", 640, true],
    ["ppl_yoga", 1080, false],
    ["ppl_childbike", 1520, false],
  ]);
});

// near: wide pale sidewalk + grass parkway, no Walk-of-Fame stars
const beverlyNear = makeLayer(640, VIEW_H - GROUND_Y, (g, w, h) => {
  const rng = mulberry32(73);
  g.fillStyle = "#dcd8cf"; // light, clean concrete
  g.fillRect(0, 0, w, 24);
  g.fillStyle = "#cecabf";
  for (let i = 0; i < 40; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 4 + Math.floor(rng() * 4) * 4, 4, 4);
  }
  g.fillStyle = "#b0ac9e";
  g.fillRect(0, 0, w, 3);
  for (let jx = 0; jx < w; jx += 160) g.fillRect(jx, 4, 3, 20);
  g.fillStyle = "#83a85f"; // grass parkway strip below the walk
  g.fillRect(0, 24, w, 10);
  g.fillStyle = "#74974f";
  for (let i = 0; i < 26; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 26 + Math.floor(rng() * 2) * 4, 4, 4);
  }
  g.fillStyle = "#b4b1a8"; // curb
  g.fillRect(0, 34, w, 6);
  g.fillStyle = "#908d84";
  g.fillRect(0, 34, w, 2);
  g.fillStyle = "#5a5c62"; // asphalt
  g.fillRect(0, 40, w, h - 40);
  g.fillStyle = "#666870";
  for (let i = 0; i < 50; i++) {
    g.fillRect(Math.floor((rng() * w) / 4) * 4, 44 + Math.floor(rng() * 8) * 4, 4, 4);
  }
  g.fillStyle = "#9a8f55"; // faded lane line
  for (let lx = 24; lx < w; lx += 160) g.fillRect(lx, h - 10, 56, 4);
});

// ---- Zone registry: per-zone parallax tile sets ----
const ZONES = {
  weho: { far: wehoFar, mid: wehoMid, near: wehoNear },
  beverly: { far: beverlyFar, mid: beverlyMid, near: beverlyNear },
  beach: { far: beachFar, mid: beachMid, near: beachNear },
};
const ZONE_ORDER = ["weho", "beverly", "beach"]; // westward loop

const arthurSprite = new Image();
let arthurSpriteReady = false;
arthurSprite.onload = () => {
  arthurSpriteReady = true;
};
arthurSprite.src = "assets/sprites/arthur.png";

const obstacleSprite = new Image();
let obstacleSpriteReady = false;
obstacleSprite.onload = () => {
  obstacleSpriteReady = true;
};
obstacleSprite.src = "assets/sprites/obstacles.png";

const treatSprite = new Image();
let treatSpriteReady = false;
treatSprite.onload = () => {
  treatSpriteReady = true;
};
treatSprite.src = "assets/sprites/treats.png";

// Source rects in obstacles.png, packed left-to-right by import_gemini_props.py.
// sw/sh equal each collision box, so obstacles draw 1:1. Keep in sync with that
// script's printout. treats.png is four 32px cells, indexed by TREAT_SPRITE_COL.
const OBSTACLE_SPRITES = {
  escooter: { sx: 0, sw: 54, sh: 50 },
  servebot: { sx: 54, sw: 48, sh: 48 },
  cone: { sx: 102, sw: 38, sh: 44 },
  palmfrond: { sx: 140, sw: 96, sh: 42 },
  awning: { sx: 236, sw: 110, sh: 38 },
};
const TREAT_SPRITE_PX = 32;
const TREAT_SPRITE_COL = { green_ball: 0, fish: 1, taco: 2, chicken_bone: 3 };

// ---------------- Game state ----------------
// OUTRO = the brief run-off after a hit: Arthur keeps running and sprints off
// the right edge before the game-over overlay appears.
const STATE = { MENU: "menu", PLAYING: "playing", OUTRO: "outro", PAUSED: "paused", GAME_OVER: "gameover" };
let state = STATE.MENU;

// Arthur's hitbox is tracked by its bottom edge (rests on GROUND_Y when
// grounded) so that ducking shrinks the box downward, not into the floor.
const arthur = { bottom: GROUND_Y, vy: 0, grounded: true, ducking: false };
let obstacles = [];               // { x, y, w, h, type }
let treats = [];                  // { x, y, tier } — x,y is the treat's center
let scrollPx = 0;
let speed = BASE_SCROLL_SPEED;
let gapRemaining = 0;             // scroll px until the next obstacle spawn
let treatGapRemaining = 0;        // scroll px until the next treat spawn
let pendingType = "escooter";     // next type, chosen ahead so the gap can account for it
let treatCount = 0;               // pickups this run (= distract ammo in Phase 2)
let treatScore = 0;               // points from pickups this run
let causeMsg = "";                // game-over flavor text
let newBest = false;
let jumpBuffer = 0;               // frames left to honor a buffered jump press
let outroX = 0;                   // Arthur's rightward offset during the run-off outro

let highScore = loadHighScore();

function loadHighScore() {
  try {
    return Number(localStorage.getItem(HIGHSCORE_KEY)) || 0;
  } catch {
    return 0; // storage unavailable (e.g. sandboxed preview) — play without persistence
  }
}

function saveHighScore(score) {
  try {
    localStorage.setItem(HIGHSCORE_KEY, String(score));
  } catch {
    /* see loadHighScore */
  }
}

function meters() {
  return Math.floor(scrollPx / PX_PER_METER);
}

function finalScore() {
  return meters() + treatScore;
}

function arthurHeight() {
  return arthur.ducking ? ARTHUR_H_DUCK : ARTHUR_H_STAND;
}

function resetRun() {
  arthur.bottom = GROUND_Y;
  arthur.vy = 0;
  arthur.grounded = true;
  arthur.ducking = false;
  obstacles = [];
  treats = [];
  scrollPx = DEBUG_START_M * PX_PER_METER;
  speed = BASE_SCROLL_SPEED;
  pendingType = pickObstacleType();
  gapRemaining = spawnGap(pendingType, pendingType);
  treatGapRemaining = treatGap();
  treatCount = 0;
  treatScore = 0;
  causeMsg = "";
  newBest = false;
  jumpBuffer = 0;
  outroX = 0;
}

function treatGap() {
  return TREAT_GAP_MIN_PX + Math.random() * (TREAT_GAP_MAX_PX - TREAT_GAP_MIN_PX);
}

function pickTreatTier() {
  const tiers = Object.keys(TREAT_TIERS);
  let roll = Math.random() * tiers.reduce((sum, t) => sum + TREAT_TIERS[t].weight, 0);
  for (const tier of tiers) {
    roll -= TREAT_TIERS[tier].weight;
    if (roll < 0) return tier;
  }
  return tiers[0];
}

function pickObstacleType() {
  const m = meters();
  const unlocked = Object.keys(OBSTACLE_TYPES).filter(
    (t) => DEBUG_ALL_OBSTACLES || m >= OBSTACLE_TYPES[t].unlockM
  );
  return unlocked[Math.floor(Math.random() * unlocked.length)];
}

// Minimum scroll distance between an obstacle and the next one (see the
// fair-spawning constants above).
function spawnGap(prevType, nextType) {
  let frames = REACTION_FRAMES + JUMP_AIRTIME_FRAMES;
  if (OBSTACLE_TYPES[prevType].overhead !== OBSTACLE_TYPES[nextType].overhead) {
    frames += VERB_SWITCH_FRAMES;
  }
  frames += Math.random() * EXTRA_GAP_FRAMES;
  frames += EARLY_GAP_FRAMES * Math.max(0, 1 - meters() / EARLY_GAP_EASE_M);
  return frames * speed + OBSTACLE_TYPES[prevType].w;
}

// ---------------- Input ----------------
const JUMP_KEYS = ["Space", "ArrowUp", "KeyW"];
const DUCK_KEYS = ["ArrowDown", "KeyS"];
let duckHeld = false;
let duckTimer = 0; // frames a duck stays active even after release (min-duck)

function pressDuck() {
  duckHeld = true;
  duckTimer = MIN_DUCK_FRAMES; // guarantee a visible duck even for a quick tap
}

function releaseDuck() {
  duckHeld = false;
}

function jump() {
  if (arthur.grounded) {
    arthur.vy = JUMP_VELOCITY;
    arthur.grounded = false;
  } else {
    jumpBuffer = JUMP_BUFFER_FRAMES; // remember a slightly-early press
  }
}

function startRun() {
  resetRun();
  state = STATE.PLAYING;
}

function resumeRun() {
  state = STATE.PLAYING;
  lastTime = performance.now();
  accumulator = 0;
}

window.addEventListener("keydown", (e) => {
  if (JUMP_KEYS.includes(e.code) || DUCK_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (state === STATE.MENU || state === STATE.GAME_OVER) {
    if (JUMP_KEYS.includes(e.code)) startRun();
  } else if (state === STATE.PAUSED) {
    resumeRun();
  } else if (state === STATE.PLAYING) {
    if (JUMP_KEYS.includes(e.code)) jump();
    if (DUCK_KEYS.includes(e.code)) pressDuck();
  }
});

window.addEventListener("keyup", (e) => {
  if (DUCK_KEYS.includes(e.code)) releaseDuck();
});

// Touch control zones (spec §5): tap the upper TOUCH_JUMP_FRACTION of the
// canvas to jump, the lower part to duck (hold to keep ducking). Zone is read
// from the canvas rect so it tracks the letterboxed canvas, not raw screen
// pixels; a touch above/below the canvas clamps into the nearest zone.
function touchIsJumpZone(touch) {
  const rect = canvas.getBoundingClientRect();
  const fracY = (touch.clientY - rect.top) / rect.height;
  return fracY < TOUCH_JUMP_FRACTION;
}

let duckTouchId = null; // identifier of the touch currently holding duck, if any

window.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    if (portraitMQ.matches) return; // ignore taps under the rotate overlay
    // Outside PLAYING, any tap just advances the state (zone-agnostic).
    if (state === STATE.MENU || state === STATE.GAME_OVER) return startRun();
    if (state === STATE.PAUSED) return resumeRun();
    if (state !== STATE.PLAYING) return;
    for (const touch of e.changedTouches) {
      if (touchIsJumpZone(touch)) {
        jump();
      } else {
        pressDuck();
        duckTouchId = touch.identifier; // most recent duck touch owns the hold
      }
    }
  },
  { passive: false }
);

function endTouch(e) {
  for (const touch of e.changedTouches) {
    if (touch.identifier === duckTouchId) {
      releaseDuck();
      duckTouchId = null;
    }
  }
}
window.addEventListener("touchend", endTouch);
window.addEventListener("touchcancel", endTouch);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === STATE.PLAYING) state = STATE.PAUSED;
});

// ---------------- Update (one fixed 1/60s step) ----------------
function update() {
  scrollPx += speed;
  const ramps = Math.floor(meters() / RAMP_INTERVAL_M);
  speed = Math.min(BASE_SCROLL_SPEED + ramps * SPEED_RAMP, MAX_SCROLL_SPEED);

  // Arthur physics: duck only applies on the ground (fast-fall is later polish).
  // duckTimer keeps a quick tap ducking for MIN_DUCK_FRAMES (spec §5).
  arthur.ducking = (duckHeld || duckTimer > 0) && arthur.grounded;
  if (duckTimer > 0) duckTimer -= 1;
  arthur.vy += GRAVITY;
  arthur.bottom += arthur.vy;
  if (arthur.bottom >= GROUND_Y) {
    arthur.bottom = GROUND_Y;
    arthur.vy = 0;
    arthur.grounded = true;
  }
  if (jumpBuffer > 0) {
    jumpBuffer -= 1;
    if (arthur.grounded) {
      jumpBuffer = 0;
      jump(); // buffered press fires the moment Arthur lands
    }
  }

  // scroll obstacles, drop the ones that left the screen
  for (const ob of obstacles) ob.x -= speed;
  obstacles = obstacles.filter((ob) => ob.x + ob.w > 0);

  // spawn the chosen obstacle once the gap has scrolled past, then pick the
  // next type ahead of time so its gap can account for a verb switch
  gapRemaining -= speed;
  if (gapRemaining <= 0 && !DEBUG_TOUR) {
    const def = OBSTACLE_TYPES[pendingType];
    const y = def.overhead ? GROUND_Y - OVERHEAD_CLEARANCE - def.h : GROUND_Y - def.h;
    obstacles.push({ x: VIEW_W + 20, y, w: def.w, h: def.h, type: pendingType });
    const justSpawned = pendingType;
    pendingType = pickObstacleType();
    gapRemaining = spawnGap(justSpawned, pendingType);
  }

  // treats: scroll, spawn on their own cadence, collect on touch
  for (const t of treats) t.x -= speed;
  treats = treats.filter((t) => t.x + TREAT_SIZE > 0);

  treatGapRemaining -= speed;
  if (treatGapRemaining <= 0 && !DEBUG_TOUR) {
    const x = VIEW_W + 20;
    const y = Math.random() < TREAT_JUMP_CHANCE ? TREAT_JUMP_Y : TREAT_RUN_Y;
    // don't bury a treat inside an obstacle; retry a moment later instead
    const blocked = obstacles.some(
      (ob) => x + TREAT_SIZE / 2 > ob.x - 40 && x - TREAT_SIZE / 2 < ob.x + ob.w + 40
    );
    if (blocked) {
      treatGapRemaining = 90;
    } else {
      treats.push({ x, y, tier: pickTreatTier() });
      treatGapRemaining = treatGap();
    }
  }

  treats = treats.filter((t) => {
    if (touchesArthur(t)) {
      treatCount += 1;
      treatScore += TREAT_TIERS[t.tier].score;
      return false;
    }
    return true;
  });

  if (!DEBUG_TOUR) {
    const hit = obstacles.find((ob) => collides(ob));
    if (hit) endRun(OBSTACLE_TYPES[hit.type].msg);
  }
}

// Pickup overlap uses Arthur's full box (no inset): collecting is generous
// even though colliding is forgiving.
function touchesArthur(t) {
  const ay = arthur.bottom - arthurHeight();
  return (
    ARTHUR_X < t.x + TREAT_SIZE / 2 &&
    ARTHUR_X + ARTHUR_W > t.x - TREAT_SIZE / 2 &&
    ay < t.y + TREAT_SIZE / 2 &&
    arthur.bottom > t.y - TREAT_SIZE / 2
  );
}

function collides(ob) {
  const ax = ARTHUR_X + HITBOX_INSET;
  const aw = ARTHUR_W - 2 * HITBOX_INSET;
  const ay = arthur.bottom - arthurHeight() + HITBOX_INSET;
  const ah = arthurHeight() - HITBOX_INSET;
  return ax < ob.x + ob.w && ax + aw > ob.x && ay < ob.y + ob.h && ay + ah > ob.y;
}

function endRun(msg) {
  // The run is over: the score is locked here (the world stops scrolling), but
  // instead of freezing on a scared pose, Arthur bolts off-screen first. The
  // game-over overlay waits for the OUTRO to finish.
  causeMsg = msg;
  state = STATE.OUTRO;
  outroX = 0;
  arthur.ducking = false; // stand up to run off, even if hit mid-duck
  const score = finalScore();
  if (score > highScore) {
    highScore = score;
    newBest = true;
    saveHighScore(score);
  }
}

// Run-off outro: the world is frozen (no scroll, spawns, or scoring), so we only
// carry Arthur forward and let any mid-air hit settle to the ground as he goes.
function updateOutro() {
  outroX += OUTRO_RUN_SPEED;
  arthur.vy += GRAVITY;
  arthur.bottom += arthur.vy;
  if (arthur.bottom >= GROUND_Y) {
    arthur.bottom = GROUND_Y;
    arthur.vy = 0;
    arthur.grounded = true;
  }
  if (ARTHUR_X + outroX > VIEW_W + SPRITE_FRAME) state = STATE.GAME_OVER;
}

// ---------------- Render layer ----------------
// All drawing goes through the named functions below. They draw placeholder
// shapes for now; the sprite swap (64x64 sheet: run x4, jump, duck, bolt)
// only needs to touch drawArthur/drawObstacle.

// Which zone we're in, plus the crossfade amount (0 = solid current zone,
// rising to 1 at the boundary). Layers are blended per depth so stacking
// order stays correct mid-fade.
function zoneBlend() {
  const len = ZONE_LEN_M * PX_PER_METER;
  const idx = Math.floor(scrollPx / len);
  const cur = ZONES[ZONE_ORDER[idx % ZONE_ORDER.length]];
  const next = ZONES[ZONE_ORDER[(idx + 1) % ZONE_ORDER.length]];
  const intoFade = (scrollPx % len) - (len - ZONE_FADE_PX);
  const fade = Math.max(0, Math.min(1, intoFade / ZONE_FADE_PX));
  return { cur, next, fade };
}

function drawLayerPair(curLayer, nextLayer, fade, factor, y) {
  if (fade < 1) drawScrollingLayer(curLayer, factor, y);
  if (fade > 0) {
    ctx.globalAlpha = fade;
    drawScrollingLayer(nextLayer, factor, y);
    ctx.globalAlpha = 1;
  }
}

function drawBackground() {
  ctx.drawImage(skyLayer, 0, 0);
  const { cur, next, fade } = zoneBlend();
  drawLayerPair(cur.far, next.far, fade, PARALLAX_FAR, 0);
  drawLayerPair(cur.mid, next.mid, fade, PARALLAX_MID, 0);
  drawLayerPair(cur.near, next.near, fade, PARALLAX_NEAR, GROUND_Y);
}

function drawScrollingLayer(layer, factor, y) {
  const off = (scrollPx * factor) % layer.width;
  for (let x = -off; x < VIEW_W; x += layer.width) {
    ctx.drawImage(layer, Math.round(x), y);
  }
}

function drawArthur() {
  if (state === STATE.GAME_OVER) return; // Arthur has bolted off-screen
  // During the outro Arthur slides right (outroX) while still running; his legs
  // cycle off the distance he's covered, matching the normal run model.
  const ax = ARTHUR_X + (state === STATE.OUTRO ? outroX : 0);
  if (arthurSpriteReady) {
    let frame;
    if (state === STATE.OUTRO) frame = Math.floor(outroX / RUN_ANIM_SCROLL_PX) % 4;
    else if (!arthur.grounded) frame = SPRITE_JUMP;
    else if (arthur.ducking) frame = SPRITE_DUCK;
    else frame = Math.floor(scrollPx / RUN_ANIM_SCROLL_PX) % 4;
    ctx.drawImage(
      arthurSprite,
      frame * SPRITE_FRAME, 0, SPRITE_FRAME, SPRITE_FRAME,
      ax, arthur.bottom - SPRITE_FOOT_Y, SPRITE_FRAME, SPRITE_FRAME
    );
    return;
  }
  // fallback placeholder if the sheet is absent: gray body, head, ear, legs
  const h = arthurHeight();
  const top = arthur.bottom - h;
  ctx.fillStyle = "#7a7782";
  ctx.fillRect(ax, top + h * 0.25, ARTHUR_W * 0.78, h * 0.5);
  ctx.fillStyle = "#b1aeb6";
  ctx.fillRect(ax + ARTHUR_W * 0.55, top, ARTHUR_W * 0.45, h * 0.45);
  ctx.fillStyle = "#4a4852";
  ctx.fillRect(ax + ARTHUR_W * 0.55, top, ARTHUR_W * 0.12, h * 0.3);
  ctx.fillStyle = "#e8e2d4";
  ctx.fillRect(ax + ARTHUR_W * 0.08, arthur.bottom - h * 0.25, ARTHUR_W * 0.14, h * 0.25);
  ctx.fillRect(ax + ARTHUR_W * 0.56, arthur.bottom - h * 0.25, ARTHUR_W * 0.14, h * 0.25);
}

function drawObstacle(ob) {
  if (obstacleSpriteReady) {
    const s = OBSTACLE_SPRITES[ob.type];
    ctx.drawImage(obstacleSprite, s.sx, 0, s.sw, s.sh, ob.x, ob.y, ob.w, ob.h);
    return;
  }
  // fallback shapes if obstacles.png is absent — one distinct look per type
  switch (ob.type) {
    case "escooter":
      ctx.fillStyle = "#96cd32";
      ctx.fillRect(ob.x, ob.y + ob.h * 0.5, ob.w, ob.h * 0.18); // deck
      ctx.fillStyle = "#26242b";
      ctx.fillRect(ob.x + ob.w * 0.78, ob.y, ob.w * 0.12, ob.h); // stem
      ctx.fillRect(ob.x + ob.w * 0.58, ob.y, ob.w * 0.34, ob.h * 0.12); // handlebar
      break;
    case "servebot":
      ctx.fillStyle = "#eef0ee";
      ctx.fillRect(ob.x, ob.y, ob.w, ob.h * 0.82);
      ctx.fillStyle = "#26242b";
      ctx.fillRect(ob.x + ob.w * 0.1, ob.y + ob.h * 0.32, ob.w * 0.5, ob.h * 0.34); // face panel
      break;
    case "cone":
      ctx.fillStyle = "#f07c2a";
      ctx.beginPath();
      ctx.moveTo(ob.x + ob.w / 2, ob.y);
      ctx.lineTo(ob.x + ob.w, ob.y + ob.h);
      ctx.lineTo(ob.x, ob.y + ob.h);
      ctx.closePath();
      ctx.fill();
      break;
    case "palmfrond":
      ctx.fillStyle = "#4a7a3a";
      ctx.fillRect(ob.x, ob.y, ob.w, ob.h * 0.55);
      ctx.fillStyle = "#3a6230";
      ctx.fillRect(ob.x, ob.y + ob.h * 0.45, ob.w, ob.h * 0.2);
      break;
    case "awning":
      for (let i = 0; i < ob.w / 14; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#d0483a" : "#ece6d8";
        ctx.fillRect(ob.x + i * 14, ob.y, Math.min(14, ob.w - i * 14), ob.h);
      }
      break;
  }
}

function drawTreat(t) {
  if (treatSpriteReady) {
    const col = TREAT_SPRITE_COL[t.tier];
    const px = TREAT_SPRITE_PX;
    ctx.drawImage(treatSprite, col * px, 0, px, px, t.x - px / 2, t.y - px / 2, px, px);
    return;
  }
  // fallback shapes if treats.png is absent
  const r = TREAT_SIZE / 2;
  switch (t.tier) {
    case "green_ball":
      ctx.fillStyle = "#c3d94e";
      ctx.beginPath();
      ctx.arc(t.x, t.y, r - 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "fish":
      ctx.fillStyle = "#7da7c4";
      ctx.beginPath();
      ctx.ellipse(t.x - 2, t.y, r - 4, r - 9, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "taco":
      ctx.fillStyle = "#e0b45c";
      ctx.beginPath();
      ctx.arc(t.x, t.y + 2, r - 4, Math.PI, 0); // shell
      ctx.fill();
      ctx.fillStyle = "#7ab050"; // fillings
      ctx.fillRect(t.x - r + 5, t.y - 4, TREAT_SIZE - 10, 4);
      break;
    case "chicken_bone":
      ctx.fillStyle = "#8a5236";
      ctx.beginPath();
      ctx.arc(t.x - 2, t.y + 2, r - 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f0ead8"; // bone
      ctx.fillRect(t.x + 2, t.y - r + 3, 4, 8);
      break;
  }
}

function drawHUD() {
  ctx.fillStyle = "#2c3c4e";
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${meters()} m`, 20, 36);
  ctx.font = "16px monospace";
  ctx.fillText(`treats ${treatCount}`, 20, 60);
  ctx.fillText(`best ${highScore}`, 20, 82);
}

function drawCenteredText(lines, startY) {
  ctx.textAlign = "center";
  for (const [text, font, color, dy] of lines) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, VIEW_W / 2, startY + dy);
  }
}

function drawMenu() {
  const controls = IS_TOUCH
    ? "tap upper screen to jump — lower to duck"
    : "Space / ↑ / W to jump — ↓ / S to duck";
  drawCenteredText(
    [
      ["Arthur's Big Walk", "bold 56px monospace", "#2c3c4e", 0],
      [controls, "20px monospace", "#2c3c4e", 50],
      [`best ${highScore}`, "18px monospace", "#5a6a7a", 84],
      [IS_TOUCH ? "tap to start" : "press Space to start", "bold 24px monospace", "#2c3c4e", 140],
    ],
    180
  );
}

function drawGameOver() {
  ctx.fillStyle = "rgba(28, 37, 48, 0.55)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawCenteredText(
    [
      [`Arthur ${causeMsg}!`, "bold 40px monospace", "#ffffff", 0],
      [`score ${finalScore()}`, "bold 32px monospace", "#ffffff", 48],
      [`${meters()} m + ${treatScore} treat pts`, "18px monospace", "#d0d8e0", 78],
      [newBest ? "NEW BEST!" : `best ${highScore}`, "bold 22px monospace", newBest ? "#ffd75e" : "#d0d8e0", 114],
      [IS_TOUCH ? "tap to restart" : "press Space to restart", "20px monospace", "#d0d8e0", 154],
    ],
    200
  );
}

function drawPaused() {
  ctx.fillStyle = "rgba(28, 37, 48, 0.55)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawCenteredText([[IS_TOUCH ? "paused — tap to resume" : "paused — press any key", "bold 28px monospace", "#ffffff", 0]], 270);
}

function render() {
  drawBackground();
  for (const ob of obstacles) drawObstacle(ob);
  for (const t of treats) drawTreat(t);
  drawArthur();
  if (state === STATE.MENU) drawMenu();
  else drawHUD();
  if (state === STATE.GAME_OVER) drawGameOver();
  if (state === STATE.PAUSED) drawPaused();
}

// ---------------- Main loop (fixed timestep with accumulator) ----------------
const STEP_MS = 1000 / 60;
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(now - lastTime, 100); // clamp long frames (tab switches, hitches)
  lastTime = now;
  if (state === STATE.PLAYING || state === STATE.OUTRO) {
    accumulator += dt;
    while (accumulator >= STEP_MS) {
      if (state === STATE.PLAYING) update();
      else if (state === STATE.OUTRO) updateOutro();
      else break; // outro just finished -> stop stepping until restart
      accumulator -= STEP_MS;
    }
  }
  render();
}
requestAnimationFrame(frame);
