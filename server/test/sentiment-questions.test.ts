import { describe, expect, it } from 'vitest';
import { analyzeSentiment } from '../src/services/moderation/sentiment.js';
import { detectQuestion, findMatchingGroup, tokenOverlap } from '../src/services/moderation/questions.js';

describe('sentiment analysis', () => {
  it('labels clearly positive chat as positive', () => {
    expect(analyzeSentiment('this stream is amazing, love it so much!').label).toBe('positive');
  });

  it('labels clearly negative chat as negative', () => {
    expect(analyzeSentiment('this is terrible and boring, worst stream').label).toBe('negative');
  });

  it('labels no-signal chat as uncertain, not neutral-by-default', () => {
    expect(analyzeSentiment('ok then moving on').label).toBe('uncertain');
  });

  it('handles negation', () => {
    expect(analyzeSentiment('this is not great at all').label).toBe('negative');
    expect(analyzeSentiment('not bad, actually pretty good').label).toBe('positive');
  });

  it('labels balanced opposing signals as neutral', () => {
    // One positive and one negative signal, neither dominating.
    expect(analyzeSentiment('love the game, hate the wait').label).toBe('neutral');
  });
});

describe('question detection and grouping', () => {
  it('detects genuine questions', () => {
    const result = detectQuestion('what game is this? it looks fun');
    expect(result.isQuestion).toBe(true);
    expect(result.relevance).toBeGreaterThan(0.5);
    expect(result.groupKey.length).toBeGreaterThan(0);
  });

  it('detects questions without a question mark', () => {
    expect(detectQuestion('how do I join the discord server').isQuestion).toBe(true);
  });

  it('does not treat short remarks as questions', () => {
    expect(detectQuestion('gg').isQuestion).toBe(false);
    expect(detectQuestion('nice').isQuestion).toBe(false);
  });

  it('groups similar questions by token overlap', () => {
    const a = detectQuestion('what game is this?').groupKey;
    const b = detectQuestion('what game are you playing right now?').groupKey;
    expect(tokenOverlap(a, b)).toBeGreaterThan(0.3);
    expect(findMatchingGroup(b, [a])).toBe(a);
  });

  it('does not group unrelated questions', () => {
    const a = detectQuestion('what game is this?').groupKey;
    const b = detectQuestion('when is the next community night?').groupKey;
    expect(findMatchingGroup(b, [a])).toBeNull();
  });
});
