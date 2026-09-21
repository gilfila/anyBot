# Orbit Snake technical plan

Orbit Snake uses plain HTML, CSS, and a single browser Canvas 2D runtime. It has no network dependency, framework dependency, or remote asset. `game.js` owns simulation state, input, persistence, and rendering; CSS owns the responsive shell and controls. Local storage stores only the public high-score list under a namespaced key.

The fixed logical board is 24x24 cells. Rendering scales the canvas to its CSS size while preserving a square aspect ratio. The simulation advances on a fixed tick schedule so the same input sequence produces the same result. `requestAnimationFrame` drives rendering and timing, while a bounded particle list provides visual feedback without affecting collisions.
