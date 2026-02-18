## Refined Implementation Plan: Browser-Based 8-Ball Pool

---

### CRITICAL ADDITIONS & RESOLUTIONS

The original specification contains seven structural ambiguities that would cause implementation failures or rule-engine gaps. The refinements below are additive — they do not replace the original spec but resolve, clarify, and extend it.

---

## I. Shot Metadata System (Linchpin Addition)

The rule engine cannot function without per-shot instrumentation woven into the physics engine. Add an explicit `shotData` object, instantiated fresh at the moment `SHOT_IN_PROGRESS` begins, mutated by physics callbacks, and consumed by `evaluateShotResult()`.

```js
// Instantiated at shot start, before any physics steps run
const shotData = {
  firstContact: null,         // ball ID of first object ball the cue ball struck
  firstContactIsLegal: false, // set after group assignment check
  railContactAfterHit: false, // any ball (including cue) touched a rail after firstContact
  pocketedOrder: [],          // [{ball, timestamp}] in strict pocketing order
  cueBallPocketed: false,     // scratch flag
  eightBallPocketed: false,   // 8-ball flag
  breakCushionContacts: new Set() // tracks unique cushion contacts during break
};
```

Physics engine must fire these callbacks:

- **`onBallBallCollision(ballA, ballB)`**: If `ballA` is the cue ball and `shotData.firstContact === null`, set `shotData.firstContact = ballB.id`.
- **`onBallCushionCollision(ball)`**: Set `shotData.railContactAfterHit = true` if `shotData.firstContact !== null`. During break state, add cushion ID to `breakCushionContacts`.
- **`onBallPocketed(ball)`**: Push `{ ball, time: performance.now() }` to `shotData.pocketedOrder`. Set flags for cue ball and 8-ball.

This must be physically in the collision resolution functions, not post-hoc. No rule check is possible without it.

---

## II. Fixed Timestep + Anti-Tunneling Integration

The original spec describes these as separate systems. They must be unified as follows to maintain temporal consistency across all balls in the same physics step:

```js
function physicsStep(dt) {
  // 1. Compute global max displacement this step
  const maxSpeed = Math.max(...balls.map(b => magnitude(b.vel)));
  const rawDisp = maxSpeed * dt;

  // 2. Subdivide dt globally (NOT per-ball) if tunneling risk
  const subSteps = rawDisp > BALL_RADIUS
    ? Math.ceil(rawDisp / BALL_RADIUS)
    : 1;
  const subDt = dt / subSteps;

  // 3. All balls advance through identical sub-steps
  for (let s = 0; s < subSteps; s++) {
    applyFriction(subDt);
    resolveAllBallBallCollisions();
    resolveAllBallCushionCollisions();
    checkAllPockets();
  }
}
```

All balls must use the same `subDt` per step. Per-ball adaptive sub-stepping is prohibited — it creates temporal desync between balls and makes cross-ball collision detection undefined.

The outer accumulator loop remains unchanged (consume wall time in `1/120s` chunks, max 8 steps per frame).

---

## III. Cushion Segments (Not a Rectangle)

Replace the naive bounding-box collision check with six explicit line segments. This is the only way to correctly model pocket openings.

```js
// Each cushion is a line segment with a normal direction.
// Endpoints terminate at pocket mouth edges, not at corners.
// PML = pocket mouth left offset, PMR = pocket mouth right offset
// from pocket center — tune so rail "opens" convincingly (~18 units)

const CUSHION_SEGMENTS = [
  // Top rail (y=0), two segments split by top-side pocket
  { x1: CORNER_PML, y1: 0, x2: SIDE_PMLeft,  y2: 0, normal: {x:0, y:1}  },
  { x1: SIDE_PMRight, y1: 0, x2: 1000-CORNER_PMR, y2: 0, normal: {x:0, y:1} },
  // Bottom rail (y=500), two segments
  { x1: CORNER_PML, y1: 500, x2: SIDE_PMLeft, y2: 500, normal: {x:0, y:-1} },
  { x1: SIDE_PMRight, y1: 500, x2: 1000-CORNER_PMR, y2: 500, normal: {x:0, y:-1} },
  // Left rail (x=0), one segment
  { x1: 0, y1: CORNER_PMT, x2: 0, y2: 500-CORNER_PMB, normal: {x:1, y:0} },
  // Right rail (x=1000), one segment
  { x1: 1000, y1: CORNER_PMT, x2: 1000, y2: 500-CORNER_PMB, normal: {x:-1, y:0} },
];
```

