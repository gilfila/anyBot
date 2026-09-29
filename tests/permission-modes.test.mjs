// What the bot editor says each permission mode does, per harness. It must
// match what invocation() (runtime/adapters.mjs) actually passes.
import test from "node:test";
import assert from "node:assert/strict";
import { permissionChoices } from "../runtime/permission-modes.mjs";
import { invocation } from "../runtime/adapters.mjs";

const labels = (harness) => Object.fromEntries(permissionChoices(harness).options.map((o) => [o.value, o.label]));

test("every harness offers the three modes, in the same order", () => {
  for (const harness of ["claude", "codex", "antigravity", "cursor", "hermes", "my-custom-cli"])
    assert.deepEqual(permissionChoices(harness).options.map((o) => o.value), ["auto", "dontAsk", "ask"], harness);
});

test("only Claude Code's labels promise that it asks you", () => {
  assert.match(labels("claude").auto, /ask you/);
  for (const harness of ["codex", "antigravity", "cursor", "hermes"])
    for (const label of Object.values(labels(harness))) assert.doesNotMatch(label, /(?<!nothing )asks? you|Ask before/, `${harness}: ${label}`);
  assert.match(permissionChoices("claude").hint, /approval requests to the chat/);
});

test("the labels say what each harness really does", () => {
  // Codex: a sandbox per mode, never lifted.
  assert.ok(invocation("codex", "", "ask").includes("read-only"));
  assert.match(labels("codex").ask, /Read-only/);
  assert.ok(invocation("codex", "", "dontAsk").includes("sandbox_workspace_write.network_access=true"));
  assert.match(labels("codex").dontAsk, /network/);
  assert.match(permissionChoices("codex").hint, /can't ask you/);
  // Antigravity and Cursor run everything under dontAsk.
  assert.ok(invocation("antigravity", "", "dontAsk").includes("--dangerously-skip-permissions"));
  assert.match(labels("antigravity").dontAsk, /Everything runs, nothing asks you/);
  assert.ok(invocation("cursor", "", "dontAsk").includes("--force"));
  assert.match(labels("cursor").dontAsk, /Everything runs/);
  // Cursor's Auto and Ask are the same command; Hermes ignores the mode.
  assert.deepEqual(invocation("cursor", "", "auto"), invocation("cursor", "", "ask"));
  assert.match(permissionChoices("cursor").hint, /Auto and Ask are the same/);
  assert.deepEqual(invocation("hermes", "", "auto"), invocation("hermes", "", "ask"));
  assert.match(permissionChoices("hermes").hint, /own permission settings/);
  assert.match(permissionChoices("my-custom-cli").hint, /own command line/);
});
