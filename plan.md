---

**Build a fully functional, browser-based 8-ball pool game delivered as three separate files: `index.html`, `styles.css`, and `game.js`. The game must be playable from break to finish with realistic physics, complete APA/BCA-standard 8-ball rule enforcement, and a polished visual experience. Every feature described below must be implemented — no stubs, no placeholders, no truncated output.**

---

### 🎱 Game Rules & Logic (Standard 8-Ball)

**Players & Turns**
- Two-player, turn-based local play on a single device. Display the active player (`Player 1` / `Player 2`) prominently in the HUD at all times with a clear visual distinction (e.g., glowing border, highlight color) so there is never ambiguity about whose turn it is.
- Maintain an explicit **game state machine** with these states: `AWAITING_BREAK`, `AIMING`, `POWER_DRAG`, `SHOT_IN_PROGRESS`, `BALL_IN_HAND_PLACEMENT`, `EVALUATING_SHOT_RESULT`, `GAME_OVER`. Every input and physics event must be gated by the current state — e.g., mouse clicks during `SHOT_IN_PROGRESS` are ignored; aiming UI only renders during `AIMING`.

**Break Shot**
- The game begins with a standard **diamond rack** at the foot end of the table: 15 object balls arranged in a triangle with the apex ball on the foot spot, the 8-ball in the center of the third row, one solid and one stripe in each rear corner, and the remaining balls placed randomly in the remaining positions. Randomize the non-fixed positions on each new game.
- The cue ball starts at the **head spot** (¼ table length from the head rail, centered laterally). Player 1 always breaks first.
- On the break, the shooting player is **not yet assigned** solids or stripes. Group assignment is deferred until the first legal pocket after the break (see below).
- **Break-specific rules**: At least four object balls must contact a cushion or a ball must be pocketed; otherwise it is an illegal break — re-rack and the same player breaks again. Enforce this.

**Group Assignment**
- Assignment occurs when the first object ball is **legally pocketed after the break** (this may be on the break shot itself or on a subsequent shot if nothing was pocketed on the break). The pocketing player receives the group of the pocketed ball (solids 1–7 or stripes 9–15). The opponent receives the other group.
- If both a solid and a stripe are pocketed on the same legal shot that triggers assignment, assign the group of whichever ball entered a pocket first (track pocket-entry order during the shot). If truly simultaneous, assign the group with more balls pocketed; if still tied, assign solids to the breaking player.
- Display each player's assigned group in the HUD immediately upon assignment (e.g., a colored label reading "Solids" or "Stripes" with a representative ball icon).

**Turn Continuity & Passing**
- A player's turn continues as long as they legally pocket at least one ball from their own assigned group on each shot.
- The turn passes to the opponent upon: (a) no ball being pocketed, (b) pocketing only opponent's ball(s), or (c) committing any foul. If a player legally pockets their own ball(s) *and* an opponent's ball on the same shot, the turn still passes (opponent's ball pocketed = loss of turn, though the opponent's ball stays pocketed).
- Before groups are assigned, any legally pocketed object ball continues the shooter's turn.

**Foul Conditions (all of these must be enforced)**
1. **Scratch**: Cue ball enters a pocket. Penalty: ball-in-hand for opponent anywhere on the table.
2. **Wrong first contact**: The cue ball's first contact with an object ball is an opponent's ball, or the 8-ball (when the player has not yet cleared their group). Penalty: ball-in-hand. Track first-contact during collision resolution.
3. **No rail after contact**: After the cue ball strikes a legal object ball, no ball (including the cue ball) contacts a cushion and no ball is pocketed. Penalty: ball-in-hand.
4. **No contact at all**: The cue ball fails to hit any object ball. Penalty: ball-in-hand.
5. **Pocketing the 8-ball early**: Pocketing the 8-ball before clearing all of one's assigned group balls is an **immediate loss** (not merely a foul).
6. **Scratch on the 8-ball shot**: Pocketing the 8-ball on a shot where the cue ball also scratches is an **immediate loss**.

When a foul occurs (except game-ending fouls), display a brief **foul notification** banner (auto-dismiss after 2 seconds or click-dismiss) stating the foul type, then transition to ball-in-hand for the opponent.

**8-Ball Endgame**
- Once a player has legally pocketed all 7 balls of their group, they **must** target the 8-ball on their subsequent shots. The first contact must be the 8-ball.
- Legally pocketing the 8-ball wins the game.
- Pocketing the 8-ball early or scratching while pocketing the 8-ball is a **loss**.