Ball-cushion collision: for each segment, find the closest point on the segment to the ball center. If distance < `BALL_RADIUS`, reflect the velocity component along the segment's normal and apply positional correction. Corner pocket gaps are naturally open because no segment spans them.

`CORNER_PML / PMR / PMT / PMB` ≈ 28 units from each corner. `SIDE_PMLeft / PMRight` ≈ 488 / 512 (±12 from pocket center at 500). Tune visually.

---

## IV. Power Drag — Directional Lock Clarification

The shot direction is established at `mousedown` and locked. Do not re-track the mouse for direction during `POWER_DRAG`. Power is derived from drag distance only.

```js
// On mousedown (in AIMING state, near cue ball):
shotState.aimAngle = Math.atan2(
  tableMouseY - cueBall.y,
  tableMouseX - cueBall.x
);
shotState.dragOrigin = { x: tableMouseX, y: tableMouseY };
// Transition to POWER_DRAG

// On mousemove (in POWER_DRAG):
// Project mouse displacement onto the OPPOSITE of aimAngle
const dx = tableMouseX - shotState.dragOrigin.x;
const dy = tableMouseY - shotState.dragOrigin.y;
const backVec = { x: -Math.cos(shotState.aimAngle), y: -Math.sin(shotState.aimAngle) };
const rawPower = Math.max(0, dx * backVec.x + dy * backVec.y);
shotState.power = Math.min(1.0, rawPower / MAX_DRAG_DISTANCE); // MAX_DRAG_DISTANCE ≈ 120 units

// On mouseup:
if (shotState.power < 0.01) {
  // No shot — return to AIMING
} else {
  // Fire shot
}
```

---

## V. Foul Evaluation Order in `evaluateShotResult()`

Execute checks in this exact sequence to prevent rule conflicts:

```
1. Is GAME_OVER already? → return, do nothing.

2. Was the 8-ball pocketed?
   a. Was cue ball also pocketed (simultaneous)?  → CURRENT PLAYER LOSES.
   b. Has current player cleared their group?
      - Yes → CURRENT PLAYER WINS.
      - No  → CURRENT PLAYER LOSES (early 8-ball).

3. Foul checks (in priority order):
   a. Cue ball pocketed (scratch)?       → foul: BALL_IN_HAND
   b. No contact at all?                 → foul: BALL_IN_HAND
   c. Wrong first contact?               → foul: BALL_IN_HAND
   d. No rail contact after legal hit    → foul: BALL_IN_HAND
   (If any foul → show banner, pass turn, goto BALL_IN_HAND_PLACEMENT)

4. Group assignment (if not yet assigned):
   - Any ball pocketed this shot?
     - Yes → apply group assignment logic (first-pocketed order)
     - No  → no assignment yet

5. Turn continuation:
   - Any ball pocketed from current player's group (or any ball if unassigned)?
     - Yes + no opponent balls pocketed → SAME player, AIMING
     - Yes + opponent ball also pocketed → PASS TURN, AIMING
     - No balls of own group pocketed   → PASS TURN, AIMING

6. Transition to next state.
```

---

## VI. Break Validation — Explicit Algorithm

```js
function validateBreak(shotData) {
  const ballsPocketed = shotData.pocketedOrder.length > 0;
  const cushionsHit = shotData.breakCushionContacts.size;

  // 8-ball pocketed on break: re-spot, continue (not a loss)
  if (shotData.eightBallPocketed) {
    respotEightBall();
    // Remove 8-ball from pocketedOrder for group assignment purposes
  }

  // Cue ball pocketed on break: scratch, ball-in-hand, no group assignment
  if (shotData.cueBallPocketed) {
    return { legal: true, foul: 'SCRATCH', transition: 'BALL_IN_HAND' };
  }

  // Illegal break: < 4 cushion contacts AND nothing pocketed
  const objectBallsPocketed = shotData.pocketedOrder
    .filter(e => e.ball.id !== 'cue' && e.ball.id !== 8).length;

  if (cushionsHit < 4 && objectBallsPocketed === 0) {
    return { legal: false, foul: 'ILLEGAL_BREAK', transition: 'RERACK' };
  }

  return { legal: true, foul: null };
}
```

Count unique cushion IDs (top, bottom, left, right = 4 maximum possible). Use segment IDs as the deduplication key.

---

## VII. 8-Ball Re-spot Algorithm

