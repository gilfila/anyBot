import test from "node:test";
import assert from "node:assert/strict";
import { anchoredScroll, clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM, stepZoom, wheelZoom } from "../src/lib/zoom.js";

test("zoom steps move to the next preset and stop at the limits", () => {
  assert.equal(stepZoom(1, 1), 1.1);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(0.8, -1), 0.75);
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
  assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM);
  assert.equal(clampZoom("nonsense"), 1);
  assert.equal(clampZoom(9), MAX_ZOOM);
});

test("fit shows the whole chart without enlarging a small one", () => {
  // 45 bots: a wide chart in a normal window.
  assert.equal(fitZoom({ width: 5000, height: 900 }, { width: 1032, height: 700 }), 0.2);
  assert.ok(Math.abs(fitZoom({ width: 2000, height: 900 }, { width: 1032, height: 700 }) - 0.5) < 0.001);
  assert.equal(fitZoom({ width: 400, height: 300 }, { width: 1200, height: 800 }), 1);
  assert.equal(fitZoom({ width: 0, height: 0 }, { width: 1200, height: 800 }), 1);
});

test("pinch and ctrl+wheel zoom smoothly in the right direction", () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
  assert.equal(wheelZoom(MAX_ZOOM, -5000), MAX_ZOOM);
});

test("the point under the pointer stays put when zooming", () => {
  // Content point under the pointer: (scroll + offset) / zoom = (100+200)/1 = 300.
  const next = anchoredScroll({ left: 100, top: 50 }, { x: 200, y: 100 }, 1, 2);
  assert.equal((next.left + 200) / 2, 300);
  assert.equal((next.top + 100) / 2, 150);
  assert.deepEqual(anchoredScroll({ left: 0, top: 0 }, { x: 10, y: 10 }, 1, 0.5), { left: 0, top: 0 });
});