**Game Over**
- Display a result modal overlay: "Player X Wins!" with a **"Play Again"** button. Clicking "Play Again" re-racks, resets all state (scores, group assignments, turn order — alternate who breaks each game), and returns to `AWAITING_BREAK`.

---

### 🎯 Physics Engine (2D Rigid-Body Simulation)

**General Requirements**
- Implement a **custom physics engine in vanilla JavaScript**. Zero external libraries (no Matter.js, Box2D, p2.js, etc.).
- All physics constants must be declared as named constants at the top of the physics section for easy tuning.

**Table & Ball Dimensions (Logical Coordinate System)**
- Define a logical table playing surface of **1000 × 500 units** (interior felt dimensions, excluding rails). All positions, velocities, and radii operate in this coordinate space. The canvas renderer maps this to screen pixels.
- Ball radius: **12 units**. Pocket capture radius: **22 units** (corner pockets) and **20 units** (side pockets). Cushion rebound boundary: the ball rebounds when its center is within one ball-radius of the rail edge.
- Pocket center positions: four corners at `(cornerInset, cornerInset)`, `(1000−cornerInset, cornerInset)`, etc., with `cornerInset ≈ 8`; two side pockets at `(500, −2)` and `(500, 502)` (slightly beyond the rail to create a "mouth" effect). Tune insets so corner pockets feel tight and side pockets feel slightly narrower, matching real pool geometry.

**Fixed Timestep Loop**
- Use `requestAnimationFrame` for the render loop. Decouple physics from rendering using an **accumulator pattern** with a fixed timestep of `dt = 1/120 second`. Each render frame, consume the accumulated time in `dt`-sized physics steps, then render once. Cap the accumulator (e.g., max 8 steps per frame) to prevent spiral-of-death on slow devices.

**Ball-to-Ball Collisions**
- Detect collision when the distance between two ball centers ≤ 2 × ball radius.
- Resolve using **2D elastic collision** equations for equal-mass particles:
  - Compute the collision normal `n = normalize(posB − posA)`.
  - Compute relative velocity `vRel = velA − velB`.
  - Compute impulse scalar `j = dot(vRel, n)`. If `j > 0`, balls are separating — skip.
  - Apply velocity exchange: `velA −= j × n`, `velB += j × n`.
  - Apply a **coefficient of restitution** (e.g., `e = 0.96`) to the impulse to model slight energy loss.
- **Positional correction**: After resolving velocity, separate overlapping balls by pushing each along the collision normal by half the overlap distance. This prevents balls from sinking into each other over successive frames.

**Ball-to-Cushion Collisions**
- A cushion collision occurs when a ball's center is within one ball-radius of any rail boundary.
- Reflect the velocity component perpendicular to the rail, multiplied by a **rail restitution coefficient** (`e_rail ≈ 0.75`). Leave the parallel component unchanged (or apply a slight tangential friction factor of ~0.95).
- Apply positional correction: clamp the ball center to exactly one ball-radius from the rail.
- Handle **corner pocket entrances**: near pocket mouths, the cushion boundary "opens up." Balls approaching a pocket should not rebound off a phantom rail across the pocket opening. Define the cushion segments as line segments that terminate at the pocket mouths, not as a continuous rectangle.

**Friction & Deceleration**
- Each physics step, multiply each ball's velocity by a **rolling friction factor** (e.g., `0.991` per step at 120Hz). This produces a natural, gradual slowdown.
- When a ball's speed drops below a **rest threshold** (e.g., `0.3 units/step`), snap its velocity to zero. This prevents indefinite micro-drift.
- Tune friction so that a medium-power shot (roughly 50% power) propels the cue ball approximately ¾ of the table length before stopping.

