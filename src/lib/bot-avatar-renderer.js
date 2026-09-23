import * as THREE from "three";
import {
  createAvatarScene,
  animateAvatar,
  disposeAvatar,
} from "./bot-avatar-scene.js";

// One WebGL context for the entire app. Equal identity/configuration tiles share
// a render, then receive a 2D copy; a long roster never allocates dozens of GPUs.
const entries = new Map();
const scenes = new Map();
let renderer,
  frame = 0,
  previous = 0,
  elapsed = 0,
  failed = false;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const observer = new IntersectionObserver((records) => {
  for (const { target, isIntersecting } of records) {
    const entry = entries.get(target);
    if (entry) entry.visible = isIntersecting;
  }
  schedule();
});

function schedule() {
  if (!frame && !document.hidden && entries.size && !failed)
    frame = requestAnimationFrame(draw);
}
function release() {
  cancelAnimationFrame(frame);
  frame = 0;
  for (const scene of scenes.values()) disposeAvatar(scene);
  scenes.clear();
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = null;
  }
  previous = 0;
  failed = false;
}
function rendererForFrame() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const current = renderer;
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    if (renderer !== current) return;
    event.preventDefault();
    failed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    for (const entry of entries.values()) entry.onReady(false);
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    if (renderer !== current) return;
    failed = false;
    for (const entry of entries.values()) entry.dirty = true;
    schedule();
  });
  return renderer;
}
function draw(now) {
  frame = 0;
  if (document.hidden) return;
  // Smooth at 24 fps, bounded even on high-refresh monitors.
  if (now - previous < 1000 / 24) {
    schedule();
    return;
  }
  const dt = Math.min((now - previous) / 1000 || 0, 0.08);
  previous = now;
  if (!reduceMotion.matches) elapsed += dt;
  const groups = new Map();
  for (const [canvas, entry] of entries) {
    if (!entry.visible || !canvas.isConnected) continue;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const size = Math.min(
      480,
      Math.max(48, Math.ceil(rect.width * Math.min(devicePixelRatio, 2))),
    );
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = canvas.height = size;
      entry.dirty = true;
    }
    const key = JSON.stringify([entry.identity, entry.config]);
    if (!groups.has(key))
      groups.set(key, {
        size,
        entries: [],
        config: entry.config,
        activity: entry.activity,
      });
    const group = groups.get(key);
    group.size = Math.max(group.size, size);
    group.entries.push(entry);
  }
  try {
    if (groups.size) {
      const gpu = rendererForFrame();
      const frameSize = Math.max(...[...groups.values()].map((g) => g.size));
      gpu.setSize(frameSize, frameSize, false);
      gpu.setScissorTest(true);
      for (const [key, group] of groups) {
        let model = scenes.get(key);
        if (!model) {
          model = createAvatarScene(group.config);
          scenes.set(key, model);
        }
        if (
          reduceMotion.matches &&
          model.activity === group.activity &&
          group.entries.every((e) => !e.dirty)
        )
          continue;
        animateAvatar(model, group.activity, elapsed, dt, reduceMotion.matches);
        gpu.setViewport(0, 0, group.size, group.size);
        gpu.setScissor(0, 0, group.size, group.size);
        gpu.render(model.scene, model.camera);
        for (const entry of group.entries) {
          entry.context.clearRect(
            0,
            0,
            entry.canvas.width,
            entry.canvas.height,
          );
          entry.context.drawImage(
            gpu.domElement,
            0,
            frameSize - group.size,
            group.size,
            group.size,
            0,
            0,
            entry.canvas.width,
            entry.canvas.height,
          );
          if (entry.dirty) {
            entry.onReady(true);
            entry.dirty = false;
          }
        }
      }
    }
    // Evict scenes no longer associated with a mounted avatar, not just hidden
    // ones: scrolling should not rebuild every character.
    const liveKeys = new Set(
      [...entries.values()].map((e) => JSON.stringify([e.identity, e.config])),
    );
    for (const [key, scene] of scenes)
      if (!liveKeys.has(key)) {
        disposeAvatar(scene);
        scenes.delete(key);
      }
  } catch {
    failed = true;
    for (const entry of entries.values()) entry.onReady(false);
  }
  if (groups.size && !reduceMotion.matches) schedule();
}

export function registerAvatar(canvas, options) {
  const context = canvas.getContext("2d");
  if (!context) {
    options.onReady(false);
    return () => {};
  }
  entries.set(canvas, {
    ...options,
    canvas,
    context,
    visible: false,
    dirty: true,
  });
  observer.observe(canvas);
  schedule();
  const unregister = () => {
    observer.unobserve(canvas);
    entries.delete(canvas);
    if (!entries.size) release();
  };
  unregister.update = (next) => {
    const entry = entries.get(canvas);
    if (entry) Object.assign(entry, next, { dirty: true });
    schedule();
  };
  return unregister;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  } else schedule();
});
reduceMotion.addEventListener("change", () => {
  for (const entry of entries.values()) entry.dirty = true;
  schedule();
});
// CSS/layout can change a tile's size without remounting it.
window.addEventListener("resize", () => {
  for (const entry of entries.values()) entry.dirty = true;
  schedule();
});
