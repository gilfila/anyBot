import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { createMobileGateway } from "../runtime/mobile-gateway.mjs";
let vite, gateway, c, directory, origin;
// Stand-in for the desktop voice service (desktop/voice.cjs). Tests flip
// `cloud` to exercise the ElevenLabs-through-the-desktop path.
const voice = {
  cloud: false,
  calls: [],
  settings: () => ({ stt: "elevenlabs", tts: "elevenlabs", elevenlabs: { configured: voice.cloud } }),
  transcribe: async ({ audio, mime }) => {
    voice.calls.push(["transcribe", mime, audio.length]);
    return { text: "Give me the next step." };
  },
  speak: async ({ text, employeeId }) => {
    voice.calls.push(["speak", text, employeeId]);
    return { audio: new Uint8Array([0]), mime: "audio/mpeg" };
  },
};
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "anybot-mobile-ui-"));
  c = new Coordinator({
    directory,
    probe: async () => [],
    runner: async () => "Mobile test response — safe <script>text</script>.",
  });
  await c.initialize();
  await c.command("employees.create", {
    name: "Morgan",
    role: "Software engineer",
    harness: "codex",
    trusted: true,
  });
  await c.command("employees.create", {
    name: "Sage",
    role: "Research analyst",
    harness: "claude",
    trusted: true,
  });
  gateway = createMobileGateway({
    command: (...args) => c.command(...args),
    voice,
    allowInsecureLoopback: true,
    origins: ["http://127.0.0.1:5174"],
    members: [
      { id: "owner", name: "Workspace owner", role: "owner" },
      { id: "alice", name: "Alice", role: "member" },
    ],
  });
  const address = await gateway.listen();
  origin = `http://127.0.0.1:${address.port}`;
  vite = await createServer({ configFile: "mobile/vite.config.mjs" });
  await vite.listen();
});
test.afterAll(async () => {
  await vite?.close();
  await gateway?.close();
  await c?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test("phone connects, creates a team conversation, sends once after an uncertain response, and disconnects", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5174");
  await page.screenshot({
    path: "test-results/mobile-connect.png",
    fullPage: true,
  });
  await page.getByLabel("Workspace address").fill(origin);
  await page.getByRole("textbox", { name: "Connection code", exact: true }).fill(gateway.createPairing().code);
  await page.getByRole("button", { name: "Connect to my team" }).click();
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.getByLabel("Conversation name").fill("Mobile launch plan");
  await page.getByLabel("Morgan").check();
  await page.getByLabel("Sage").check();
  await expect(page.getByText("Share with humans")).toBeVisible();
  await page.getByLabel("Alice").check();
  await page.getByLabel("Allow handoffs").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(
    page.getByRole("heading", { name: "Mobile launch plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dictate message", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Message your team")
    .fill("Outline the first three launch steps.");
  let lost = false;
  await page.route("**/messages", async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Retry sends the same request",
  );
  await page
    .getByRole("button", { name: "Retry message", exact: true })
    .click();
  await expect(
    page.getByText("Mobile test response — safe <script>text</script>.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(c.snapshot().runs).toHaveLength(1);
  await page.screenshot({
    path: "test-results/mobile-conversation.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await page.getByLabel("Conversation name").fill("Mobile private chat");
  await page.getByLabel("Morgan").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(
    page.getByRole("heading", { name: "Mobile private chat" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start voice chat", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Disconnect and clear this device" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect your workspace" }),
  ).toBeVisible();
  expect(gateway.devices()).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("one-to-one voice chat sends a transcript and speaks the employee reply", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let heard = false;
    class FakeRecognition {
      start() {
        // Say one thing; later listening sessions stay silent.
        if (heard) return;
        heard = true;
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: "Give me the next step." } }],
          });
          setTimeout(() => this.onend?.(), 50);
        }, 20);
      }
      stop() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    window.__spoken = [];
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: function (text) {
        this.text = text;
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (utterance) => {
          window.__spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 10);
        },
        cancel: () => {},
      },
    });
  });
  await page.goto("http://127.0.0.1:5174");
  await page.getByLabel("Workspace address").fill(origin);
  await page.getByRole("textbox", { name: "Connection code", exact: true }).fill(gateway.createPairing().code);
  await page.getByRole("button", { name: "Connect to my team" }).click();
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await page.getByLabel("Conversation name").fill("Voice check");
  await page.getByLabel("Morgan").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page.getByRole("heading", { name: "Voice check" })).toBeVisible();
  await page.getByRole("button", { name: "Start voice chat", exact: true }).click();
  await expect(page.getByText("Mobile test response — safe <script>text</script>.", { exact: true })).toBeVisible();
  // The spoken reply is a cleaned-up summary: markup is never read aloud.
  await expect.poll(() => page.evaluate(() => window.__spoken)).toContain(
    "Mobile test response — safe text.",
  );
});

test("with ElevenLabs on the desktop, the phone records audio and speaks in the bot's voice", async ({
  page,
}) => {
  voice.cloud = true;
  voice.calls.length = 0;
  try {
    await page.goto("http://127.0.0.1:5174");
    await page.getByLabel("Workspace address").fill(origin);
    await page.getByRole("textbox", { name: "Connection code", exact: true }).fill(gateway.createPairing().code);
    await page.getByRole("button", { name: "Connect to my team" }).click();
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await page.getByLabel("Conversation name").fill("Cloud voice");
    await page.getByLabel("Morgan").check();
    await page.getByRole("button", { name: "Create conversation" }).click();
    await expect(page.getByRole("heading", { name: "Cloud voice" })).toBeVisible();
    await page.getByRole("button", { name: "Start voice chat", exact: true }).click();
    await expect.poll(() => voice.calls.filter(([kind]) => kind === "speak").map(([, text]) => text), { timeout: 20000 })
      .toContain("Mobile test response — safe text.");
    const [transcribe] = voice.calls;
    expect(transcribe[0]).toBe("transcribe");
    expect(transcribe[1]).toBe("audio/webm");
    expect(transcribe[2]).toBeGreaterThan(1000);
    const morgan = (await c.command("snapshot")).employees.find((e) => e.name === "Morgan").id;
    expect(voice.calls.filter(([kind]) => kind === "speak")).toEqual([
      ["speak", "On it.", morgan],
      ["speak", "Mobile test response — safe text.", morgan],
    ]);
    await expect(page.getByText("Give me the next step.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop voice chat" }).click();
    await expect(page.getByRole("button", { name: "Start voice chat", exact: true })).toBeVisible();
  } finally {
    voice.cloud = false;
  }
});
