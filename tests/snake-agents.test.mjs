import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Coordinator } from '../runtime/coordinator.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function settled(c) {
  const deadline = Date.now() + 3000;
  while (c.snapshot().runs.some(r => ['running', 'queued', 'cancelling'].includes(r.status))) {
    if (Date.now() > deadline) throw new Error('Snake agent conversation did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('Mira and Sol collaborate on the Snake handoff through anyBot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anybot-snake-'));
  let miraId, solId, calls = 0;
  const c = new Coordinator({
    directory,
    probe: async () => [],
    concurrency: 1,
    runner: async ({ harness }) => {
      calls++;
      if (harness === 'codex' && calls === 1) return `Architecture approved.\n\`\`\`anybot\n${JSON.stringify({ type: 'delegate', employeeId: solId, objective: 'Define custom graphics and a readable mobile layout for Orbit Snake.' })}\n\`\`\``;
      if (harness === 'claude') return 'Custom graphics approved: neon orbital grid, glowing food orb, and responsive touch controls.';
      return 'SNAKE_HANDOFF_OK';
    },
  });
  try {
    await c.initialize();
    await c.command('employees.create', { name: 'Mira', role: 'Snake Architect', harness: 'codex', trusted: true });
    await c.command('employees.create', { name: 'Sol', role: 'Snake Artist', harness: 'claude', trusted: true });
    [miraId, solId] = c.snapshot().employees.map(e => e.id);
    await c.command('conversations.create', { title: 'Orbit Snake build', members: [miraId, solId], delegation: true });
    const conversation = c.snapshot().conversations[0];
    await c.command('messages.send', { conversation: conversation.id, body: 'Build a playable Snake game with high scores and custom graphics.', recipients: [miraId], requestId: 'snake-agent-test' });
    await settled(c);
    const messages = c.snapshot().messages.map(m => m.body).join('\n');
    assert.equal(calls, 3);
    assert.match(messages, /Custom graphics approved/);
    assert.match(messages, /SNAKE_HANDOFF_OK/);
    assert.equal(c.snapshot().runs.filter(r => r.status === 'succeeded').length, 3);
    const transcript = JSON.parse(await readFile('games/snake/agent-conversation.json', 'utf8'));
    assert.deepEqual(transcript.participants.map(a => a.name), ['Mira', 'Sol']);
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  }
});