```js
function respotEightBall() {
  const footSpot = { x: 750, y: 250 }; // 3/4 table length, centered
  const candidates = [
    footSpot,
    { x: 750, y: 226 },  // one ball diameter above
    { x: 750, y: 274 },  // one ball diameter below
    { x: 726, y: 250 },
    { x: 774, y: 250 },
    // spiral outward as needed
  ];
  for (const pos of candidates) {
    if (isPositionClear(pos, balls, BALL_RADIUS * 2 + 2)) {
      eightBall.x = pos.x;
      eightBall.y = pos.y;
      eightBall.vel = { x: 0, y: 0 };
      balls.push(eightBall); // re-add to simulation
      return;
    }
  }
  // If all candidates occupied (extremely rare), place at head spot
  eightBall.x = 250; eightBall.y = 250;
  balls.push(eightBall);
}
```

---

## VIII. Canvas Device Pixel Ratio Handling

```js
function initCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const LOGICAL_W = 1200, LOGICAL_H = 680;

  canvas.width = LOGICAL_W * dpr;
  canvas.height = LOGICAL_H * dpr;
  canvas.style.width = LOGICAL_W + 'px';
  canvas.style.height = LOGICAL_H + 'px';
  ctx.scale(dpr, dpr);
  // All drawing now uses logical 1200×680 coordinates
}

function screenToTable(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  // CSS display size may differ from logical size due to responsive scaling
  const scaleX = 1200 / rect.width;
  const scaleY = 680 / rect.height;
  const logicalX = (clientX - rect.left) * scaleX;
  const logicalY = (clientY - rect.top) * scaleY;
  // Convert from canvas-space to table-space
  // Table felt starts at TABLE_OFFSET_X, TABLE_OFFSET_Y within the 1200×680 canvas
  return {
    x: (logicalX - TABLE_OFFSET_X) * (TABLE_W / FELT_W),
    y: (logicalY - TABLE_OFFSET_Y) * (TABLE_H / FELT_H)
  };
}
```

Call `initCanvas()` on load and again on `window.resize`, resetting `dpr` and re-scaling. Do not retain a stale `dpr` reference.

---

## IX. State Machine Transition Table (Explicit)

| From State | Event | Condition | To State |
|---|---|---|---|
| `AWAITING_BREAK` | Start button clicked | — | `AIMING` |
| `AIMING` | `mousedown` near cue ball | — | `POWER_DRAG` |
| `POWER_DRAG` | `mouseup`, power ≥ 1% | — | `SHOT_IN_PROGRESS` |
| `POWER_DRAG` | `mouseup`, power < 1% | — | `AIMING` |
| `SHOT_IN_PROGRESS` | All balls at rest ≥5 steps | — | `EVALUATING_SHOT_RESULT` |
| `EVALUATING_SHOT_RESULT` | Rules evaluated | Win condition | `GAME_OVER` |
| `EVALUATING_SHOT_RESULT` | Rules evaluated | Foul | `BALL_IN_HAND_PLACEMENT` |
| `EVALUATING_SHOT_RESULT` | Rules evaluated | Legal, same player | `AIMING` |
| `EVALUATING_SHOT_RESULT` | Rules evaluated | Legal, turn passes | `AIMING` (opponent) |
| `EVALUATING_SHOT_RESULT` | Rules evaluated | Illegal break | `AWAITING_BREAK` (same player) |
| `BALL_IN_HAND_PLACEMENT` | Valid click | Placement legal | `AIMING` |
| `GAME_OVER` | Play Again clicked | — | `AWAITING_BREAK` |

All mouse events not listed for a given state are **silently ignored** in the handler via early-return guard.

---

## X. Constants Block — Complete Reference

```js
// ─── TABLE ───────────────────────────────────────────────────────────────────
const TABLE_W         = 1000;    // logical felt width (units)
const TABLE_H         = 500;     // logical felt height (units)
const CANVAS_W        = 1200;    // full canvas logical width
const CANVAS_H        = 680;     // full canvas logical height
const TABLE_OFFSET_X  = 100;     // canvas-space left edge of felt
const TABLE_OFFSET_Y  = 90;      // canvas-space top edge of felt

// ─── BALLS ───────────────────────────────────────────────────────────────────
const BALL_RADIUS     = 12;
const POCKET_RADIUS_CORNER = 22;
const POCKET_RADIUS_SIDE   = 20;
const CORNER_INSET    = 8;       // pocket center offset from corner

// ─── PHYSICS ─────────────────────────────────────────────────────────────────
const FIXED_DT        = 1 / 120;
const MAX_STEPS       = 8;
const FRICTION        = 0.991;   // per physics step at 120Hz
const REST_THRESHOLD  = 0.3;     // units/step — snap to zero below this
const REST_STEPS_REQ  = 5;       // consecutive steps all-at-rest before settle
const RESTITUTION     = 0.96;    // ball-ball coefficient of restitution
const RAIL_RESTITUTION= 0.75;    // ball-rail perpendicular restitution
const RAIL_FRICTION   = 0.95;    // ball-rail tangential retention factor

// ─── SHOT ────────────────────────────────────────────────────────────────────
const MAX_SHOT_SPEED  = 28;      // units/step at 100% power
const MAX_DRAG_DIST   = 120;     // logical table units for full power drag

// ─── RACK ────────────────────────────────────────────────────────────────────
const FOOT_SPOT       = { x: 750, y: 250 };
const HEAD_SPOT       = { x: 250, y: 250 };
const BALL_SPACING    = BALL_RADIUS * 2 * 1.02; // slight gap to prevent overlap at start

// ─── AIMING ──────────────────────────────────────────────────────────────────
const AIM_LINE_MAX_LEN = 600;    // maximum guideline length in table units
const DEFLECT_LINE_LEN = 40;     // object-ball and cue-ball deflection indicators
```

