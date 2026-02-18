/* ============================================================
   8-Ball Pool — game.js
   ============================================================ */

/* ============================================================
   SECTION 1: Constants & Configuration
   ============================================================ */

// ── Table geometry (logical units) ──────────────────────────
const TABLE_W         = 1000;   // interior felt width
const TABLE_H         = 500;    // interior felt height
const RAIL_W          = 50;     // rail/border thickness on each side
const CANVAS_W        = 1200;   // backing canvas width  (TABLE_W + 2*RAIL_W + extra)
const CANVAS_H        = 680;    // backing canvas height (TABLE_H + 2*RAIL_W + extra)

// Felt origin within the canvas (top-left corner of the felt surface)
const FELT_X          = (CANVAS_W - TABLE_W) / 2;   // 100
const FELT_Y          = (CANVAS_H - TABLE_H) / 2;   // 90

// ── Ball & pocket geometry ───────────────────────────────────
const BALL_RADIUS     = 12;     // units
const POCKET_RADIUS_CORNER = 22; // capture radius — corner pockets
const POCKET_RADIUS_SIDE   = 20; // capture radius — side pockets
const CORNER_INSET    = 8;      // pocket center offset from felt corner

// Six pocket centre positions in table-space coordinates
const POCKETS = [
  { x: CORNER_INSET,           y: CORNER_INSET,           r: POCKET_RADIUS_CORNER }, // top-left
  { x: TABLE_W / 2,            y: -2,                     r: POCKET_RADIUS_SIDE   }, // top-mid
  { x: TABLE_W - CORNER_INSET, y: CORNER_INSET,           r: POCKET_RADIUS_CORNER }, // top-right
  { x: CORNER_INSET,           y: TABLE_H - CORNER_INSET, r: POCKET_RADIUS_CORNER }, // bot-left
  { x: TABLE_W / 2,            y: TABLE_H + 2,            r: POCKET_RADIUS_SIDE   }, // bot-mid
  { x: TABLE_W - CORNER_INSET, y: TABLE_H - CORNER_INSET, r: POCKET_RADIUS_CORNER }, // bot-right
];

// ── Ball colours ─────────────────────────────────────────────
// Index 0 unused; index matches ball number
const BALL_COLORS = [
  null,           // 0  — placeholder
  '#FFC000',      // 1  Yellow
  '#003DA5',      // 2  Blue
  '#CE1126',      // 3  Red
  '#4B0082',      // 4  Purple
  '#FF6600',      // 5  Orange
  '#006B3F',      // 6  Green
  '#800000',      // 7  Maroon
  '#111111',      // 8  Black (8-ball)
  '#FFC000',      // 9  Yellow  stripe
  '#003DA5',      // 10 Blue    stripe
  '#CE1126',      // 11 Red     stripe
  '#4B0082',      // 12 Purple  stripe
  '#FF6600',      // 13 Orange  stripe
  '#006B3F',      // 14 Green   stripe
  '#800000',      // 15 Maroon  stripe
];

// Number text colours (white on dark balls, black on light)
const BALL_TEXT_COLORS = [
  null,
  '#000',   // 1
  '#fff',   // 2
  '#fff',   // 3
  '#fff',   // 4
  '#fff',   // 5
  '#fff',   // 6
  '#fff',   // 7
  '#fff',   // 8
  '#000',   // 9
  '#fff',   // 10
  '#fff',   // 11
  '#fff',   // 12
  '#fff',   // 13
  '#fff',   // 14
  '#fff',   // 15
];

// ── Standard rack positions ──────────────────────────────────
const FOOT_SPOT_X     = TABLE_W * 0.75;   // 750 — foot spot (apex of rack)
const FOOT_SPOT_Y     = TABLE_H / 2;      // 250
const HEAD_SPOT_X     = TABLE_W * 0.25;   // 250 — cue ball starting position
const HEAD_SPOT_Y     = TABLE_H / 2;      // 250

// Row offset for a standard diamond rack (equilateral triangle packing)
const ROW_SPACING_X   = BALL_RADIUS * 2 * Math.cos(Math.PI / 6); // ≈ 20.78
const ROW_SPACING_Y   = BALL_RADIUS * 2;                          // 24

// ── Physics tuning ───────────────────────────────────────────
const FIXED_DT        = 1 / 120;          // physics timestep (seconds, but used as step unit)
const MAX_STEPS_PER_FRAME = 8;            // spiral-of-death guard
const FRICTION        = 0.991;            // rolling friction multiplier per step
const REST_THRESHOLD  = 0.3;             // speed (units/step) below which a ball is "at rest"
const REST_FRAMES     = 5;               // consecutive rest steps before declaring settled
const RESTITUTION     = 0.96;            // ball-ball coefficient of restitution
const RAIL_RESTITUTION = 0.75;           // ball-rail coefficient of restitution
const RAIL_FRICTION   = 0.95;            // tangential speed multiplier on rail bounce
const MAX_SHOT_SPEED  = 28;              // units/step at 100% power

// Aiming guideline
const GUIDELINE_MAX_LEN = 600;           // max length of the dotted aiming line (units)
const DEFLECT_LINE_LEN  = 50;            // length of the post-impact deflection indicators

// ── Canvas / rendering ───────────────────────────────────────
const FELT_COLOR      = '#0a7e3d';
const CUSHION_COLOR   = '#085c2e';
const RAIL_COLOR      = '#4a2a0a';
const POCKET_COLOR    = '#000';
const POCKET_RING_COLOR = '#222';
const DIAMOND_COLOR   = 'rgba(255,255,230,0.7)';
const SHADOW_COLOR    = 'rgba(0,0,0,0.35)';
const HIGHLIGHT_COLOR = 'rgba(255,255,255,0.55)';

/* ============================================================
   SECTION 2: Game State Manager
   ============================================================ */

/**
 * Finite-state machine states.
 * Every input event and physics update must check `gs.state`
 * and only act when in the appropriate state(s).
 */
const STATES = Object.freeze({
  AWAITING_BREAK:          'AWAITING_BREAK',
  AIMING:                  'AIMING',
  POWER_DRAG:              'POWER_DRAG',
  SHOT_IN_PROGRESS:        'SHOT_IN_PROGRESS',
  BALL_IN_HAND_PLACEMENT:  'BALL_IN_HAND_PLACEMENT',
  EVALUATING_SHOT_RESULT:  'EVALUATING_SHOT_RESULT',
  GAME_OVER:               'GAME_OVER',
});

/**
 * `gs` — the single authoritative game state object.
 * All rule-engine reads/writes go through this object.
 * Reset by `initGame()` at the start of every new game.
 */
const gs = {
  // ── FSM ──────────────────────────────────────────────────
  state: STATES.AWAITING_BREAK,

  // ── Players ───────────────────────────────────────────────
  activePlayer: 1,             // 1 or 2
  breakingPlayer: 1,           // alternates each new game
  groupAssigned: false,        // true once solids/stripes are assigned

  // Group: null | 'solids' | 'stripes'
  // player1Group is always the complement of player2Group once assigned.
  player1Group: null,
  player2Group: null,

  // ── Pocketed ball tracking ────────────────────────────────
  // Arrays of ball IDs (1–15) that each player has legally pocketed.
  player1Pocketed: [],
  player2Pocketed: [],

  // Balls pocketed during the current shot (cleared at shot start).
  // Each entry: { id, timestamp } — timestamp used for first-pocketed ordering.
  pocketedThisShot: [],

  // ── Shot metadata (reset each shot) ──────────────────────
  firstContact: null,          // ball ID of the first object ball struck this shot
  railContactThisShot: false,  // did any ball contact a rail after cue-ball hit?
  cueBallContacted: false,     // did the cue ball strike any object ball this shot?
  cueBallPocketed: false,      // scratch flag for current shot

  // For the illegal-break check: how many distinct object balls hit a rail?
  railContactBallIds: new Set(),

  // ── 8-ball endgame flags ──────────────────────────────────
  // Set to true for a player once all 7 of their group balls are pocketed.
  player1On8Ball: false,
  player2On8Ball: false,

  // ── Aiming / input state ──────────────────────────────────
  aimAngle: 0,                 // radians; direction cue ball will be hit
  mouseTable: { x: 0, y: 0 }, // last known mouse position in table-space
  dragStartTable: null,        // table-space point where POWER_DRAG began
  power: 0,                    // 0.0 – 1.0

  // ── Cue-stick strike animation ────────────────────────────
  strikeAnimating: false,
  strikeAnimStartTime: 0,
  STRIKE_ANIM_MS: 80,          // milliseconds

  // ── Shot-settlement detection ─────────────────────────────
  restCounter: 0,              // consecutive physics steps where all balls are below REST_THRESHOLD

  // ── Game result ───────────────────────────────────────────
  winner: null,                // 1 | 2 | null
  winReason: '',               // human-readable string shown in game-over modal

  // ── Ball-in-hand ghost position ───────────────────────────
  bihPosition: { x: HEAD_SPOT_X, y: HEAD_SPOT_Y }, // follows mouse during BALL_IN_HAND_PLACEMENT
  bihValid: false,             // true when ghost doesn't overlap any ball
};

/** Balls currently in play. Each ball is an object (see createBall). */
let balls = [];

/** Reference to the cue ball object within `balls` (id === 0). */
let cueBall = null;

