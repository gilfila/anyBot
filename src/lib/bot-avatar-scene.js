import * as T from "three";
import { avatarColors, avatarPose } from "./avatar-config.js";
const geometryPool = new Map();
const geometryReferences = new Map();
function rounded(w, h, d, r) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const key = `rounded:${w}:${h}:${d}:${r}`;
  if (geometryPool.has(key)) return geometryPool.get(key);
  const g = new T.BoxGeometry(w, h, d, 24, 24, 24),
    p = g.attributes.position,
    n = g.attributes.normal,
    v = new T.Vector3(),
    c = new T.Vector3(),
    delta = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(
      T.MathUtils.clamp(v.x, -w / 2 + r, w / 2 - r),
      T.MathUtils.clamp(v.y, -h / 2 + r, h / 2 - r),
      T.MathUtils.clamp(v.z, -d / 2 + r, d / 2 - r),
    );
    delta.subVectors(v, c).normalize();
    v.copy(c).addScaledVector(delta, r);
    p.setXYZ(i, v.x, v.y, v.z);
    n.setXYZ(i, delta.x, delta.y, delta.z);
  }
  g.userData.avatarKey = key;
  return g;
}
function part(group, geo, mat, x = 0, y = 0, z = 0) {
  const key =
    geo.userData.avatarKey || `${geo.type}:${JSON.stringify(geo.parameters)}`;
  const cached = geometryPool.get(key);
  if (cached && cached !== geo) {
    geo.dispose();
    geo = cached;
  }
  geo.userData.avatarKey = key;
  geometryPool.set(key, geo);
  geometryReferences.set(geo, (geometryReferences.get(geo) || 0) + 1);
  const o = new T.Mesh(geo, mat);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  group.add(o);
  return o;
}
function box(g, m, w, h, d, r, x = 0, y = 0, z = 0) {
  return part(g, rounded(w, h, d, r), m, x, y, z);
}
function ball(g, m, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const o = part(g, new T.SphereGeometry(r, 40, 28), m, x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}
function joint(g, x, y, z) {
  const o = new T.Group();
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
function ring(g, m, r, t, x, y, z) {
  return part(g, new T.TorusGeometry(r, t, 16, 64), m, x, y, z);
}
export function createAvatarScene(config) {
  const index = { scout: 0, orbit: 1, tinker: 2 }[config.shape] ?? 0;
  const color =
    avatarColors.find((c) => c.id === config.color)?.fill ||
    avatarColors[0].fill;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(33, 1, 0.1, 100);
  camera.position.set(0, 2.3, 6.7);
  camera.lookAt(0, 1.47, 0);
  scene.add(new T.HemisphereLight("#edf3ff", "#858095", 1.65));
  const key = new T.DirectionalLight("#ffffff", 3.4);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const fill = new T.DirectionalLight("#b4c7ff", 1.8);
  fill.position.set(4, 2, -3);
  scene.add(fill);
  const soft = new T.DirectionalLight("#fff1df", 0.8);
  soft.position.set(3, 3, 5);
  scene.add(soft);
  const shell = new T.MeshPhysicalMaterial({
    color: color,
    roughness: 0.3,
    metalness: 0.03,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  const rim = new T.MeshStandardMaterial({
    color: new T.Color(color).lerp(new T.Color("#ffffff"), 0.38),
    roughness: 0.42,
  });
  const dark = new T.MeshPhysicalMaterial({
    color: "#171d2d",
    roughness: 0.27,
    metalness: 0.16,
    clearcoat: 0.7,
  });
  const jointMat = new T.MeshStandardMaterial({
    color: "#41465c",
    roughness: 0.58,
  });
  const white = new T.MeshStandardMaterial({
    color: "#f1f1f6",
    roughness: 0.4,
  });
  const glow = new T.MeshStandardMaterial({
    color: "#e8f7ff",
    emissive: "#92bfff",
    emissiveIntensity: 0.28,
    roughness: 0.22,
  });
  const bot = joint(scene, 0, 0, 0),
    body = joint(bot, 0, 0, 0);
  let head,
    arms = [],
    eyes = [],
    pupils = [],
    feet = [];
  if (index === 0) {
    box(body, shell, 0.85, 0.79, 0.62, 0.2, 0, 0.92, 0);
    box(body, rim, 0.52, 0.36, 0.09, 0.035, 0, 0.94, 0.33);
    box(body, dark, 0.16, 0.055, 0.025, 0.012, 0, 1.03, 0.39);
    ball(body, jointMat, 0.15, 0, 1.4, 0, 1, 0.8, 1);
    for (const side of [-1, 1]) {
      box(body, jointMat, 0.19, 0.28, 0.25, 0.07, side * 0.23, 0.4, 0);
      feet.push(
        box(body, shell, 0.4, 0.25, 0.59, 0.11, side * 0.25, 0.18, 0.12),
      );
      box(body, dark, 0.38, 0.055, 0.53, 0.022, side * 0.25, 0.07, 0.13);
      const a = joint(body, side * 0.51, 1.19, 0);
      ball(a, jointMat, 0.13);
      box(a, shell, 0.25, 0.55, 0.3, 0.12, side * 0.035, -0.26, 0);
      ball(a, rim, 0.145, side * 0.035, -0.52, 0.025, 1, 1.07, 0.9);
      arms.push(a);
    }
    head = joint(body, 0, 1.94, 0);
    box(head, shell, 1.58, 1.15, 1.05, 0.26);
    box(head, rim, 1.25, 0.83, 0.15, 0.07, 0, -0.015, 0.486);
    box(head, dark, 1.15, 0.72, 0.18, 0.087, 0, 0.005, 0.559);
    for (const side of [-1, 1]) {
      const e = box(
        head,
        glow,
        0.13,
        0.29,
        0.056,
        0.027,
        side * 0.26,
        0.04,
        0.666,
      );
      eyes.push(e);
      box(head, shell, 0.18, 0.45, 0.43, 0.085, side * 0.83, -0.045, -0.04);
    }
    box(head, rim, 0.11, 0.23, 0.11, 0.045, 0.42, 0.67, -0.05);
    ball(head, shell, 0.115, 0.42, 0.83, -0.05);
    box(head, glow, 0.22, 0.035, 0.03, 0.013, 0, -0.16, 0.666);
  } else if (index === 1) {
    ball(body, shell, 0.48, 0, 0.96, 0, 1, 0.92, 0.84);
    ring(body, dark, 0.27, 0.055, 0, 0.65, 0).rotation.x = Math.PI / 2;
    ring(body, rim, 0.31, 0.043, 0, 1.17, 0).rotation.x = Math.PI / 2;
    ball(body, white, 0.19, 0, 0.89, 0.37, 1, 0.7, 0.25);
    box(body, dark, 0.11, 0.04, 0.02, 0.009, 0, 0.9, 0.422);
    for (const side of [-1, 1]) {
      const a = joint(body, side * 0.68, 1.12, 0.02);
      ball(a, shell, 0.19, 0, -0.07, 0, 0.82, 1.5, 0.9);
      box(a, rim, 0.16, 0.07, 0.24, 0.03, 0, -0.2, 0.02);
      arms.push(a);
      const fin = box(
        body,
        shell,
        0.2,
        0.38,
        0.43,
        0.08,
        side * 0.42,
        0.88,
        -0.05,
      );
      fin.rotation.z = -side * 0.35;
    }
    head = joint(body, 0, 1.94, 0);
    ball(head, shell, 0.84, 0, 0, 0, 1, 0.83, 0.91);
    box(head, rim, 1.26, 0.78, 0.24, 0.11, 0, -0.055, 0.57);
    box(head, dark, 1.14, 0.65, 0.22, 0.105, 0, -0.05, 0.692);
    for (const side of [-1, 1]) {
      eyes.push(
        box(head, glow, 0.13, 0.25, 0.065, 0.03, side * 0.23, -0.015, 0.817),
      );
      ball(head, rim, 0.23, side * 0.78, -0.07, -0.07, 0.3, 1, 1);
      ring(head, dark, 0.12, 0.028, side * 0.834, -0.07, -0.07).rotation.y =
        Math.PI / 2;
    }
    box(head, glow, 0.16, 0.032, 0.025, 0.011, 0, -0.18, 0.82);
    box(head, rim, 0.24, 0.06, 0.2, 0.025, 0, 0.68, -0.1);
  } else {
    box(body, shell, 1.02, 0.83, 0.75, 0.17, 0, 0.99, 0);
    box(body, rim, 0.63, 0.37, 0.13, 0.06, 0, 1.0, 0.37);
    for (const x of [-0.12, 0, 0.12])
      box(body, dark, 0.045, 0.16, 0.025, 0.01, x, 1.02, 0.444);
    for (const side of [-1, 1]) {
      box(body, jointMat, 0.22, 0.29, 0.3, 0.065, side * 0.3, 0.43, 0);
      feet.push(
        box(body, shell, 0.45, 0.28, 0.65, 0.1, side * 0.33, 0.17, 0.13),
      );
      box(body, dark, 0.43, 0.05, 0.59, 0.02, side * 0.33, 0.05, 0.14);
      const a = joint(body, side * 0.63, 1.2, 0);
      ball(a, jointMat, 0.145);
      box(a, shell, 0.27, 0.39, 0.3, 0.1, side * 0.065, -0.19, 0);
      ball(a, jointMat, 0.11, side * 0.075, -0.4, 0);
      box(a, shell, 0.29, 0.2, 0.33, 0.08, side * 0.075, -0.53, 0.035);
      arms.push(a);
    }
    box(body, jointMat, 0.32, 0.18, 0.31, 0.06, 0, 1.47, 0);
    head = joint(body, 0, 1.99, 0);
    box(head, shell, 1.6, 0.93, 0.89, 0.22);
    box(head, rim, 1.4, 0.72, 0.12, 0.05, 0, 0, 0.433);
    for (const side of [-1, 1]) {
      const lens = joint(head, side * 0.34, 0.015, 0.53);
      part(lens, new T.CylinderGeometry(0.29, 0.31, 0.2, 48), dark).rotation.x =
        Math.PI / 2;
      ring(lens, rim, 0.284, 0.035, 0, 0, 0.12);
      ball(lens, glow, 0.224, 0, 0, 0.105, 1, 1, 0.26);
      const p = ball(lens, dark, 0.112, 0.025, 0, 0.16, 1, 1.15, 0.28);
      pupils.push(p);
      eyes.push(lens);
      box(head, shell, 0.16, 0.39, 0.39, 0.075, side * 0.84, -0.03, -0.05);
    }
    box(head, dark, 0.18, 0.043, 0.03, 0.012, 0, -0.29, 0.516);
  }

  // The screen lives in the robot's forward space and turns with the character.
  const hologram = joint(bot, 0, 1.18, 1.02);
  hologram.rotation.x = -0.18;
  const glass = new T.MeshBasicMaterial({
    color: "#39c6ef",
    transparent: true,
    opacity: 0.18,
    side: T.DoubleSide,
    depthWrite: false,
  });
  const light = new T.MeshBasicMaterial({
    color: "#16a8d8",
    transparent: true,
    opacity: 0.92,
    side: T.DoubleSide,
    depthWrite: false,
  });
  part(hologram, new T.PlaneGeometry(1.28, 0.83), glass).renderOrder = 3;
  for (const y of [-0.415, 0.415])
    box(hologram, light, 1.3, 0.024, 0.024, 0.009, 0, y, 0).renderOrder = 4;
  for (const x of [-0.64, 0.64])
    box(hologram, light, 0.024, 0.83, 0.024, 0.009, x, 0, 0).renderOrder = 4;
  for (let n = 0; n < 3; n++)
    box(
      hologram,
      light,
      0.68 - n * 0.12,
      0.028,
      0.015,
      0.006,
      -0.13 - n * 0.06,
      0.21 - n * 0.16,
      0.014,
    ).renderOrder = 4;
  const scan = box(hologram, light, 1.1, 0.018, 0.02, 0.007, 0, -0.27, 0.025);
  scan.renderOrder = 4;
  // Keep selectable expressions on the approved faceplates.
  const happy = [];
  if (index < 2 && config.face === "bright")
    for (const e of eyes) {
      const arc = part(
        head,
        new T.TorusGeometry(0.068, 0.026, 8, 20, Math.PI),
        glow,
        e.position.x,
        e.position.y,
        e.position.z,
      );
      happy.push(arc);
      e.visible = false;
    }
  if (index === 2 && config.face === "bright")
    for (const pupil of pupils) {
      const arc = part(
        pupil.parent,
        new T.TorusGeometry(0.095, 0.034, 8, 20, Math.PI),
        dark,
        0.025,
        -0.025,
        0.195,
      );
      happy.push(arc);
      pupil.visible = false;
    }
  const model = {
    scene,
    camera,
    bot,
    body,
    head,
    arms,
    eyes,
    pupils,
    shell,
    rim,
    index,
    config,
    hologram,
    glass,
    light,
    scan,
    happy,
    activity: null,
    reveal: 0,
  };
  bot.rotation.y = avatarPose("idle").yaw;
  hologram.visible = false;
  return model;
}

export function animateAvatar(m, activity, t, dt, reduced = false) {
  const target = avatarPose(activity),
    mix = reduced ? 1 : 1 - Math.exp(-dt * 7);
  m.activity = activity;
  m.bot.rotation.y += (target.yaw - m.bot.rotation.y) * mix;
  m.reveal += (target.hologram - m.reveal) * mix;
  m.hologram.visible = m.reveal > 0.015;
  m.hologram.scale.set(1, Math.max(0.001, m.reveal), 1);
  m.glass.opacity = 0.18 * m.reveal;
  m.light.opacity = 0.92 * m.reveal;
  m.scan.position.y = reduced ? -0.27 : Math.sin(t * 1.8) * 0.28;
  const active = activity === "working",
    hello = activity === "unread";
  const breath = reduced ? 0 : Math.sin(t * 1.6);
  m.body.position.y =
    m.index === 1
      ? 0.04 + (reduced ? 0 : Math.sin(t * 1.7) * 0.07)
      : active && !reduced
        ? Math.abs(Math.sin(t * 3)) * 0.024
        : breath * 0.01;
  m.body.rotation.z = m.index === 1 && !reduced ? Math.sin(t * 1.2) * 0.025 : 0;
  // Face the user directly when unread; look down at the projected work otherwise.
  m.head.rotation.y = hello ? 0 : reduced ? 0 : Math.sin(t * 0.7) * 0.045;
  m.head.rotation.x += ((active ? 0.12 : 0) - m.head.rotation.x) * mix;
  m.head.rotation.z = hello
    ? 0
    : reduced
      ? 0
      : Math.sin(t * (active ? 2 : 0.9)) * (active ? 0.025 : 0.04);
  m.arms.forEach((a, n) => {
    const side = n === 0 ? -1 : 1;
    const wave = hello && n === 1;
    const burst = t % 6 < 2.4;
    const z = wave
      ? 2.1 + (reduced || !burst ? 0 : Math.sin(t * 7) * 0.22)
      : side * (active ? 0.08 : 0.1 + breath * 0.025);
    a.rotation.z += (z - a.rotation.z) * mix;
    const x = active
      ? -0.95 + (reduced ? 0 : Math.cos(t * 4 + n * 2) * 0.13)
      : wave
        ? -0.2
        : 0;
    a.rotation.x += (x - a.rotation.x) * mix;
    a.position.z += ((active ? 0.24 : 0.02) - a.position.z) * mix;
  });
  const blink = t % 5.6;
  const blinkScale = !reduced && blink > 4.7 && blink < 4.87 ? 0.13 : 1;
  const faceScale = m.config.face === "focused" ? 0.4 : 1;
  m.eyes.forEach((e) => {
    if (m.index !== 2) e.scale.y = blinkScale * faceScale;
  });
  m.happy.forEach((e) => (e.scale.y = blinkScale));
  m.pupils.forEach((p) => {
    p.position.x = hello
      ? 0.025
      : 0.025 + (reduced ? 0 : Math.sin(t * 0.7) * 0.025);
    p.scale.y = 1.15 * blinkScale * faceScale;
  });
}

export function disposeAvatar(model) {
  const materials = new Set();
  model.scene.traverse((o) => {
    if (o.geometry) {
      const count = (geometryReferences.get(o.geometry) || 1) - 1;
      if (count) geometryReferences.set(o.geometry, count);
      else {
        geometryReferences.delete(o.geometry);
        geometryPool.delete(o.geometry.userData.avatarKey);
        o.geometry.dispose();
      }
    }
    if (o.material) materials.add(o.material);
  });
  for (const m of materials) m.dispose();
}