---

## XI. Rack Positions — Explicit Grid

Rack rows from apex (row 1) to base (row 5), apex at `FOOT_SPOT`:

```js
function buildRackPositions() {
  const rows = [1, 2, 3, 4, 5];
  const positions = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      positions.push({
        x: FOOT_SPOT.x + row * BALL_SPACING * Math.cos(Math.PI / 6),
        y: FOOT_SPOT.y + (col - row / 2) * BALL_SPACING
      });
    }
  });
  // positions[0]  = apex (row 1, col 0)   → any ball except 8
  // positions[4]  = row 3, col 1 (center) → 8-ball FIXED
  // positions[12] = row 5, col 0 (rear-left corner)  → one solid FIXED
  // positions[14] = row 5, col 4 (rear-right corner) → one stripe FIXED
  // All remaining positions: shuffle from remaining balls
  return positions;
}
```

Row 3 center index = `1 + 2 + 1 = position[4]` (0-indexed: apex=0, row2=[1,2], row3=[3,4,5], center of row3=4). Confirm this is the 5th position (0-indexed: 4). ✓

---

## XII. Group Assignment — Precise Logic

```js
function resolveGroupAssignment(pocketedOrder, breakingPlayerId, currentPlayerId) {
  // Filter to object balls only (not cue, not 8-ball which was re-spotted)
  const objects = pocketedOrder.filter(e => e.ball.id !== 'cue' && e.ball.id !== 8);
  if (objects.length === 0) return; // no assignment

  const solids  = objects.filter(e => e.ball.id >= 1 && e.ball.id <= 7);
  const stripes = objects.filter(e => e.ball.id >= 9 && e.ball.id <= 15);

  let currentPlayerGroup;
  if (solids.length > 0 && stripes.length === 0) {
    currentPlayerGroup = 'solids';
  } else if (stripes.length > 0 && solids.length === 0) {
    currentPlayerGroup = 'stripes';
  } else {
    // Both types pocketed on same shot
    const firstSolid  = solids[0]?.time  ?? Infinity;
    const firstStripe = stripes[0]?.time ?? Infinity;
    if (firstSolid < firstStripe) {
      currentPlayerGroup = 'solids';
    } else if (firstStripe < firstSolid) {
      currentPlayerGroup = 'stripes';
    } else {
      // Truly simultaneous (same ms timestamp)
      if (solids.length > stripes.length) currentPlayerGroup = 'solids';
      else if (stripes.length > solids.length) currentPlayerGroup = 'stripes';
      else currentPlayerGroup = (currentPlayerId === breakingPlayerId) ? 'solids' : 'stripes';
    }
  }

  gameState.groups[currentPlayerId]  = currentPlayerGroup;
  gameState.groups[opponentOf(currentPlayerId)] =
    currentPlayerGroup === 'solids' ? 'stripes' : 'solids';
}
```

---

## XIII. Aiming Line — Ray-Cast Algorithm

```js
function castAimRay(origin, angle, balls, maxLen) {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  let closest = { dist: maxLen, type: null, point: null, ball: null };

  // 1. Check each object ball (sweep-sphere intersection)
  for (const ball of balls) {
    if (ball === cueBall || ball.pocketed) continue;
    // Find t where |origin + t*dir - ball.pos| = 2*BALL_RADIUS
    const toball = { x: ball.x - origin.x, y: ball.y - origin.y };
    const b = dot(toball, dir);
    const c = dot(toball, toball) - (2 * BALL_RADIUS) ** 2;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = b - Math.sqrt(disc);
    if (t > 0 && t < closest.dist) {
      closest = { dist: t, type: 'ball', ball,
        point: { x: origin.x + t * dir.x, y: origin.y + t * dir.y } };
    }
  }

  // 2. Check cushion segments
  for (const seg of CUSHION_SEGMENTS) {
    const t = raySegmentIntersect(origin, dir, seg);
    if (t !== null && t > 0 && t < closest.dist) {
      closest = { dist: t, type: 'cushion', ball: null,
        point: { x: origin.x + t * dir.x, y: origin.y + t * dir.y } };
    }
  }

  return closest;
}
```