/* ============================================================
   SECTION 3: Physics Engine
   ============================================================ */

/**
 * Factory — create a ball object.
 * @param {number} id   Ball number 0 = cue, 1–15 = object balls.
 * @param {number} x    Initial x in table-space.
 * @param {number} y    Initial y in table-space.
 * @returns {object}
 */
function createBall(id, x, y) {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    pocketed: false,
    // Pocket animation state
    pocketAnim: null,       // null | { startTime, duration, pocket }
    // Track consecutive rest steps for this ball
    _restSteps: 0,
  };
}

/**
 * Apply rolling friction to a single ball for one physics step.
 * Snaps velocity to zero when below REST_THRESHOLD.
 * @param {object} ball
 */
function applyFriction(ball) {
  ball.vx *= FRICTION;
  ball.vy *= FRICTION;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < REST_THRESHOLD) {
    ball.vx = 0;
    ball.vy = 0;
  }
}

/**
 * Detect and resolve a ball-to-ball elastic collision between `a` and `b`.
 * Applies positional correction to prevent overlap.
 * Also tracks first-contact and rail-contact metadata on gs.
 * @param {object} a
 * @param {object} b
 */
function detectAndResolveBallBall(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = BALL_RADIUS * 2;

  if (dist >= minDist || dist === 0) return; // no collision

  // Collision normal (unit vector from a → b)
  const nx = dx / dist;
  const ny = dy / dist;

  // Relative velocity along the normal
  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const vRel = dvx * nx + dvy * ny;

  if (vRel <= 0) return; // balls already separating

  // ── First-contact tracking ────────────────────────────────
  if (a.id === 0 && gs.firstContact === null) {
    gs.firstContact = b.id;
    gs.cueBallContacted = true;
  } else if (b.id === 0 && gs.firstContact === null) {
    gs.firstContact = a.id;
    gs.cueBallContacted = true;
  }

  // ── Velocity resolution (elastic with restitution) ────────
  const j = vRel * RESTITUTION;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;

  // ── Positional correction (de-overlap) ────────────────────
  const overlap = minDist - dist;
  const corrX = nx * overlap * 0.5;
  const corrY = ny * overlap * 0.5;
  a.x -= corrX;
  a.y -= corrY;
  b.x += corrX;
  b.y += corrY;
}

/**
 * Cushion line segments (table-space). Defined so that each segment
 * terminates at the edge of the pocket mouth rather than continuing
 * across the pocket opening.  Orientation: the "inward normal" points
 * toward the interior of the table.
 *
 * Format: { x1, y1, x2, y2, nx, ny }  — nx/ny = inward normal.
 *
 * Built once and cached for performance.
 */
let CUSHION_SEGMENTS = null;

function buildCushionSegments() {
  // Pocket mouth half-width (how much of each rail edge the pocket "eats")
  const cCorner = CORNER_INSET + BALL_RADIUS;   // ≈ 20
  const cSide   = BALL_RADIUS * 2.2;             // ≈ 26

  // Corners of the felt in table-space: (0,0) → (TABLE_W, TABLE_H)
  // Top rail (y = 0, inward normal = (0,+1))
  // Bottom rail (y = TABLE_H, inward normal = (0,-1))
  // Left rail (x = 0, inward normal = (+1,0))
  // Right rail (x = TABLE_W, inward normal = (-1,0))

  CUSHION_SEGMENTS = [
    // Top rail — two segments (left of centre pocket, right of centre pocket)
    { x1: cCorner,             y1: 0, x2: TABLE_W / 2 - cSide, y2: 0, nx: 0,  ny:  1 },
    { x1: TABLE_W / 2 + cSide, y1: 0, x2: TABLE_W - cCorner,   y2: 0, nx: 0,  ny:  1 },
    // Bottom rail
    { x1: cCorner,             y1: TABLE_H, x2: TABLE_W / 2 - cSide, y2: TABLE_H, nx: 0,  ny: -1 },
    { x1: TABLE_W / 2 + cSide, y1: TABLE_H, x2: TABLE_W - cCorner,   y2: TABLE_H, nx: 0,  ny: -1 },
    // Left rail
    { x1: 0, y1: cCorner, x2: 0, y2: TABLE_H - cCorner, nx:  1, ny: 0 },
    // Right rail
    { x1: TABLE_W, y1: cCorner, x2: TABLE_W, y2: TABLE_H - cCorner, nx: -1, ny: 0 },
  ];
}

/**
 * Detect and resolve a ball against all cushion segments.
 * Reflects the perpendicular velocity component and applies
 * tangential friction.  Performs positional clamping.
 * @param {object} ball
 */
function detectAndResolveBallRail(ball) {
  if (!CUSHION_SEGMENTS) buildCushionSegments();

  for (const seg of CUSHION_SEGMENTS) {
    // Determine penetration depth along the segment's inward normal.
    // The boundary the ball must stay outside is the rail edge; the ball
    // centre must stay ≥ BALL_RADIUS from it.

    let depth = 0;   // positive = overlapping the boundary

    if (seg.ny !== 0) {
      // Horizontal rail
      if (seg.ny > 0) {
        // Top rail (y=0): ball must have y ≥ BALL_RADIUS
        depth = BALL_RADIUS - ball.y;
      } else {
        // Bottom rail (y=TABLE_H): ball must have y ≤ TABLE_H - BALL_RADIUS
        depth = ball.y - (TABLE_H - BALL_RADIUS);
      }
    } else {
      // Vertical rail
      if (seg.nx > 0) {
        // Left rail (x=0): ball must have x ≥ BALL_RADIUS
        depth = BALL_RADIUS - ball.x;
      } else {
        // Right rail (x=TABLE_W): ball must have x ≤ TABLE_W - BALL_RADIUS
        depth = ball.x - (TABLE_W - BALL_RADIUS);
      }
    }

    if (depth <= 0) continue; // not touching this rail

    // Check the ball is within the lateral extent of this segment
    // (i.e., not in a pocket gap)
    const inRange = isPointInSegmentRange(ball, seg);
    if (!inRange) continue;

    // ── Rail-contact tracking ─────────────────────────────────
    if (gs.cueBallContacted) {
      gs.railContactThisShot = true;
      gs.railContactBallIds.add(ball.id);
    } else if (ball.id !== 0) {
      // During break, track object balls that touch a rail
      gs.railContactBallIds.add(ball.id);
    }

    // ── Positional correction ─────────────────────────────────
    ball.x += seg.nx * depth;
    ball.y += seg.ny * depth;

    // ── Velocity reflection ───────────────────────────────────
    const vNorm = ball.vx * seg.nx + ball.vy * seg.ny; // component along normal
    if (vNorm < 0) {
      // Ball is moving into the rail — reflect
      ball.vx -= (1 + RAIL_RESTITUTION) * vNorm * seg.nx;
      ball.vy -= (1 + RAIL_RESTITUTION) * vNorm * seg.ny;
      // Apply tangential friction
      ball.vx *= RAIL_FRICTION;
      ball.vy *= RAIL_FRICTION;
    }
  }
}

/**
 * Returns true if the ball's position falls within the lateral range
 * of the given cushion segment (used to exclude pocket gaps).
 * @param {object} ball
 * @param {object} seg  Cushion segment descriptor.
 * @returns {boolean}
 */
function isPointInSegmentRange(ball, seg) {
  if (seg.ny !== 0) {
    // Horizontal rail — check x range
    const minX = Math.min(seg.x1, seg.x2);
    const maxX = Math.max(seg.x1, seg.x2);
    return ball.x >= minX && ball.x <= maxX;
  } else {
    // Vertical rail — check y range
    const minY = Math.min(seg.y1, seg.y2);
    const maxY = Math.max(seg.y1, seg.y2);
    return ball.y >= minY && ball.y <= maxY;
  }
}

/**
 * Check whether `ball` has entered any pocket's capture radius.
 * If so, flags the ball as pocketed, records it in gs.pocketedThisShot,
 * and starts the pocket-animation.
 * @param {object} ball
 */
function checkPocket(ball) {
  if (ball.pocketed) return;

  for (const pocket of POCKETS) {
    const dx = ball.x - pocket.x;
    const dy = ball.y - pocket.y;
    if (dx * dx + dy * dy <= pocket.r * pocket.r) {
      ball.pocketed = true;
      ball.vx = 0;
      ball.vy = 0;

      if (ball.id === 0) {
        // Cue ball scratch
        gs.cueBallPocketed = true;
      } else {
        gs.pocketedThisShot.push({ id: ball.id, timestamp: performance.now() });
      }

      // Start shrink/fade animation
      ball.pocketAnim = {
        startTime: performance.now(),
        duration: 150,
        pocket,
      };
      break;
    }
  }
}

/**
 * Returns true when every non-pocketed ball (including the cue ball,
 * if it hasn't scratched) has speed below REST_THRESHOLD.
 * Uses a consecutive-steps counter (gs.restCounter) to debounce.
 * @returns {boolean}
 */
function checkAllAtRest() {
  const active = balls.filter(b => !b.pocketed);
  const allSlow = active.every(b => Math.hypot(b.vx, b.vy) < REST_THRESHOLD);
  if (allSlow) {
    gs.restCounter++;
  } else {
    gs.restCounter = 0;
  }
  return gs.restCounter >= REST_FRAMES;
}