**Pocketing**
- A ball is pocketed when its center enters any pocket's capture radius.
- On pocketing: immediately remove the ball from the physics simulation, record it in the game state (which player's tray, or the 8-ball result), and trigger a brief visual effect (e.g., the ball shrinks/fades into the pocket over ~150ms).
- If the cue ball is pocketed, flag a scratch foul.
- Track the **order** in which balls are pocketed each shot (needed for group assignment logic).

**Anti-Tunneling**
- At high velocities, a ball could skip over another ball or a rail in a single timestep. Mitigate this with **substep iteration**: if any ball's displacement in a single `dt` exceeds one ball-radius, subdivide that step into smaller increments (e.g., halve `dt` and double iterations) until displacement per substep < ball radius.

**Shot Settlement Detection**
- After a shot, the physics loop continues until **all balls have velocity magnitude below the rest threshold** for at least 5 consecutive physics steps. Only then transition the game state to `EVALUATING_SHOT_RESULT` (which applies rule logic) and then to the next player's `AIMING` or `BALL_IN_HAND_PLACEMENT` state.

---

### 🖱️ Player Controls & Interaction

**Aiming (state: `AIMING`)**
- When all balls are at rest and it is the current player's turn, render a **cue stick** that pivots around the cue ball. The stick's angle follows the mouse cursor position relative to the cue ball center. The shot direction is the vector from the cue ball toward the mouse.
- Draw a **dotted aiming guideline** (white, semi-transparent) from the cue ball center in the shot direction. The guideline extends until it hits:
  - An **object ball**: Draw the line to the contact point. At the contact point, render a **ghost ball** (semi-transparent circle at the position where the cue ball's center would be at the moment of impact). From the ghost ball, draw a short **deflection indicator** (a solid line, ~40 units long) showing the predicted path of the target ball post-impact (along the collision normal from ghost-ball center to target-ball center). Also draw a short indicator from the ghost ball showing the cue ball's predicted deflection direction (tangent line). Both indicators should be visually distinct (different dash patterns or colors).
  - A **cushion**: Draw the line to the rail contact point. Optionally show a reflected continuation line (dimmer) to help with bank-shot aiming.
- The guideline should **not** pass through balls. It terminates at the first obstacle.
- Limit the guideline maximum length to ~600 units (roughly half the table plus some) to prevent unrealistic full-table laser aiming.

**Power Control (state: `POWER_DRAG`)**
- The player **clicks** (mousedown) on or near the cue ball area to begin a power drag. On mousedown, transition to `POWER_DRAG` state.
- The player **drags backward** (away from the shot direction) to increase power. Map the drag distance to a power value from 0% to 100%.
- Display a **power meter bar** in the HUD that fills proportionally: green (0–33%), yellow (34–66%), red (67–100%).
- The **cue stick** visually pulls back from the cue ball proportionally to the power level during the drag, giving tactile feedback.
- On **mouseup** (release), execute the shot:
  1. Animate the cue stick thrusting forward toward the cue ball over ~80ms.
  2. Apply the velocity vector to the cue ball: direction = shot direction, magnitude = `power × MAX_SHOT_SPEED` (tune `MAX_SHOT_SPEED` so that 100% power launches the cue ball fast enough to scatter a full rack but not so fast that tunneling becomes unmanageable — around 25–30 units/step).
  3. Transition to `SHOT_IN_PROGRESS`. Hide the cue stick and aiming UI.
- If the player drags to 0% power (or clicks without dragging), do **not** execute a shot — return to `AIMING`.

**Ball-in-Hand Placement (state: `BALL_IN_HAND_PLACEMENT`)**
- After a scratch foul, the incoming player must place the cue ball before shooting.
- Render a **translucent ghost cue ball** that follows the mouse cursor over the table surface.
- On click, validate the placement: the cue ball center must be at least 2 × ball-radius from every other ball's center (no overlap). If valid, place the cue ball and transition to `AIMING`. If invalid, flash the ghost ball red briefly and reject the placement.
- The placement area is the **entire table** (open table ball-in-hand, not behind-the-head-string, per most bar/league rules).

**Mouse Coordinate Mapping**
- All mouse events must be translated from screen (CSS pixel) coordinates to the logical table coordinate system, accounting for canvas scaling, offset, and aspect-ratio preservation. Provide a utility function `screenToTable(clientX, clientY)` that handles this reliably.

---

### 🎨 Visual Design & Layout

**Canvas Rendering**
- Use a single **HTML5 `<canvas>`** element for all game-surface rendering: table felt, rails, pockets, pocket mouths, diamond sights, balls, cue stick, aiming guideline, ghost ball projections, and ball-in-hand ghost.
- Set a logical (backing) canvas resolution of **1200 × 680** pixels (table surface plus outer rail border area). The playable felt area sits centered within this, with ~40px of rail/wood border on each side.
- Use `ctx.save()` / `ctx.restore()` and coordinate transforms to separate table-space drawing from screen-space drawing.

**Canvas Responsiveness**
- CSS scales the canvas to fit the viewport width with `max-width: 1200px` and `width: 100%`, preserving aspect ratio via the `aspect-ratio` CSS property or a proportional padding trick. The canvas's internal resolution stays fixed; only its display size changes.
- Recalculate the screen-to-table coordinate mapping on `window.resize`.

**Table Appearance**
- **Felt**: Rich green fill (`#0a7e3d`).
- **Rails/cushions**: A slightly darker green inner strip (to suggest cushion rubber), bordered by dark wood-brown outer rails (`#4a2a0a`). Add a subtle 1px highlight along the top edge of the rails for a 3D bevel effect.
- **Pockets**: Black filled circles positioned at the six standard locations. Render a slightly larger dark gray "mouth" ring behind each pocket to suggest the pocket opening and leather net.
- **Diamond sights**: Small white or ivory dots along each rail at the standard 7 positions per long rail and 3 per short rail.
- **Foot spot**: A small dot on the felt where the apex ball racks.
- **Head string** (optional visual): A faint dotted line at the head-quarter of the table.

**Ball Rendering**
- Each ball is a filled circle with a high-quality appearance:
  - **Solid balls (1–7)**: Fully filled with the ball's color. Colors: 1 Yellow (`#FFC000`), 2 Blue (`#003DA5`), 3 Red (`#CE1126`), 4 Purple (`#4B0082`), 5 Orange (`#FF6600`), 6 Green (`#006B3F`), 7 Maroon (`#800000`).
  - **Stripe balls (9–15)**: White base with a **horizontal color band** (stripe) across the center third of the ball. Same color mapping as their solid counterpart (9 = Yellow stripe, 10 = Blue stripe, etc.).
  - **8-ball**: Black fill, white "8".
  - **Cue ball**: White fill, no number. Optionally a very faint off-white inner circle for depth.
- Render the **ball number** (white text on dark balls, black text on light balls) centered on each ball, appropriately sized (roughly 60% of ball diameter). Use a bold sans-serif font.
- Add a subtle **shadow** beneath each ball (a small, semi-transparent dark ellipse offset slightly down-right) to create depth.
- Add a small **specular highlight** (a tiny white arc or dot at the upper-left of each ball) to suggest a light source and shininess.

**Cue Stick Rendering**
- A tapered line (thick at the butt, thin at the tip) rendered from behind the cue ball through and past it. Color: wood brown with a lighter tip.
- During `POWER_DRAG`, the stick pulls back; the tip retracts away from the cue ball proportionally to power.
- During the strike animation, the stick thrusts forward quickly and then is hidden.

**HUD (HTML/CSS overlay, not on canvas)**
- Positioned above or below the canvas (not overlapping the playing surface).
- Elements:
  - **Current player indicator**: "Player 1's Turn" / "Player 2's Turn" with a distinct background color for each player.
  - **Group labels**: After assignment, display "Solids" or "Stripes" next to each player name with a representative ball color swatch.
  - **Pocketed ball trays**: Two rows (one per player), each displaying the balls that player has pocketed as small colored circles (~20px), rendered in HTML/CSS (or small canvases). These fill in as balls are pocketed.
  - **Power meter**: A horizontal bar (width ~200px, height ~16px) with a colored fill that responds in real-time during `POWER_DRAG`. Empty when not dragging.
  - **Foul / info banners**: A dismissible/auto-dismissing message area for foul notifications, group assignment announcements, and game status.

**Modals**
- **Game Start Modal**: Shown on initial load. Text: "8-Ball" title, brief instruction ("Player 1 breaks. Click and drag to shoot."), and a "Start Game" button. Dismiss on button click → transition to `AIMING` with Player 1 to break.
- **Foul Modal/Banner**: Brief overlay or banner (not a blocking modal). Shows foul type, auto-dismisses after 2 seconds.
- **Game Over Modal**: Centered overlay with a semi-transparent backdrop. "Player X Wins!" message, optionally the reason (e.g., "legally pocketed the 8-ball" / "opponent sank the 8-ball early"), and a "Play Again" button.
- All modals should have a smooth fade-in animation (CSS transition, ~200ms).

---

### 🏗️ File Architecture

**`index.html`**
- Semantic HTML5 structure.
- Contains: `<canvas id="gameCanvas">`, HUD container divs (player info, power meter, pocketed ball trays), modal container divs.
- Links `styles.css` in `<head>` and `game.js` via `<script src="game.js" defer></script>` before `</body>`.
- No inline styles. No inline JavaScript. No CDN links. No external resources.

**`styles.css`**
- All visual styling: page layout (flexbox centering), canvas container sizing, HUD layout and typography, modal styling (positioning, backdrop, fade animations), power meter appearance, pocketed-ball tray layout, current-player highlighting, foul banner styling.
- Use **CSS custom properties** for the color palette (e.g., `--felt-green`, `--rail-brown`, `--player1-color`, `--player2-color`) to enable easy theming.
- Include a `:root` block with all variables, sensible resets (`box-sizing: border-box`, margin/padding resets), and responsive breakpoints if needed.

**`game.js`**
- All game logic, physics, rendering, input handling, and state management. Organized into clearly commented sections or IIFEs/objects:
  1. **Constants & Configuration**: Table dimensions, ball radius, pocket positions, physics tuning constants, color mappings, max shot speed.
  2. **Game State Manager**: Current state (state machine), active player, group assignments, pocketed balls per player, foul flags, shot metadata (first contact, balls pocketed this shot, rails contacted).
  3. **Physics Engine**: Ball update loop, ball-ball collision detection and resolution, ball-rail collision, pocket detection, friction application, rest detection, anti-tunneling substeps.
  4. **Rendering**: `drawTable()`, `drawBalls()`, `drawCueStick()`, `drawAimingLine()`, `drawGhostBall()`, `drawBallInHandGhost()`. Each as a distinct function.
  5. **Input Handler**: `mousemove`, `mousedown`, `mouseup` listeners on the canvas. Coordinate translation. State-aware input gating.
  6. **Rule Engine**: `evaluateShotResult()` — called when all balls settle. Checks fouls, pocketing results, group assignment, turn continuation, win/loss conditions. Returns the next game state and active player.
  7. **UI Manager**: Functions to update the HUD (player indicator, group labels, pocketed ball trays, power meter), show/hide modals, display foul notifications.
  8. **Main Loop**: `requestAnimationFrame` callback, accumulator-based fixed timestep physics, render call.
  9. **Initialization**: `initGame()` sets up the rack, places the cue ball, resets state, attaches event listeners, shows the start modal.

---

### ⚙️ Technical Constraints

- **Vanilla JavaScript only**. Zero external dependencies — no frameworks (React, Vue), no libraries (jQuery, p5.js, Matter.js, Howler.js), no build tools (Webpack, Vite), no TypeScript, no npm packages. The three files must work by opening `index.html` in any modern browser via `file://` or a local server.
- **No ES module `import`/`export` between files**. All JS in a single `game.js` file loaded with `<script defer>`.
- **Performance**: Maintain 60fps with 16 balls in simultaneous motion. Use efficient collision detection (e.g., early-out distance checks before full resolution). Minimize canvas draw calls (batch similar operations, avoid unnecessary `save`/`restore` pairs in tight loops).
- **Browser compatibility**: Must work in current versions of Chrome, Firefox, Safari, and Edge. Use only widely supported Canvas 2D API methods and standard DOM APIs. No experimental features.
- **No sound required** (audio is explicitly out of scope to keep the implementation focused; do not include placeholder audio code).
- The game must be **completely playable end-to-end**: load page → start → break → group assignment → take turns → clear group → pocket 8-ball → win screen → play again → repeat. Every rule, every interaction, every visual element described above must function. Deliver complete code with no truncation, no `// TODO`, no `// implement later`, no ellipsis-abbreviated sections.

---

### 🧪 Edge Cases to Handle Explicitly

1. **8-ball pocketed on the break**: Not a loss. Re-spot the 8-ball on the foot spot (or nearest available position if the foot spot is occupied). The breaking player's turn continues (or ends normally if no other ball was pocketed).
2. **Cue ball pocketed on the break (scratch on break)**: Incoming player gets ball-in-hand. No group assignment occurs if no other ball was legally pocketed.
3. **Both a solid and stripe pocketed on the same assignment-triggering shot**: Assign based on first-pocketed or majority rule (as specified in Group Assignment section above).
4. **Simultaneous 8-ball pocket + scratch**: Shooting player loses.
5. **8-ball pocketed early (before group is cleared)**: Shooting player loses immediately.
6. **Ball resting on pocket lip**: Any ball whose center enters the pocket capture radius is pocketed — do not allow balls to "hang" on the edge indefinitely. If a ball is nearly in but outside the radius, it stays in play (this is correct and realistic).
7. **Cue ball frozen against another ball**: The player must still be able to aim freely (the aiming system uses angle-from-cue-ball, which works regardless of adjacent balls). The shot is legal as long as the contacted ball moves or any ball contacts a rail.
8. **All object balls pocketed except the 8-ball**: The current player (whose group is now fully cleared) transitions to the 8-ball phase. The opponent also transitions if their group is cleared. Handle both players being in the 8-ball phase simultaneously.
9. **Illegal break (fewer than 4 balls reach a cushion and nothing is pocketed)**: Re-rack and re-break with the same player. Display a brief notification.
10. **Cue ball launched off the table (extreme edge case)**: If the cue ball's position ever exits the playing surface bounds without entering a pocket, treat it as a scratch (ball-in-hand for opponent).

---

*Deliver all three complete files — `index.html`, `styles.css`, and `game.js` — with no truncation and no omitted sections. Every function, every rule, every visual element, and every interaction described in this specification must be fully implemented and operational in the delivered code.*