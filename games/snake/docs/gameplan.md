# Orbit Snake gameplan

## Objective

Ship a small, self-contained Snake game as an anyBot artifact test. Two AI employees collaborate on the design and visual direction, while the final artifact remains deterministic, playable, and easy to inspect locally.

## Core loop

The player guides a glowing snake around a 24x24 arena, eats energy orbs, grows, and survives as long as possible. Each orb awards 10 points; speed increases every five orbs. Hitting the wall or the snake ends the run. A run can be paused and restarted.

## Acceptance criteria

- Keyboard and touch/swipe controls move the snake without allowing instant reversal.
- Food increases length and score; collisions end the run.
- Local high scores survive reload and show the top five runs.
- Canvas graphics are procedural and custom: starfield, neon grid, glowing orb, snake face, trail particles, and game-state overlays.
- The game is playable at desktop and phone widths with no horizontal page overflow.
- Two named agent roles are recorded in `agent-conversation.json` and agree on the gameplay, art, and verification plan.