/**
 * Advance the physics simulation by one fixed timestep `dt`.
 * Order of operations:
 *   1. Move all balls (integrate velocity).
 *   2. Resolve ball-ball collisions (multiple passes for stability).
 *   3. Resolve ball-rail collisions.
 *   4. Check pocket captures.
 *   5. Apply friction.
 */
function stepPhysics() {
  const activeBalls = balls.filter(b => !b.pocketed);

  // 1. Integrate positions
  for (const ball of activeBalls) {
    ball.x += ball.vx;
    ball.y += ball.vy;
  }

  // 2. Ball-ball collisions (2 passes to improve stability with many balls)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < activeBalls.length; i++) {
      for (let j = i + 1; j < activeBalls.length; j++) {
        detectAndResolveBallBall(activeBalls[i], activeBalls[j]);
      }
    }
  }

  // 3. Ball-rail collisions
  for (const ball of activeBalls) {
    detectAndResolveBallRail(ball);
  }

  // 4. Pocket checks
  for (const ball of activeBalls) {
    checkPocket(ball);
  }

  // 5. Friction
  for (const ball of activeBalls) {
    if (!ball.pocketed) applyFriction(ball);
  }
}

/**
 * Reset per-shot metadata on gs at the start of each new shot.
 */
function resetShotMetadata() {
  gs.firstContact        = null;
  gs.railContactThisShot = false;
  gs.cueBallContacted    = false;
  gs.cueBallPocketed     = false;
  gs.pocketedThisShot    = [];
  gs.railContactBallIds  = new Set();
  gs.restCounter         = 0;
}

/* ============================================================
   SECTION 4: Rendering
   ============================================================ */

// ── Canvas & context references (assigned in initGame) ───────
let canvas = null;
let ctx    = null;

/**
 * Map a table-space point to canvas-space for rendering.
 * Table origin (0,0) maps to canvas (FELT_X, FELT_Y).
 * @param {number} tx  Table x
 * @param {number} ty  Table y
 * @returns {{ cx: number, cy: number }}
 */
function tableToCanvas(tx, ty) {
  return { cx: FELT_X + tx, cy: FELT_Y + ty };
}

// ── drawTable ────────────────────────────────────────────────
/**
 * Draw the full table: outer wood rail, cushion strip, felt surface,
 * pocket openings, diamond sights, foot spot, and optional head string.
 */
function drawTable() {
  const c = ctx;

  // Outer wood border (fills the entire canvas)
  c.fillStyle = RAIL_COLOR;
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Bevel highlight along top edge of rails
  c.strokeStyle = 'rgba(255,220,150,0.18)';
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, CANVAS_W - 1, CANVAS_H - 1);

  // Cushion strip (slightly darker green, drawn around felt perimeter)
  const cushionW = FELT_X;       // same as rail width
  const cushionH = FELT_Y;
  c.fillStyle = CUSHION_COLOR;
  c.fillRect(
    FELT_X - 12, FELT_Y - 12,
    TABLE_W + 24, TABLE_H + 24
  );

  // Felt surface
  c.fillStyle = FELT_COLOR;
  c.fillRect(FELT_X, FELT_Y, TABLE_W, TABLE_H);

  // ── Pocket openings ─────────────────────────────────────────
  for (const p of POCKETS) {
    const { cx, cy } = tableToCanvas(p.x, p.y);
    // Outer "leather ring" (dark gray)
    c.beginPath();
    c.arc(cx, cy, p.r + 4, 0, Math.PI * 2);
    c.fillStyle = POCKET_RING_COLOR;
    c.fill();
    // Black hole
    c.beginPath();
    c.arc(cx, cy, p.r, 0, Math.PI * 2);
    c.fillStyle = POCKET_COLOR;
    c.fill();
  }

  // ── Diamond sights ──────────────────────────────────────────
  // Long rails: 7 diamonds each; short rails: 3 diamonds each.
  const dR = 3.5; // diamond radius
  c.fillStyle = DIAMOND_COLOR;

  // Top & bottom rails (7 diamonds spread across TABLE_W)
  for (let i = 1; i <= 7; i++) {
    const tx = (TABLE_W / 8) * i;
    // Skip positions that overlap pocket mouths
    [FELT_Y - 10, FELT_Y + TABLE_H + 10].forEach(cy => {
      c.beginPath();
      c.arc(FELT_X + tx, cy, dR, 0, Math.PI * 2);
      c.fill();
    });
  }
  // Left & right rails (3 diamonds)
  for (let i = 1; i <= 3; i++) {
    const ty = (TABLE_H / 4) * i;
    [FELT_X - 10, FELT_X + TABLE_W + 10].forEach(cx => {
      c.beginPath();
      c.arc(cx, FELT_Y + ty, dR, 0, Math.PI * 2);
      c.fill();
    });
  }

  // ── Foot spot ───────────────────────────────────────────────
  const fs = tableToCanvas(FOOT_SPOT_X, FOOT_SPOT_Y);
  c.beginPath();
  c.arc(fs.cx, fs.cy, 3, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.fill();

  // ── Head string (faint dotted line) ─────────────────────────
  c.save();
  c.setLineDash([6, 6]);
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(FELT_X + HEAD_SPOT_X, FELT_Y);
  c.lineTo(FELT_X + HEAD_SPOT_X, FELT_Y + TABLE_H);
  c.stroke();
  c.setLineDash([]);
  c.restore();
}

// ── drawBalls ────────────────────────────────────────────────
/**
 * Draw all balls currently in play, including pocket-shrink animation
 * for balls that were just pocketed.
 */
