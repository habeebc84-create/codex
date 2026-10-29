import { describe, expect, it } from 'vitest';
import { Store } from '../src/db/store.js';
import { processIncomingEvent } from '../src/services/realtime/pipeline.js';
import { ChatSimulator, mulberry32 } from '../src/services/realtime/simulator.js';

function makeCtx() {
  const store = new Store(':memory:');
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const ctx = {
    store,
    broadcast: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    },
    aiEnabled: false,
  };
  return { store, emitted, ctx };
}

describe('event pipeline', () => {
  it('stores a message, its analysis, and broadcasts chat + insights events', async () => {
    const { store, emitted, ctx } = makeCtx();
    const { message, analysis } = await processIncomingEvent(
      { username: 'pixel_fox', text: 'great stream today!', channel: 'demo', source: 'demo' },
      ctx,
    );
    expect(message.username).toBe('pixel_fox');
    expect(analysis.riskCategory).toBe('clean');
    expect(store.getMessage(message.id)?.text).toBe('great stream today!');
    expect(store.getAnalysis(message.id)?.riskCategory).toBe('clean');
    expect(emitted.map((e) => e.event)).toContain('chat:message');
    expect(emitted.map((e) => e.event)).toContain('insights:update');
    store.close();
  });

  it('rejects invalid events with a validation error', async () => {
    const { ctx, store } = makeCtx();
    await expect(
      processIncomingEvent({ username: '', text: 'hi', channel: 'demo', source: 'demo' }, ctx),
    ).rejects.toThrow(/Invalid chat event/);
    await expect(
      processIncomingEvent({ username: 'u', text: 'x'.repeat(501), channel: 'demo', source: 'demo' }, ctx),
    ).rejects.toThrow(/Invalid chat event/);
    store.close();
  });

  it('flags spam, creates an alert broadcast, and records a question group', async () => {
    const { store, emitted, ctx } = makeCtx();
    await processIncomingEvent(
      { username: 'spammer', text: 'FOLLOW 4 FOLLOW check out my channel!!', channel: 'demo', source: 'demo' },
      ctx,
    );
    await processIncomingEvent(
      { username: 'curious', text: 'what game is this? it looks fun', channel: 'demo', source: 'demo' },
      ctx,
    );
    expect(emitted.map((e) => e.event)).toContain('moderation:alert');
    expect(store.listAlerts(10)).toHaveLength(1);
    expect(store.listQuestionGroups('open')).toHaveLength(1);
    expect(store.countOpenAlerts()).toBe(1);
    store.close();
  });

  it('creates a spam-burst incident when flagged messages spike', async () => {
    const { store, ctx } = makeCtx();
    for (let i = 0; i < 4; i += 1) {
      await processIncomingEvent(
        { username: `spammer${i}`, text: 'FREE FOLLOWERS at bit.ly/xyz', channel: 'demo', source: 'demo' },
        ctx,
      );
    }
    const bursts = store.listIncidents(10, 'spam_burst');
    expect(bursts.length).toBeGreaterThanOrEqual(1);
    expect(bursts[0].severity).toBe('high');
    store.close();
  });

  it('never executes chat text — it is stored verbatim as data', async () => {
    const { store, ctx } = makeCtx();
    const evil = '<script>alert("xss")</script> {{7*7}} DROP TABLE messages;';
    const { message } = await processIncomingEvent(
      { username: 'attacker', text: evil, channel: 'demo', source: 'demo' },
      ctx,
    );
    expect(store.getMessage(message.id)?.text).toBe(evil);
    expect(store.listMessages(10)).toHaveLength(1);
    store.close();
  });
});

describe('Demo Mode simulator', () => {
  it('is deterministic for a fixed seed', () => {
    const a = new ChatSimulator({ seed: 123 });
    const b = new ChatSimulator({ seed: 123 });
    const seqA = Array.from({ length: 20 }, () => a.next('mixed'));
    const seqB = Array.from({ length: 20 }, () => b.next('mixed'));
    expect(seqA).toEqual(seqB);
  });

  it('differs for different seeds', () => {
    const a = new ChatSimulator({ seed: 1 });
    const b = new ChatSimulator({ seed: 2 });
    const seqA = Array.from({ length: 10 }, () => a.next('mixed'));
    const seqB = Array.from({ length: 10 }, () => b.next('mixed'));
    expect(seqA).not.toEqual(seqB);
  });

  it('labels every emitted event as demo source', () => {
    const sim = new ChatSimulator({ seed: 9 });
    for (const scenario of ['mixed', 'spam_burst', 'toxic', 'questions', 'calm'] as const) {
      expect(sim.next(scenario).source).toBe('demo');
    }
  });

  it('scripted burst contains coordinated spam plus genuine chat', () => {
    const sim = new ChatSimulator({ seed: 5 });
    const burst = sim.scriptedBurst();
    expect(burst).toHaveLength(5);
    const spamTexts = burst.filter((e) => e.text.includes('FOLLOW 4 FOLLOW'));
    expect(spamTexts.length).toBe(3);
    expect(new Set(spamTexts.map((e) => e.username)).size).toBe(3);
  });

  it('mulberry32 produces values in [0, 1)', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