Ghost ball position = `closest.point` (that's where cue ball center would be at contact). Object-ball deflection direction = normalized vector from ghost ball center to target ball center. Cue ball deflection direction = perpendicular to that vector (tangent direction, two possible — choose the one forming an acute angle with the shot direction's continuation).

---

## XIV. Rendering Draw Order (Per Frame)

```
1. Clear canvas
2. drawWoodRails()          — outer border, brown fill
3. drawFelt()               — green fill in table bounds
4. drawCushionStrips()      — darker green inner cushion strips
5. drawDiamondSights()      — white dots on rails
6. drawHeadString()         — faint dotted line (optional)
7. drawFootSpot()           — small dot
8. drawPocketMouths()       — dark gray rings
9. drawPockets()            — black circles on top
10. drawBallShadows()        — all shadow ellipses before any balls
11. drawBalls()              — all balls (solids, stripes, 8-ball, cue)
12. if state===AIMING || POWER_DRAG:
      drawAimingLine()
      drawGhostBall()
      drawDeflectionIndicators()
      drawCueStick()
13. if state===BALL_IN_HAND_PLACEMENT:
      drawBallInHandGhost()
14. if state===SHOT_IN_PROGRESS:
      drawCueStickStrike()   — strike animation if within 80ms window
```

Ball shadows drawn in a separate pass (before balls) prevents any ball rendering from overwriting shadows of balls behind them.

---

## XV. Play Again — State Reset Checklist

```js
function resetGame() {
  // 1. Alternate breaker
  gameState.breakingPlayer = opponentOf(gameState.breakingPlayer);
  gameState.currentPlayer  = gameState.breakingPlayer;

  // 2. Clear all ball state
  initBalls(); // re-creates all 16 ball objects, positions, zeros velocities

  // 3. Clear game state
  gameState.groups     = { player1: null, player2: null };
  gameState.pocketed   = { player1: [], player2: [] };
  gameState.phase      = 'BREAK'; // within AWAITING_BREAK
  gameState.state      = 'AWAITING_BREAK';
  gameState.shotData   = null;
  gameState.restCounter = 0;

  // 4. Clear HUD
  uiManager.clearGroupLabels();
  uiManager.clearPocketedTrays();
  uiManager.hidePowerMeter();
  uiManager.hideModal('gameOver');

  // 5. Show start state
  // No start modal on Play Again — go directly to AIMING
  gameState.state = 'AIMING';
}
```

Do not show the start modal on Play Again. Only show it on the very first page load.

---

## XVI. File Dependency Map

```
index.html
  └─ <link> styles.css
  └─ <script defer> game.js
       ├─ Section 1:  Constants & Color Maps
       ├─ Section 2:  Ball & GameState Objects
       ├─ Section 3:  Physics Engine
       │    ├─ physicsStep(dt)
       │    ├─ resolveBallBall(a, b)
       │    ├─ resolveBallCushion(ball, seg)
       │    ├─ checkPockets()
       │    └─ applyFriction()
       ├─ Section 4:  Rendering
       │    └─ render() — calls draw* functions in order from §XIV
       ├─ Section 5:  Input Handler
       │    ├─ canvas.addEventListener('mousemove', ...)
       │    ├─ canvas.addEventListener('mousedown', ...)
       │    ├─ canvas.addEventListener('mouseup', ...)
       │    └─ screenToTable(clientX, clientY)
       ├─ Section 6:  Rule Engine
       │    ├─ evaluateShotResult()   — follows §V order
       │    ├─ validateBreak()        — §VI
       │    └─ resolveGroupAssignment() — §XII
       ├─ Section 7:  UI Manager
       │    └─ updateHUD(), showFoulBanner(), showModal(), hideModal()
       ├─ Section 8:  Main Loop
       │    └─ gameLoop(timestamp) — accumulator pattern, calls physicsStep + render
       └─ Section 9:  Initialization
            └─ initGame() → initCanvas() → buildRack() → attachEvents() → gameLoop()
```

---

This refined plan resolves every structural gap in the original specification. Proceed to implementation with these additions merged into the original spec as authoritative overrides where they conflict, and as extensions where they add.