function drawBalls() {
  const now = performance.now();

  for (const ball of balls) {
    if (ball.pocketed && !ball.pocketAnim) continue; // fully gone

    const { cx, cy } = tableToCanvas(ball.x, ball.y);

    // Compute scale/alpha for pocket animation
    let scale = 1;
    let alpha = 1;
    if (ball.pocketAnim) {
      const elapsed = now - ball.pocketAnim.startTime;
      const t = Math.min(elapsed / ball.pocketAnim.duration, 1);
      scale = 1 - t;
      alpha = 1 - t;
      if (t >= 1) {
        ball.pocketAnim = null;
        continue;
      }
    }

    const r = BALL_RADIUS * scale;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy + 3, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = SHADOW_COLOR;
    ctx.fill();

    if (ball.id === 0) {
      // ── Cue ball ────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f8f8f0';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else if (ball.id === 8) {
      // ── 8-ball ───────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = BALL_COLORS[8];
      ctx.fill();
      // White circle background for number
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      // Number
      ctx.font = `bold ${Math.round(r * 0.75)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111';
      ctx.fillText('8', cx, cy + 0.5);
    } else if (ball.id <= 7) {
      // ── Solid ball ───────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = BALL_COLORS[ball.id];
      ctx.fill();
      // White circle for number
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fill();
      ctx.font = `bold ${Math.round(r * 0.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = BALL_TEXT_COLORS[ball.id];
      ctx.fillText(String(ball.id), cx, cy + 0.5);
    } else {
      // ── Stripe ball ──────────────────────────────────────────
      // White base
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f8f8f0';
      ctx.fill();
      // Colour stripe (horizontal band across middle third)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = BALL_COLORS[ball.id];
      ctx.fillRect(cx - r, cy - r * 0.38, r * 2, r * 0.76);
      ctx.restore();
      // White circle for number
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.font = `bold ${Math.round(r * 0.68)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = BALL_TEXT_COLORS[ball.id];
      ctx.fillText(String(ball.id), cx, cy + 0.5);
    }

    // Outline
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Specular highlight (upper-left)
    const hlX = cx - r * 0.3;
    const hlY = cy - r * 0.3;
    const hlGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, r * 0.45);
    hlGrad.addColorStop(0, HIGHLIGHT_COLOR);
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = hlGrad;
    ctx.fill();

    ctx.restore();
  }
}

// ── drawCueStick ─────────────────────────────────────────────
/**
 * Draw the cue stick, aimed along gs.aimAngle from the cue ball centre.
 * During POWER_DRAG, the stick is pulled back by gs.power.
 * During the strike animation, it thrusts forward and then disappears.
 *
 * Only rendered in AIMING and POWER_DRAG states (and during strikeAnim).
 */
function drawCueStick() {
  if (!cueBall || cueBall.pocketed) return;

  const state = gs.state;
  const shouldDraw =
    state === STATES.AIMING ||
    state === STATES.POWER_DRAG ||
    state === STATES.AWAITING_BREAK ||
    gs.strikeAnimating;

  if (!shouldDraw) return;

  const { cx: ballCX, cy: ballCY } = tableToCanvas(cueBall.x, cueBall.y);

  // Direction vector pointing FROM cue ball TOWARD mouse (shot direction)
  const dirX = Math.cos(gs.aimAngle);
  const dirY = Math.sin(gs.aimAngle);

  // Stick tip stands behind the cue ball (opposite to shot direction)
  const STICK_LEN     = 220;   // total stick length in canvas units
  const STICK_TIP_GAP = 4;     // min gap between tip and ball surface (px at 1:1 canvas)

  let pullback = 0;
  if (state === STATES.POWER_DRAG) {
    pullback = gs.power * 36;
  }
  if (gs.strikeAnimating) {
    const elapsed = performance.now() - gs.strikeAnimStartTime;
    const t = Math.min(elapsed / gs.STRIKE_ANIM_MS, 1);
    // Thrust forward then hide
    pullback = gs.power * 36 * (1 - t);
    if (t >= 1) {
      gs.strikeAnimating = false;
      return;
    }
  }

  // Tip of the stick (near the cue ball)
  const tipDist = BALL_RADIUS + STICK_TIP_GAP + pullback;
  const tipX = ballCX - dirX * tipDist;
  const tipY = ballCY - dirY * tipDist;
  // Butt of the stick (far end)
  const buttX = tipX - dirX * STICK_LEN;
  const buttY = tipY - dirY * STICK_LEN;

  const grad = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  grad.addColorStop(0,   '#e8d5a3');  // light tip
  grad.addColorStop(0.1, '#c8a96e');  // shaft
  grad.addColorStop(0.7, '#8b5e2a');  // darkening wood
  grad.addColorStop(1,   '#5a3010');  // dark butt

  ctx.save();
  ctx.lineCap = 'round';
  // Taper: draw thick line (butt) tapering to thin (tip)
  // Approximate taper with two overlapping strokes of different widths
  ctx.beginPath();
  ctx.moveTo(buttX, buttY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 9;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX - dirX * STICK_LEN * 0.15, tipY - dirY * STICK_LEN * 0.15);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#e8d5a3';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

// ── drawAimingLine ───────────────────────────────────────────
/**
 * Draw the dotted aiming guideline from the cue ball in the shot direction.
 * Terminates at the first object ball it would contact (showing a ghost ball
 * and deflection arrows) or at a cushion (showing a reflected continuation).
 * Max length: GUIDELINE_MAX_LEN.
 */
function drawAimingLine() {
  if (!cueBall || cueBall.pocketed) return;
  const state = gs.state;
  if (state !== STATES.AIMING && state !== STATES.POWER_DRAG && state !== STATES.AWAITING_BREAK) return;

  const ox = cueBall.x;
  const oy = cueBall.y;
  const dirX = Math.cos(gs.aimAngle);
  const dirY = Math.sin(gs.aimAngle);

  // ── Find first collision along the ray ─────────────────────
  // Check against each object ball (excluding cue ball itself)
  let hitBall = null;
  let hitDist = GUIDELINE_MAX_LEN;
  let ghostX  = 0, ghostY = 0;

  for (const ball of balls) {
    if (ball.pocketed || ball.id === 0) continue;
    // Vector from ray origin to ball centre
    const fx = ball.x - ox;
    const fy = ball.y - oy;
    const tca = fx * dirX + fy * dirY; // projection onto ray
    if (tca < 0) continue;             // ball is behind the cue ball
    const d2 = fx * fx + fy * fy - tca * tca; // squared perpendicular distance
    const minD2 = (BALL_RADIUS * 2) * (BALL_RADIUS * 2);
    if (d2 > minD2) continue;          // ray misses the ball
    const thc = Math.sqrt(minD2 - d2);
    const dist = tca - thc;            // distance to contact point (cue-ball centre)
    if (dist > 0 && dist < hitDist) {
      hitDist = dist;
      hitBall = ball;
      ghostX = ox + dirX * dist;
      ghostY = oy + dirY * dist;
    }
  }

  // ── Check rail hit (simple AABB for the guideline ray) ─────
  let railHitDist = GUIDELINE_MAX_LEN;
  if (hitBall === null) {
    // Intersect ray with the four felt boundaries at BALL_RADIUS inset
    const bounds = [
      { t: (BALL_RADIUS - oy) / dirY, axis: 'y' },
      { t: (TABLE_H - BALL_RADIUS - oy) / dirY, axis: 'y' },
      { t: (BALL_RADIUS - ox) / dirX, axis: 'x' },
      { t: (TABLE_W - BALL_RADIUS - ox) / dirX, axis: 'x' },
    ];
    for (const b of bounds) {
      if (isFinite(b.t) && b.t > 0 && b.t < railHitDist) {
        railHitDist = b.t;
      }
    }
  }

  const lineEndDist = hitBall ? hitDist : Math.min(railHitDist, GUIDELINE_MAX_LEN);
  const endX = ox + dirX * lineEndDist;
  const endY = oy + dirY * lineEndDist;

  const { cx: startCX, cy: startCY } = tableToCanvas(ox, oy);
  const { cx: endCX,   cy: endCY   } = tableToCanvas(endX, endY);

  // Draw dotted white line
  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startCX, startCY);
  ctx.lineTo(endCX, endCY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (hitBall) {
    // Ghost ball at contact point
    drawGhostBall(ghostX, ghostY);

    // Deflection of target ball (along collision normal)
    const cnx = (hitBall.x - ghostX) / (BALL_RADIUS * 2);  // approx unit normal
    const cny = (hitBall.y - ghostY) / (BALL_RADIUS * 2);
    const { cx: gbCX, cy: gbCY } = tableToCanvas(ghostX, ghostY);
    const { cx: tbCX, cy: tbCY } = tableToCanvas(hitBall.x, hitBall.y);

    // Target ball deflection (solid line from target ball in normal direction)
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,200,50,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tbCX, tbCY);
    ctx.lineTo(tbCX + cnx * DEFLECT_LINE_LEN, tbCY + cny * DEFLECT_LINE_LEN);
    ctx.stroke();

    // Cue ball deflection (tangent direction — perpendicular to normal)
    const tangX = -cny;
    const tangY =  cnx;
    // Choose the tangent side that makes sense given incoming direction
    const side = (dirX * tangX + dirY * tangY) > 0 ? 1 : -1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(150,220,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gbCX, gbCY);
    ctx.lineTo(gbCX + side * tangX * DEFLECT_LINE_LEN, gbCY + side * tangY * DEFLECT_LINE_LEN);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ── drawGhostBall ────────────────────────────────────────────
/**
 * Draw a semi-transparent ghost cue ball at table-space (tx, ty).
 * Used by drawAimingLine to show the predicted contact point.
 * @param {number} tx
 * @param {number} ty
 */
function drawGhostBall(tx, ty) {
  const { cx, cy } = tableToCanvas(tx, ty);
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// ── drawBallInHandGhost ──────────────────────────────────────
/**
 * Draw the ball-in-hand placement ghost that follows the cursor
 * during BALL_IN_HAND_PLACEMENT state.
 * The ghost is green-tinted if the position is valid, red if invalid.
 */
function drawBallInHandGhost() {
  if (gs.state !== STATES.BALL_IN_HAND_PLACEMENT) return;

  const { cx, cy } = tableToCanvas(gs.bihPosition.x, gs.bihPosition.y);
  const color = gs.bihValid ? 'rgba(100,255,150,0.55)' : 'rgba(255,80,80,0.55)';

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = gs.bihValid ? 'rgba(100,255,150,0.9)' : 'rgba(255,80,80,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ── render ───────────────────────────────────────────────────
/**
 * Master render function — called once per animation frame.
 * Clears the canvas then calls each draw sub-function in layer order.
 */
function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawTable();
  drawBalls();

  // Aiming UI is shown when the player is ready to shoot
  if (
    gs.state === STATES.AIMING ||
    gs.state === STATES.POWER_DRAG ||
    gs.state === STATES.AWAITING_BREAK
  ) {
    drawAimingLine();
    drawCueStick();
  } else if (gs.strikeAnimating) {
    drawCueStick();
  }

  drawBallInHandGhost();
}

/* ============================================================
   SECTION 5: Input Handler
   ============================================================ */

/**
 * Convert a CSS-pixel mouse event position to table-space coordinates.
 * Accounts for canvas CSS scaling vs. its backing resolution.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ x: number, y: number }}  table-space coordinates
 */
function screenToTable(clientX, clientY) {
  const rect   = canvas.getBoundingClientRect();
  // Scale factors: backing resolution / displayed size
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  // Canvas-space position
  const canvasX = (clientX - rect.left) * scaleX;
  const canvasY = (clientY - rect.top)  * scaleY;
  // Subtract felt origin to get table-space
  return {
    x: canvasX - FELT_X,
    y: canvasY - FELT_Y,
  };
}

/**
 * Clamp a table-space coordinate so it stays within the playing surface,
 * keeping a ball-radius margin from every edge.
 * @param {{ x: number, y: number }} pt
 * @returns {{ x: number, y: number }}
 */
function clampToTable(pt) {
  return {
    x: Math.max(BALL_RADIUS, Math.min(TABLE_W - BALL_RADIUS, pt.x)),
    y: Math.max(BALL_RADIUS, Math.min(TABLE_H - BALL_RADIUS, pt.y)),
  };
}

/**
 * Check whether a proposed cue-ball position overlaps any other ball.
 * Used by ball-in-hand validation.
 * @param {{ x: number, y: number }} pos
 * @returns {boolean}  true = valid (no overlap)
 */
function isValidBihPosition(pos) {
  for (const ball of balls) {
    if (ball.pocketed || ball.id === 0) continue;
    const dx = pos.x - ball.x;
    const dy = pos.y - ball.y;
    if (dx * dx + dy * dy < (BALL_RADIUS * 2) * (BALL_RADIUS * 2)) return false;
  }
  return true;
}

// ── mousemove ────────────────────────────────────────────────
function onMouseMove(e) {
  const pt = screenToTable(e.clientX, e.clientY);
  gs.mouseTable = pt;

  // Always update aim angle from cue ball to mouse
  if (cueBall && !cueBall.pocketed) {
    gs.aimAngle = Math.atan2(pt.y - cueBall.y, pt.x - cueBall.x);
  }

  // POWER_DRAG: compute drag distance and map to power
  if (gs.state === STATES.POWER_DRAG && gs.dragStartTable) {
    // Drag direction is opposite to the shot direction (player pulls back)
    const backX = -Math.cos(gs.aimAngle);
    const backY = -Math.sin(gs.aimAngle);
    const dx = pt.x - gs.dragStartTable.x;
    const dy = pt.y - gs.dragStartTable.y;
    // Project drag vector onto the pull-back direction
    const projected = dx * backX + dy * backY;
    const MAX_DRAG = 120; // table units for 100% power
    gs.power = Math.max(0, Math.min(1, projected / MAX_DRAG));
    updatePowerMeter(gs.power);
  }

  // BALL_IN_HAND_PLACEMENT: update ghost position and validity
  if (gs.state === STATES.BALL_IN_HAND_PLACEMENT) {
    const clamped = clampToTable(pt);
    gs.bihPosition = clamped;
    gs.bihValid = isValidBihPosition(clamped);
  }
}

// ── mousedown ────────────────────────────────────────────────
function onMouseDown(e) {
  if (e.button !== 0) return; // left button only

  const pt = screenToTable(e.clientX, e.clientY);

  if (gs.state === STATES.AIMING || gs.state === STATES.AWAITING_BREAK) {
    // Begin power drag — the click starts anywhere (no need to click on cue ball)
    gs.dragStartTable = { ...pt };
    gs.power = 0;
    updatePowerMeter(0);
    gs.state = STATES.POWER_DRAG;
  }

  if (gs.state === STATES.BALL_IN_HAND_PLACEMENT) {
    // Attempt to place the cue ball
    const clamped = clampToTable(pt);
    if (isValidBihPosition(clamped)) {
      placeCueBall(clamped.x, clamped.y);
    } else {
      // Flash the ghost red (CSS class via brief timeout — handled in UI Manager)
      flashBihInvalid();
    }
  }
}

// ── mouseup ──────────────────────────────────────────────────
function onMouseUp(e) {
  if (e.button !== 0) return;

  if (gs.state === STATES.POWER_DRAG) {
    if (gs.power < 0.01) {
      // No meaningful drag — cancel and return to aiming
      gs.state = gs.state === STATES.AWAITING_BREAK ? STATES.AWAITING_BREAK : STATES.AIMING;
      // Determine which aiming state to revert to
      gs.state = (gs.breakingPlayer === gs.activePlayer &&
                  gs.player1Pocketed.length === 0 &&
                  gs.player2Pocketed.length === 0 &&
                  !gs.groupAssigned)
        ? STATES.AWAITING_BREAK : STATES.AIMING;
      gs.power = 0;
      gs.dragStartTable = null;
      updatePowerMeter(0);
      return;
    }

    // Execute the shot
    executeShot();
  }
}

/**
 * Restore/reattach all canvas input listeners.
 * Called once from initGame.
 */
function attachInputListeners() {
  canvas.addEventListener('mousemove',  onMouseMove);
  canvas.addEventListener('mousedown',  onMouseDown);
  canvas.addEventListener('mouseup',    onMouseUp);
  // Also catch mouseup outside the canvas so drag is never stuck
  window.addEventListener('mouseup',    onMouseUp);
}

/**
 * Apply velocity to the cue ball and transition to SHOT_IN_PROGRESS.
 * Called from onMouseUp after a valid power drag.
 */
function executeShot() {
  if (!cueBall || cueBall.pocketed) return;

  // Tag break shots so the rule engine can apply break-specific rules
  if (gs.state === STATES.POWER_DRAG) {
    // Preserve the break flag: if we were in AWAITING_BREAK before the drag
    // began, _wasBreakShot was set; otherwise keep existing value.
    // (Flag was already set by initGame / doIllegalBreak for the first shot.)
  }

  resetShotMetadata();

  const speed = gs.power * MAX_SHOT_SPEED;
  cueBall.vx = Math.cos(gs.aimAngle) * speed;
  cueBall.vy = Math.sin(gs.aimAngle) * speed;

  // Start strike animation (cue stick thrust)
  gs.strikeAnimating    = true;
  gs.strikeAnimStartTime = performance.now();

  gs.state    = STATES.SHOT_IN_PROGRESS;
  gs.power    = 0;
  gs.dragStartTable = null;
  updatePowerMeter(0);
}

/**
 * Place the cue ball at (x, y) in table-space after ball-in-hand.
 * Transitions to AIMING state.
 * @param {number} x
 * @param {number} y
 */
function placeCueBall(x, y) {
  if (!cueBall) {
    cueBall = createBall(0, x, y);
    balls.push(cueBall);
  } else {
    cueBall.x = x;
    cueBall.y = y;
    cueBall.vx = 0;
    cueBall.vy = 0;
    cueBall.pocketed = false;
    cueBall.pocketAnim = null;
  }
  gs.state = STATES.AIMING;
  gs.bihValid = false;
}

/**
 * Briefly signal that the ball-in-hand placement was invalid.
 * (Visual flash is handled by drawBallInHandGhost via gs.bihValid already
 * being false; this hook can be extended to add a CSS shake animation.)
 */
function flashBihInvalid() {
  // The ghost is already rendered red when bihValid === false.
  // No additional action needed at this scaffold stage.
}

/** Recalculate screen→table mapping when the window is resized. */
function onWindowResize() {
  // The canvas CSS size changes automatically via CSS (width: 100%, aspect-ratio).
  // The screenToTable function reads getBoundingClientRect() at call time,
  // so no cached values need to be updated here.
  // Re-render immediately to avoid a stale frame.
  render();
}

/* ============================================================
   SECTION 6: Rule Engine
   ============================================================ */

// ── Helper: group membership ─────────────────────────────────

/** Returns 'solids' if ball id is 1–7, 'stripes' if 9–15. */
function ballGroup(id) {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null; // 8-ball has no group
}

/** Returns the group assigned to the given player number (1 or 2). */
function playerGroup(player) {
  return player === 1 ? gs.player1Group : gs.player2Group;
}

/** Returns the opponent player number. */
function opponent(player) {
  return player === 1 ? 2 : 1;
}

/** Returns the pocketed-ball array for a player. */
function playerPocketed(player) {
  return player === 1 ? gs.player1Pocketed : gs.player2Pocketed;
}

/**
 * Check whether a player has cleared all 7 balls of their assigned group.
 * Returns false if groups are not yet assigned.
 * @param {number} player
 * @returns {boolean}
 */
function playerGroupCleared(player) {
  const grp = playerGroup(player);
  if (!grp) return false;
  const myIds = grp === 'solids'
    ? [1, 2, 3, 4, 5, 6, 7]
    : [9, 10, 11, 12, 13, 14, 15];
  return myIds.every(id => playerPocketed(player).includes(id));
}

/**
 * Re-spot the 8-ball on the foot spot (or nearest free position).
 * Used when the 8-ball is pocketed on the break.
 */
function respotEightBall() {
  const eightBall = balls.find(b => b.id === 8);
  if (!eightBall) return;

  // Try foot spot first; if occupied, search nearby positions
  const candidates = [
    { x: FOOT_SPOT_X,          y: FOOT_SPOT_Y },
    { x: FOOT_SPOT_X,          y: FOOT_SPOT_Y - BALL_RADIUS * 3 },
    { x: FOOT_SPOT_X,          y: FOOT_SPOT_Y + BALL_RADIUS * 3 },
    { x: FOOT_SPOT_X - BALL_RADIUS * 3, y: FOOT_SPOT_Y },
    { x: FOOT_SPOT_X + BALL_RADIUS * 3, y: FOOT_SPOT_Y },
  ];

  for (const pos of candidates) {
    const free = balls.every(b => {
      if (b.id === 8 || b.pocketed) return true;
      const dx = b.x - pos.x;
      const dy = b.y - pos.y;
      return dx * dx + dy * dy >= (BALL_RADIUS * 2) * (BALL_RADIUS * 2);
    });
    if (free) {
      eightBall.x = pos.x;
      eightBall.y = pos.y;
      eightBall.vx = 0;
      eightBall.vy = 0;
      eightBall.pocketed = false;
      eightBall.pocketAnim = null;
      return;
    }
  }

  // Fallback: place at head spot if all candidates are blocked
  eightBall.x = HEAD_SPOT_X;
  eightBall.y = HEAD_SPOT_Y;
  eightBall.pocketed = false;
  eightBall.pocketAnim = null;
}

/**
 * Perform a complete re-rack and re-break for an illegal break.
 * Resets ball positions and hands the break back to the same player.
 */
function doIllegalBreak() {
  showFoulBanner('Illegal break — fewer than 4 balls reached a cushion. Re-rack!');
  // Re-rack is handled by re-running initGame without changing breakingPlayer.
  // We defer so the banner is visible first.
  setTimeout(() => {
    setupRack();
    placeCueBallBreak();
    gs.state         = STATES.AWAITING_BREAK;
    gs._wasBreakShot = true;   // re-arm so next shot is evaluated as a break
    resetShotMetadata();
    updateHUD();
  }, 2100);
}

// ── Core rule evaluation ─────────────────────────────────────

/**
 * Called once all balls have come to rest after a shot.
 * Applies all 8-ball rules and transitions to the next game state.
 *
 * Decision tree (in priority order):
 *   1. Immediate-loss fouls (8-ball pocketed early; scratch on 8-ball pocket).
 *   2. Illegal break (break shot, fewer than 4 rails, nothing pocketed).
 *   3. 8-ball pocketed on break (re-spot; continue or pass turn).
 *   4. Scratch / other fouls (ball-in-hand for opponent).
 *   5. Group assignment (first pocket after break).
 *   6. 8-ball legally pocketed by player in endgame → win.
 *   7. Turn continuation or pass.
 */
function evaluateShotResult() {
  gs.state = STATES.EVALUATING_SHOT_RESULT;

  const isBreakShot = (gs.state === STATES.EVALUATING_SHOT_RESULT) &&
    !gs.groupAssigned &&
    gs.player1Pocketed.length === 0 &&
    gs.player2Pocketed.length === 0 &&
    gs.pocketedThisShot.every(p => true); // placeholder; actual break flag below

  // We use a separate flag set before the shot to detect the break properly.
  const wasBreak = gs._wasBreakShot;
  gs._wasBreakShot = false;

  const active = gs.activePlayer;
  const opp    = opponent(active);

  const pocketed  = gs.pocketedThisShot;           // [{ id, timestamp }, ...]
  const ballIds   = pocketed.map(p => p.id);
  const eight     = ballIds.includes(8);
  const scratch   = gs.cueBallPocketed;

  // ── 1. Immediate-loss: scratch while pocketing 8-ball ────────
  if (eight && scratch) {
    endGame(opp, `Player ${active} scratched on the 8-ball!`);
    return;
  }

  // ── 2. Immediate-loss: 8-ball pocketed before group cleared ──
  if (eight && !scratch && gs.groupAssigned) {
    const activeOn8 = active === 1 ? gs.player1On8Ball : gs.player2On8Ball;
    if (!activeOn8) {
      endGame(opp, `Player ${active} pocketed the 8-ball early!`);
      return;
    }
    // Legitimate 8-ball win (handled below at step 6)
  }

  // ── 3. Illegal break ──────────────────────────────────────────
  if (wasBreak) {
    const railCount = gs.railContactBallIds.size;
    const somethingPocketed = pocketed.some(p => p.id !== 8) || (eight);
    if (railCount < 4 && !somethingPocketed) {
      doIllegalBreak();
      return;
    }

    // 8-ball pocketed on break → re-spot, same player continues (no scratch)
    if (eight && !scratch) {
      respotEightBall();
      showFoulBanner('8-ball pocketed on break — re-spotted!');
      // Assign groups if other balls were pocketed
      handleGroupAssignment(active, pocketed.filter(p => p.id !== 8));
      // Turn continues if other balls were pocketed, else pass
      const ownPocketed = ownGroupBalls(active, pocketed.filter(p => p.id !== 8));
      const nextPlayer = ownPocketed.length > 0 ? active : opp;
      transitionToNextTurn(nextPlayer, scratch);
      return;
    }

    // Scratch on break → ball-in-hand for opponent (no group assignment even if balls pocketed)
    if (scratch) {
      handleGroupAssignment(active, pocketed);
      showFoulBanner('Scratch on break — ball in hand for opponent!');
      transitionToNextTurn(opp, true);
      return;
    }
  }

  // ── 4. Foul checks (non-break shots) ─────────────────────────
  let foulType = null;

  if (scratch) {
    foulType = 'Scratch — cue ball in pocket!';
  } else if (!gs.cueBallContacted) {
    foulType = 'Foul — cue ball did not hit any ball!';
  } else {
    // Wrong first contact
    if (gs.groupAssigned && gs.firstContact !== null) {
      const myGroup = playerGroup(active);
      const activeOn8 = active === 1 ? gs.player1On8Ball : gs.player2On8Ball;
      if (activeOn8) {
        // Must contact 8-ball first
        if (gs.firstContact !== 8) {
          foulType = 'Foul — must contact the 8-ball first!';
        }
      } else {
        // Must contact own group ball first
        const fcGroup = ballGroup(gs.firstContact);
        if (fcGroup !== myGroup && gs.firstContact !== 8) {
          foulType = `Foul — wrong ball contacted first!`;
        } else if (gs.firstContact === 8) {
          foulType = 'Foul — contacted 8-ball before clearing your group!';
        }
      }
    }

    // No rail after contact
    if (!foulType && !gs.railContactThisShot && ballIds.length === 0) {
      foulType = 'Foul — no ball reached a cushion after contact!';
    }
  }

  if (foulType) {
    showFoulBanner(foulType);
    handleGroupAssignment(active, pocketed);
    if (scratch) {
      // Remove cue ball from play until placed
    }
    transitionToNextTurn(opp, true);
    return;
  }

  // ── 5. Group assignment ───────────────────────────────────────
  if (!gs.groupAssigned) {
    handleGroupAssignment(active, pocketed);
  }

  // ── 6. 8-ball legally pocketed in endgame → WIN ───────────────
  if (eight) {
    const activeOn8 = active === 1 ? gs.player1On8Ball : gs.player2On8Ball;
    if (activeOn8) {
      endGame(active, `Player ${active} legally pocketed the 8-ball!`);
      return;
    }
    // If somehow 8-ball pocketed without being on 8-ball phase, it's already
    // caught in step 2 above (group assigned) or this is a pre-assignment shot.
    // If groups aren't assigned yet, treat as early pocket → loss.
    endGame(opp, `Player ${active} pocketed the 8-ball before clearing their group!`);
    return;
  }

  // ── 7. Credit balls and determine turn continuation ───────────
  const ownBalls = ownGroupBalls(active, pocketed);
  for (const b of ownBalls) {
    if (!playerPocketed(active).includes(b.id)) {
      playerPocketed(active).push(b.id);
    }
  }

  // Opponent's balls pocketed stay off the table AND count toward the opponent's
  // progress (they are just pocketed "for free" — the active player loses their turn).
  const oppBalls = pocketed.filter(p => {
    const grp = ballGroup(p.id);
    if (grp === null) return false; // 8-ball handled separately
    return gs.groupAssigned && grp !== playerGroup(active);
  });
  for (const b of oppBalls) {
    const grp = ballGroup(b.id);
    const owner = gs.player1Group === grp ? 1 : 2;
    if (!playerPocketed(owner).includes(b.id)) {
      playerPocketed(owner).push(b.id);
    }
  }

  // Update 8-ball endgame flags
  updateOn8BallFlags();

  // Turn continues only if at least one own-group ball was legally pocketed
  // AND no opponent ball was also pocketed on the same shot.
  const continuesTurn = ownBalls.length > 0 && oppBalls.length === 0;

  const nextPlayer = continuesTurn ? active : opp;
  transitionToNextTurn(nextPlayer, false);
}

// ── Helpers for evaluateShotResult ───────────────────────────

/**
 * Filter `pocketed` entries to just those belonging to `player`'s group.
 * Before group assignment, all non-8 pocketed balls "count" for the shooter.
 * @param {number} player
 * @param {Array<{id, timestamp}>} pocketed
 * @returns {Array<{id, timestamp}>}
 */
function ownGroupBalls(player, pocketed) {
  if (!gs.groupAssigned) {
    // Pre-assignment: all non-8 pocketed balls belong to shooter
    return pocketed.filter(p => p.id !== 8);
  }
  const grp = playerGroup(player);
  return pocketed.filter(p => ballGroup(p.id) === grp);
}

/**
 * Attempt to assign groups based on the balls pocketed this shot.
 * Only acts when groups are not yet assigned.
 * @param {number} shooter   Active player number.
 * @param {Array<{id, timestamp}>} pocketed  Non-cue-ball, non-8 balls pocketed.
 */
function handleGroupAssignment(shooter, pocketed) {
  if (gs.groupAssigned) {
    // Already assigned — credit own balls to their owner
    for (const p of pocketed) {
      const grp = ballGroup(p.id);
      if (grp === null) continue; // 8-ball, handled elsewhere
      const owner = gs.player1Group === grp ? 1 : 2;
      if (!playerPocketed(owner).includes(p.id)) {
        playerPocketed(owner).push(p.id);
      }
    }
    updateOn8BallFlags();
    updateHUD();
    return;
  }

  // Pre-assignment
  const nonEight = pocketed.filter(p => p.id !== 8);
  if (nonEight.length === 0) return;

  // Determine which group to assign shooter based on first-pocketed ball
  const sorted = [...nonEight].sort((a, b) => a.timestamp - b.timestamp);
  const firstId = sorted[0].id;
  const firstGroup = ballGroup(firstId);
  const oppGroup = firstGroup === 'solids' ? 'stripes' : 'solids';

  // Tiebreak: if both solids and stripes pocketed simultaneously (within 1ms)
  // assign group with more balls; if tied, assign solids to breaking player.
  const solidsCount  = nonEight.filter(p => ballGroup(p.id) === 'solids').length;
  const stripesCount = nonEight.filter(p => ballGroup(p.id) === 'stripes').length;

  let assignedGroup;
  if (solidsCount > 0 && stripesCount > 0) {
    const timeDiff = Math.abs(
      nonEight.find(p => ballGroup(p.id) === 'solids').timestamp -
      nonEight.find(p => ballGroup(p.id) === 'stripes').timestamp
    );
    if (timeDiff < 2) {
      // Effectively simultaneous
      if (solidsCount !== stripesCount) {
        assignedGroup = solidsCount > stripesCount ? 'solids' : 'stripes';
      } else {
        // Tied — solids go to breaking player
        assignedGroup = gs.breakingPlayer === shooter ? 'solids' : 'stripes';
      }
    } else {
      assignedGroup = firstGroup;
    }
  } else {
    assignedGroup = firstGroup;
  }

  if (shooter === 1) {
    gs.player1Group = assignedGroup;
    gs.player2Group = assignedGroup === 'solids' ? 'stripes' : 'solids';
  } else {
    gs.player2Group = assignedGroup;
    gs.player1Group = assignedGroup === 'solids' ? 'stripes' : 'solids';
  }
  gs.groupAssigned = true;

  // Credit all own-group balls pocketed this shot
  for (const p of nonEight) {
    const grp = ballGroup(p.id);
    const owner = gs.player1Group === grp ? 1 : 2;
    if (!playerPocketed(owner).includes(p.id)) {
      playerPocketed(owner).push(p.id);
    }
  }

  updateOn8BallFlags();
  updateHUD();
  showFoulBanner(
    `Groups assigned: Player 1 → ${gs.player1Group}, Player 2 → ${gs.player2Group}`
  );
}

/**
 * Refresh the player1On8Ball / player2On8Ball flags.
 */
function updateOn8BallFlags() {
  if (gs.groupAssigned) {
    gs.player1On8Ball = playerGroupCleared(1);
    gs.player2On8Ball = playerGroupCleared(2);
  }
}

/**
 * Transition to the next player's turn (or ball-in-hand if scratch).
 * Updates the active player and game state.
 * @param {number} nextPlayer
 * @param {boolean} ballInHand  true = opponent gets ball-in-hand placement
 */
function transitionToNextTurn(nextPlayer, ballInHand) {
  gs.activePlayer = nextPlayer;

  if (ballInHand) {
    // Cue ball must be re-placed if it was pocketed (scratch)
    // or awarded to the incoming player after any other foul
    gs.bihPosition = { x: HEAD_SPOT_X, y: HEAD_SPOT_Y };
    gs.bihValid    = false;
    gs.state       = STATES.BALL_IN_HAND_PLACEMENT;
  } else {
    gs.state = STATES.AIMING;
  }

  updateHUD();
}

/**
 * Declare the game over, show the winner modal.
 * @param {number} winner   1 or 2
 * @param {string} reason   Human-readable win reason.
 */
function endGame(winner, reason) {
  gs.winner   = winner;
  gs.winReason = reason;
  gs.state    = STATES.GAME_OVER;
  showGameOver(winner, reason);
}

/* ============================================================
   SECTION 7: UI Manager
   ============================================================ */

// ── DOM references (assigned in initGame) ────────────────────
let elP1Panel, elP2Panel;
let elP1Group, elP2Group;
let elPocketed1, elPocketed2;
let elPowerFill;
let elFoulBanner;
let elTurnIndicator;
let elStartModal, elGameoverModal;
let elGameoverTitle, elGameoverReason;
let elStartBtn, elPlayAgainBtn;

/** Foul-banner auto-dismiss timer handle. */
let foulBannerTimer = null;

/**
 * Cache all DOM element references.
 * Call once from initGame after the DOM is ready.
 */
function cacheDomRefs() {
  elP1Panel       = document.getElementById('player1-panel');
  elP2Panel       = document.getElementById('player2-panel');
  elP1Group       = document.getElementById('p1-group');
  elP2Group       = document.getElementById('p2-group');
  elPocketed1     = document.getElementById('pocketed-1');
  elPocketed2     = document.getElementById('pocketed-2');
  elPowerFill     = document.getElementById('power-meter-fill');
  elFoulBanner    = document.getElementById('foul-banner');
  elTurnIndicator = document.getElementById('turn-indicator');
  elStartModal    = document.getElementById('start-modal');
  elGameoverModal = document.getElementById('gameover-modal');
  elGameoverTitle  = document.getElementById('gameover-title');
  elGameoverReason = document.getElementById('gameover-reason');
  elStartBtn      = document.getElementById('start-btn');
  elPlayAgainBtn  = document.getElementById('play-again-btn');
}

// ── updateHUD ────────────────────────────────────────────────
/**
 * Refresh all HUD elements to reflect current game state.
 * Called after every state transition and group-assignment event.
 */
function updateHUD() {
  // Active player panels
  const p1Active = gs.activePlayer === 1;
  elP1Panel.classList.toggle('active-player', p1Active);
  elP2Panel.classList.toggle('active-player', !p1Active);

  // Group labels
  setGroupLabel(elP1Group, gs.player1Group, 1);
  setGroupLabel(elP2Group, gs.player2Group, 2);

  // On-8-ball indicator
  if (gs.player1On8Ball) {
    elP1Group.textContent = '🎱 On the 8-ball!';
  }
  if (gs.player2On8Ball) {
    elP2Group.textContent = '🎱 On the 8-ball!';
  }

  // Turn indicator text
  if (gs.state === STATES.AWAITING_BREAK) {
    elTurnIndicator.textContent = `Player ${gs.activePlayer} to break`;
  } else if (gs.state === STATES.BALL_IN_HAND_PLACEMENT) {
    elTurnIndicator.textContent = `Player ${gs.activePlayer} — place cue ball`;
  } else if (gs.state === STATES.GAME_OVER) {
    elTurnIndicator.textContent = '';
  } else {
    elTurnIndicator.textContent = `Player ${gs.activePlayer}'s turn`;
  }

  // Pocketed ball trays
  updatePocketedTrays();
}

/**
 * Set the group label element content for a player.
 * @param {HTMLElement} el
 * @param {string|null} group  'solids' | 'stripes' | null
 * @param {number} player
 */
function setGroupLabel(el, group, player) {
  if (!group) {
    el.textContent = '';
    return;
  }
  const swatchColor = group === 'solids' ? BALL_COLORS[1] : BALL_COLORS[9];
  el.innerHTML =
    `<span class="group-swatch" style="background:${swatchColor}"></span>` +
    `<span>${group.charAt(0).toUpperCase() + group.slice(1)}</span>`;
}

// ── updatePocketedTrays ───────────────────────────────────────
/**
 * Re-render both pocketed-ball trays from gs.player1Pocketed / player2Pocketed.
 */
function updatePocketedTrays() {
  renderTray(elPocketed1, gs.player1Pocketed);
  renderTray(elPocketed2, gs.player2Pocketed);
}

/**
 * Render a single tray (a row of coloured ball icons).
 * @param {HTMLElement} trayEl
 * @param {number[]}    ids     Array of ball IDs to display.
 */
function renderTray(trayEl, ids) {
  trayEl.innerHTML = '';
  for (const id of ids) {
    const isStripe = id >= 9;
    const color    = BALL_COLORS[id];
    const textCol  = BALL_TEXT_COLORS[id];

    const icon = document.createElement('div');
    icon.className = 'pocketed-icon' + (isStripe ? ' stripe-icon' : '');

    if (isStripe) {
      // White base with coloured middle band (CSS ::after handles the band via
      // the stripe-icon class; we set background to the stripe color here and
      // let the white base show through at top/bottom via overflow:hidden).
      icon.style.background = '#f8f8f0';
      // Inner stripe overlay via inline element
      icon.innerHTML =
        `<span style="position:absolute;left:0;right:0;top:33%;height:34%;background:${color};"></span>` +
        `<span style="position:relative;z-index:2;color:${textCol};font-size:7px;font-weight:bold;">${id}</span>`;
    } else if (id === 8) {
      icon.style.background = color;
      icon.innerHTML = `<span style="color:#fff;font-size:7px;font-weight:bold;">8</span>`;
    } else {
      icon.style.background = color;
      icon.innerHTML = `<span style="color:${textCol};font-size:7px;font-weight:bold;">${id}</span>`;
    }
    trayEl.appendChild(icon);
  }
}

// ── updatePowerMeter ─────────────────────────────────────────
/**
 * Set the power meter fill level and colour.
 * @param {number} pct  0.0 – 1.0
 */
function updatePowerMeter(pct) {
  elPowerFill.style.width = `${(pct * 100).toFixed(1)}%`;
  if (pct < 0.34) {
    elPowerFill.style.background = 'var(--power-green)';
  } else if (pct < 0.67) {
    elPowerFill.style.background = 'var(--power-yellow)';
  } else {
    elPowerFill.style.background = 'var(--power-red)';
  }
}

// ── showFoulBanner / hideFoulBanner ───────────────────────────
/**
 * Display a foul notification in the centre HUD banner.
 * Auto-dismisses after 2 seconds.
 * @param {string} message
 */
function showFoulBanner(message) {
  if (foulBannerTimer) {
    clearTimeout(foulBannerTimer);
    foulBannerTimer = null;
  }
  elFoulBanner.textContent = message;
  elFoulBanner.classList.remove('hidden');
  foulBannerTimer = setTimeout(hideFoulBanner, 2000);
}

/** Hide and clear the foul/info banner. */
function hideFoulBanner() {
  elFoulBanner.classList.add('hidden');
  elFoulBanner.textContent = '';
  foulBannerTimer = null;
}

// ── showGameOver ─────────────────────────────────────────────
/**
 * Show the game-over modal with winner and reason.
 * @param {number} winner
 * @param {string} reason
 */
function showGameOver(winner, reason) {
  elGameoverTitle.textContent  = `Player ${winner} Wins! 🎱`;
  elGameoverReason.textContent = reason;
  elGameoverModal.classList.remove('hidden');
}

/** Hide the game-over modal. */
function hideGameOver() {
  elGameoverModal.classList.add('hidden');
}

/** Hide the start modal. */
function hideStartModal() {
  elStartModal.classList.add('hidden');
}

/* ============================================================
   SECTION 8: Main Loop
   ============================================================ */

/**
 * Timestamp of the previous animation frame (ms).
 * Used to compute the frame delta time.
 */
let lastFrameTime = null;

/**
 * Physics accumulator — stores leftover real-time that hasn't been
 * consumed by physics steps yet (in seconds).
 */
let accumulator = 0;

/**
 * requestAnimationFrame callback — the heartbeat of the game.
 * Pattern:
 *   1. Compute real delta time since last frame (capped to avoid spiral).
 *   2. If in SHOT_IN_PROGRESS, advance physics in fixed FIXED_DT steps.
 *   3. If all balls settled, trigger evaluateShotResult().
 *   4. Render once.
 * @param {DOMHighResTimeStamp} timestamp
 */
function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  // ── Delta time ────────────────────────────────────────────
  if (lastFrameTime === null) lastFrameTime = timestamp;
  const rawDelta = (timestamp - lastFrameTime) / 1000; // convert ms → s
  lastFrameTime  = timestamp;

  // Cap delta to avoid spiral-of-death on tab-switch or slow devices
  const delta = Math.min(rawDelta, FIXED_DT * MAX_STEPS_PER_FRAME);

  // ── Physics (only during active shot) ────────────────────
  if (gs.state === STATES.SHOT_IN_PROGRESS) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepPhysics();
      accumulator -= FIXED_DT;
      steps++;
    }

    // ── Settlement detection ──────────────────────────────
    if (checkAllAtRest()) {
      accumulator = 0;
      evaluateShotResult();
    }
  } else {
    // Not in SHOT_IN_PROGRESS — drain accumulator to prevent burst on resume
    accumulator = 0;
  }

  // ── Render ────────────────────────────────────────────────
  render();
}

