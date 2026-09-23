import test from "node:test";
import assert from "node:assert/strict";
import {
  createAvatarScene,
  animateAvatar,
  disposeAvatar,
} from "../src/lib/bot-avatar-scene.js";

for (const shape of ["scout", "orbit", "tinker"]) {
  test(`${shape}: real model turns, reveals its screen, waves, then settles`, () => {
    const model = createAvatarScene({ shape, color: "violet", face: "open" });
    try {
      assert.ok(Math.abs(model.bot.rotation.y + Math.PI / 6) < 1e-9);
      assert.equal(model.hologram.visible, false);
      for (let i = 0; i < 100; i++)
        animateAvatar(model, "working", i / 24, 1 / 24);
      assert.ok(Math.abs(model.bot.rotation.y + (55 * Math.PI) / 180) < 1e-5);
      assert.ok(model.hologram.visible && model.hologram.scale.y > 0.99);
      for (let i = 0; i < 100; i++)
        animateAvatar(model, "unread", i / 24, 1 / 24);
      assert.ok(Math.abs(model.bot.rotation.y) < 1e-5);
      assert.equal(model.hologram.visible, false);
      assert.ok(model.arms[1].rotation.z > 1.8);
      for (let i = 0; i < 100; i++)
        animateAvatar(model, "idle", i / 24, 1 / 24);
      assert.ok(Math.abs(model.bot.rotation.y + Math.PI / 6) < 1e-5);
      assert.ok(model.arms[1].rotation.z < 0.2);
      // Reduced motion uses a static, recognizable working/greeting pose.
      animateAvatar(model, "working", 20, 0.01, true);
      assert.equal(model.reveal, 1);
      const positions = model.arms.map((a) => a.rotation.toArray());
      animateAvatar(model, "working", 90, 0.01, true);
      assert.deepEqual(
        model.arms.map((a) => a.rotation.toArray()),
        positions,
      );
    } finally {
      disposeAvatar(model);
    }
  });
}
test("disposing one avatar does not invalidate geometry shared by another", () => {
  const config = { shape: "scout", color: "coral", face: "open" };
  const a = createAvatarScene(config),
    b = createAvatarScene(config);
  const geometry = a.eyes[0].geometry;
  assert.equal(geometry, b.eyes[0].geometry);
  let disposed = 0;
  geometry.addEventListener("dispose", () => disposed++);
  disposeAvatar(a);
  assert.equal(disposed, 0);
  disposeAvatar(b);
  assert.equal(disposed, 1);
});
