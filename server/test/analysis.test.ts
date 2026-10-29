import { describe, expect, it } from 'vitest';
import { analyzeMessage, normalizeText, extractHosts } from '../src/services/moderation/analysis.js';
import type { AnalysisContext } from '../src/services/moderation/analysis.js';

const emptyCtx: AnalysisContext = { recentByUser: [], recentGlobal: [], nowIso: '2026-10-29T12:00:00.000Z' };

function analyze(text: string, ctx: AnalysisContext = emptyCtx) {
  return analyzeMessage(
    { messageId: 'm1', username: 'tester', text, createdAt: '2026-10-29T12:00:00.000Z' },
    ctx,
  );
}

describe('normalizeText / extractHosts', () => {
  it('normalizes case and punctuation for repetition comparison', () => {
    expect(normalizeText('Hello,  WORLD!!!')).toBe('hello world');
  });

  it('extracts hostnames from URLs', () => {
    const hosts = extractHosts('check bit.ly/abc and https://www.twitch.tv/x');
    expect(hosts.sort()).toEqual(['bit.ly', 'www.twitch.tv']);
  });
});

describe('spam detection', () => {
  it('flags follow-for-follow spam phrases', () => {
    const result = analyze('FOLLOW 4 FOLLOW, check out my channel!!');
    expect(result.riskCategory).toBe('spam');
    expect(result.needsHumanReview).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('flags link shorteners as suspicious links', () => {
    const result = analyze('free skins here: bit.ly/free-skins-legit');
    expect(result.riskCategory).toBe('suspicious_link');
  });

  it('does not flag trusted twitch/youtube links alone', () => {
    const result = analyze('clip it! https://clips.twitch.tv/abc123');
    expect(result.riskCategory).toBe('clean');
  });

  it('escalates repeated identical messages', () => {
    const ctx: AnalysisContext = {
      ...emptyCtx,
      recentByUser: [
        { text: 'FREE FOLLOWERS now', createdAt: '2026-10-29T11:59:30.000Z' },
        { text: 'FREE FOLLOWERS now', createdAt: '2026-10-29T11:59:45.000Z' },
      ],
    };
    const result = analyze('FREE FOLLOWERS now', ctx);
    expect(result.severity).toBe('high');
    expect(result.reasons.join(' ')).toMatch(/repeated/);
  });

  it('detects coordinated identical text from distinct users', () => {
    const ctx: AnalysisContext = {
      ...emptyCtx,
      recentGlobal: [
        { username: 'a', text: 'raid raid raid', createdAt: '2026-10-29T11:59:30.000Z' },
        { username: 'b', text: 'raid raid raid', createdAt: '2026-10-29T11:59:40.000Z' },
        { username: 'c', text: 'raid raid raid', createdAt: '2026-10-29T11:59:50.000Z' },
      ],
    };
    const result = analyze('raid raid raid', ctx);
    expect(result.riskCategory).toBe('coordinated');
  });
});

describe('harassment detection and the single-message cap', () => {
  it('flags a severe phrase as critical with human review', () => {
    const result = analyze('just kill yourself, nobody wants you here');
    expect(result.riskCategory).toBe('harassment');
    expect(result.severity).toBe('critical');
    expect(result.recommendedAction).toBe('ban_suggested');
    expect(result.needsHumanReview).toBe(true);
  });

  it('caps a single ambiguous insult at medium severity', () => {
    const result = analyze('you are stupid');
    expect(result.riskCategory).toBe('harassment');
    expect(result.severity).toBe('medium');
    expect(result.recommendedAction).toBe('review');
  });

  it('does not label a user malicious from one clean message', () => {
    const result = analyze('great stream today, thanks everyone!');
    expect(result.riskCategory).toBe('clean');
    expect(result.needsHumanReview).toBe(false);
    expect(result.recommendedAction).toBe('none');
  });

  it('treats caps flooding as a weak signal only', () => {
    const result = analyze('THIS IS SO AMAZING RIGHT NOW');
    expect(result.severity).toBe('low');
  });
});