/* ============================================================
   SECTION 9: Initialization
   ============================================================ */

/**
 * Build the standard diamond rack of 15 object balls at the foot end.
 * Layout (5 rows, apex at FOOT_SPOT_X facing left):
 *
 *   Row 0 (apex):  ball 8 position is fixed at row 2, col 1 (centre).
 *                  One solid and one stripe in rear corners (row 4).
 *                  All other positions randomized from remaining balls.
 *
 * Rack extends leftward (toward the head) from FOOT_SPOT_X.
 */
function setupRack() {
  // Remove old object balls (keep cue ball if it exists)
  balls = balls.filter(b => b.id === 0);

  // ── Fixed positions ───────────────────────────────────────
  // Position grid: row 0 = apex (rightmost); rows expand left.
  // Slot (row, col): col ranges 0..row within each row.
  // x = FOOT_SPOT_X - row * ROW_SPACING_X
  // y = FOOT_SPOT_Y + (col - row/2) * ROW_SPACING_Y

  const slotX = (row) => FOOT_SPOT_X - row * ROW_SPACING_X;
  const slotY = (row, col) => FOOT_SPOT_Y + (col - row / 2) * ROW_SPACING_Y;

  // Fixed balls:
  //   Apex (row 0, col 0) — any ball (we'll put a random solid/stripe)
  //   Centre of row 2 (col 1) — 8-ball (fixed by rule)
  //   Rear corners (row 4, col 0) and (row 4, col 4) — one solid, one stripe
  const fixed = {
    '2,1': 8,   // 8-ball, centre third row
  };

  // Build list of all 15 object ball IDs
  const all = [1,2,3,4,5,6,7,9,10,11,12,13,14,15];

  // The two rear-corner slots must have one solid and one stripe
  const solidIds   = all.filter(id => id <= 7);
  const stripeIds  = all.filter(id => id >= 9);

  // Pick random corner balls (remove them from the pool)
  const cornerSolid  = solidIds.splice(Math.floor(Math.random() * solidIds.length), 1)[0];
  const cornerStripe = stripeIds.splice(Math.floor(Math.random() * stripeIds.length), 1)[0];

  // Randomly assign which corner gets solid vs stripe
  const [corner0Ball, corner4Ball] = Math.random() < 0.5
    ? [cornerSolid, cornerStripe]
    : [cornerStripe, cornerSolid];

  fixed['4,0'] = corner0Ball;
  fixed['4,4'] = corner4Ball;

  // Remaining balls (exclude 8, the two corner picks) for random fill
  const remaining = all.filter(id => id !== 8 && id !== cornerSolid && id !== cornerStripe);
  shuffle(remaining);

  // ── Place all 15 balls ────────────────────────────────────
  let fillIdx = 0;
  for (let row = 0; row <= 4; row++) {
    for (let col = 0; col <= row; col++) {
      const key = `${row},${col}`;
      let id;
      if (fixed[key] !== undefined) {
        id = fixed[key];
      } else {
        id = remaining[fillIdx++];
      }
      const x = slotX(row);
      const y = slotY(row, col);
      balls.push(createBall(id, x, y));
    }
  }
}

/**
 * Place (or reset) the cue ball to the head spot for the break shot.
 */
function placeCueBallBreak() {
  if (cueBall) {
    cueBall.x = HEAD_SPOT_X;
    cueBall.y = HEAD_SPOT_Y;
    cueBall.vx = 0;
    cueBall.vy = 0;
    cueBall.pocketed = false;
    cueBall.pocketAnim = null;
  } else {
    cueBall = createBall(0, HEAD_SPOT_X, HEAD_SPOT_Y);
    balls.push(cueBall);
  }
}

/**
 * Fisher-Yates shuffle (in-place).
 * @param {Array} arr
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Reset the full game state object for a new game.
 * Preserves breakingPlayer (caller alternates it before calling).
 */
function resetGameState() {
  gs.state            = STATES.AWAITING_BREAK;
  gs.activePlayer     = gs.breakingPlayer;
  gs.groupAssigned    = false;
  gs.player1Group     = null;
  gs.player2Group     = null;
  gs.player1Pocketed  = [];
  gs.player2Pocketed  = [];
  gs.pocketedThisShot = [];
  gs.firstContact     = null;
  gs.railContactThisShot = false;
  gs.cueBallContacted = false;
  gs.cueBallPocketed  = false;
  gs.railContactBallIds = new Set();
  gs.player1On8Ball   = false;
  gs.player2On8Ball   = false;
  gs.aimAngle         = Math.PI; // point left (toward foot end) by default
  gs.mouseTable       = { x: 0, y: 0 };
  gs.dragStartTable   = null;
  gs.power            = 0;
  gs.strikeAnimating  = false;
  gs.restCounter      = 0;
  gs.winner           = null;
  gs.winReason        = '';
  gs.bihPosition      = { x: HEAD_SPOT_X, y: HEAD_SPOT_Y };
  gs.bihValid         = false;
  gs._wasBreakShot    = false;
}

/**
 * Main initializer — called on first load and on Play Again.
 * @param {boolean} [playAgain=false]  If true, alternate the breaking player.
 */
function initGame(playAgain = false) {
  // ── Canvas setup ──────────────────────────────────────────
  if (!canvas) {
    canvas = document.getElementById('gameCanvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    ctx = canvas.getContext('2d');
    cacheDomRefs();
    attachInputListeners();
    window.addEventListener('resize', onWindowResize);
  }

  // ── State reset ───────────────────────────────────────────
  if (playAgain) {
    // Alternate who breaks
    gs.breakingPlayer = gs.breakingPlayer === 1 ? 2 : 1;
  } else {
    gs.breakingPlayer = 1;
  }

  resetGameState();

  // ── Ball setup ────────────────────────────────────────────
  balls = [];
  cueBall = null;
  setupRack();
  placeCueBallBreak();

  // Mark that the first shot is a break shot (used by rule engine)
  gs._wasBreakShot = true;

  // ── UI ────────────────────────────────────────────────────
  hideGameOver();
  hideFoulBanner();
  updatePowerMeter(0);
  updateHUD();
}

// ── Button wiring (runs after DOM is ready) ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Pre-init canvas (before start modal dismiss) so the board renders
  initGame(false);

  // Show start modal — game starts (rAF loop begins) after clicking Start
  document.getElementById('start-btn').addEventListener('click', () => {
    hideStartModal();
    // Kick off the game loop
    lastFrameTime = null;
    accumulator   = 0;
    requestAnimationFrame(gameLoop);
  });

  document.getElementById('play-again-btn').addEventListener('click', () => {
    hideGameOver();
    initGame(true);
    // Loop is already running from the initial start click
  });
});
