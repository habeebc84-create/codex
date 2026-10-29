import type {
  MessageAnalysis,
  RecommendedAction,
  RiskCategory,
  Severity,
} from '../../../../shared/src/types.js';

/**
 * Deterministic moderation analysis.
 *
 * Design rules (documented, testable):
 * - A single ambiguous message is capped at "medium" severity and always
 *   requires human review. "High"/"critical" require repetition, rate,
 *   coordination, or a severe pattern.
 * - A user is never labelled malicious from one message. Verdicts describe
 *   the message, not the person.
 * - Chat text is treated as untrusted data. Nothing here executes it or
 *   passes it to any instruction-following system.
 */

export interface AnalysisContext {
  /** Recent messages from the same user (oldest first), excluding this one. */
  recentByUser: Array<{ text: string; createdAt: string }>;
  /** Recent messages from all users in the same window, excluding this one. */
  recentGlobal: Array<{ username: string; text: string; createdAt: string }>;
  nowIso: string;
}

export interface AnalysisInput {
  messageId: string;
  username: string;
  text: string;
  createdAt: string;
}

const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

/** Tokens that look like bare domains (bit.ly/abc, example.com/path). */
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

const LINK_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rb.gy',
  'cutt.ly',
  'shorte.st',
]);

const TRUSTED_LINK_HOSTS = new Set([
  'twitch.tv',
  'www.twitch.tv',
  'clips.twitch.tv',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'discord.gg',
  'twitter.com',
  'x.com',
]);

const SPAM_PHRASES = [
  'follow for follow',
  'follow 4 follow',
  'f4f',
  'free followers',
  'free viewers',
  'check out my channel',
  'check my channel',
  'check my stream',
  'sub for sub',
  'sub4sub',
  'buy followers',
  'buy viewers',
  'crypto giveaway',
  'double your crypto',
  'free nitro',
  'free skins',
  'dm me for',
  'earn money fast',
  'work from home',
  'make money online',
];

const SEVERE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bkill yourself\b/i, label: 'self-harm encouragement phrase' },
  { re: /\bkys\b/i, label: 'abbreviated self-harm encouragement' },
  { re: /\b(i will|i\'m gonna|im gonna)\s+(kill|hurt|find|murder)\b/i, label: 'threat of violence' },
  { re: /\b(die|death) (to|for) (you|all|every)\b/i, label: 'violent wish' },
];

const HARASSMENT_TERMS: Array<{ re: RegExp; label: string; weight: number }> = [
  { re: /\bidiot\b/i, label: 'insult: "idiot"', weight: 1 },
  { re: /\bmoron\b/i, label: 'insult: "moron"', weight: 1 },
  { re: /\bstupid\b/i, label: 'insult: "stupid"', weight: 1 },
  { re: /\bdumb\b/i, label: 'insult: "dumb"', weight: 1 },
  { re: /\btrash\b/i, label: 'derogatory: "trash"', weight: 1 },
  { re: /\bshut up\b/i, label: 'dismissive: "shut up"', weight: 1 },
  { re: /\bi hate you\b/i, label: 'hostile: "I hate you"', weight: 2 },
  { re: /\bno one likes you\b/i, label: 'targeted hostility', weight: 2 },
  { re: /\bkill yourself\b/i, label: 'self-harm encouragement phrase', weight: 3 },
  { re: /\bretard(ed)?\b/i, label: 'ableist slur', weight: 2 },
];

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHosts(text: string): string[] {
  const hosts: string[] = [];
  const matches = text.match(URL_RE) ?? [];
  for (const m of matches) {
    try {
      const url = new URL(m.startsWith('http') ? m : `https://${m}`);
      hosts.push(url.hostname.toLowerCase());
    } catch {
      // Not a parseable URL — ignore; the raw text is still scored by other rules.
    }
  }
  // Bare domains without a scheme (e.g. "bit.ly/abc") carry the same risk
  // as full URLs and must not slip past link detection.
  for (const rawToken of text.split(/\s+/)) {
    const token = rawToken.replace(/^[<(\["']+|[>)\]"'.,;:!?]+$/g, '');
    if (!token || token.includes('://') || token.startsWith('www.')) continue;
    if (!BARE_DOMAIN_RE.test(token)) continue;
    try {
      const url = new URL(`https://${token}`);
      const host = url.hostname.toLowerCase();
      if (!hosts.includes(host)) hosts.push(host);
    } catch {
      // Ignore unparseable tokens.
    }
  }
  return hosts;
}

function capsRatio(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return 0;
  const caps = letters.replace(/[^A-Z]/g, '').length;
  return caps / letters.length;
}

function repeatedCharRatio(text: string): number {
  const runs = text.match(/(.)\1{4,}/g) ?? [];
  const runLen = runs.reduce((sum, r) => sum + r.length, 0);
  return text.length === 0 ? 0 : runLen / text.length;
}

function emojiCount(text: string): number {
  const matches = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  return matches.length;
}

export function analyzeMessage(
  input: AnalysisInput,
  ctx: AnalysisContext,
): MessageAnalysis {
  const reasons: string[] = [];
  const text = input.text;
  const normalized = normalizeText(text);
  let confidence = 0.3;
  let category: RiskCategory = 'clean';
  let severity: Severity = 'low';
  let recommended: RecommendedAction = 'none';
  let score = 0;

  // --- Suspicious links -------------------------------------------------
  const hosts = extractHosts(text);
  let suspiciousLink = false;
  for (const host of hosts) {
    if (LINK_SHORTENERS.has(host)) {
      suspiciousLink = true;
      reasons.push(`link shortener (${host}) hides the destination`);
      score += 2;
    } else if (!TRUSTED_LINK_HOSTS.has(host) && !host.endsWith('.twitch.tv')) {
      suspiciousLink = true;
      reasons.push(`untrusted external link (${host})`);
      score += 1;
    }
  }

  // --- Spam phrases ------------------------------------------------------
  const lowered = text.toLowerCase();
  for (const phrase of SPAM_PHRASES) {
    if (lowered.includes(phrase)) {
      reasons.push(`known spam phrase: "${phrase}"`);
      score += 2;
      break;
    }
  }

  // --- Repetition / rate (same user) --------------------------------------
  const sameTextCount = ctx.recentByUser.filter(
    (m) => normalizeText(m.text) === normalized && normalized.length > 0,
  ).length;
  const userRate = ctx.recentByUser.length;
  if (sameTextCount >= 2) {
    reasons.push(`same message repeated ${sameTextCount + 1} times by this user in the window`);
    score += 2;
  } else if (sameTextCount === 1) {
    reasons.push('same message sent twice by this user in the window');
    score += 1;
  }
  if (userRate >= 8) {
    reasons.push(`high message rate: ${userRate + 1} messages from this user in the window`);
    score += 2;
  } else if (userRate >= 5) {
    reasons.push(`elevated message rate: ${userRate + 1} messages from this user in the window`);
    score += 1;
  }

  // --- Coordinated repetition (distinct users, same text) -----------------
  const distinctRepeaters = new Set(
    ctx.recentGlobal
      .filter((m) => normalizeText(m.text) === normalized && normalized.length > 0)
      .map((m) => m.username),
  );
  const coordinated = distinctRepeaters.size >= 2;
  if (coordinated) {
    reasons.push(
      `identical text from ${distinctRepeaters.size + 1} distinct users — possible coordinated activity`,
    );
    score += 3;
  }

  // --- Shouting / flooding ------------------------------------------------
  const caps = capsRatio(text);
  if (caps >= 0.8 && text.length >= 12) {
    reasons.push('message is mostly capital letters');
    score += 1;
  }
  if (repeatedCharRatio(text) >= 0.35) {
    reasons.push('long runs of repeated characters');
    score += 1;
  }
  if (text.length >= 12 && emojiCount(text) >= 8) {
    reasons.push('excessive emoji use');
    score += 1;
  }

  // --- Harassment signals ---------------------------------------------------
  let harassmentWeight = 0;
  const matchedTerms: string[] = [];
  for (const term of HARASSMENT_TERMS) {
    if (term.re.test(text)) {
      harassmentWeight += term.weight;
      matchedTerms.push(term.label);
    }
  }
  const severe = SEVERE_PATTERNS.filter((p) => p.re.test(text));
  for (const s of severe) {
    reasons.push(`severe pattern: ${s.label}`);
  }
  if (matchedTerms.length > 0) {
    reasons.push(`harassment signals: ${matchedTerms.join('; ')}`);
  }
  if (harassmentWeight > 0) {
    score += harassmentWeight;
  }

  // --- Verdict ---------------------------------------------------------------
  const hasHarassment = harassmentWeight > 0;
  const hasSpamSignal = score >= 2 && !hasHarassment;
  const isSevere = severe.length > 0;

  if (isSevere) {
    category = 'harassment';
    severity = 'critical';
    recommended = 'ban_suggested';
    confidence = 0.88;
  } else if (coordinated && score >= 5) {
    category = 'coordinated';
    severity = 'high';
    recommended = 'review';
    confidence = 0.82;
  } else if (coordinated) {
    category = 'coordinated';
    severity = 'medium';
    recommended = 'review';
    confidence = 0.7;
  } else if (hasHarassment && harassmentWeight >= 3) {
    category = 'harassment';
    severity = 'high';
    recommended = 'timeout_suggested';
    confidence = 0.8;
  } else if (hasHarassment) {
    category = 'harassment';
    severity = 'medium';
    recommended = 'review';
    confidence = 0.65;
  } else if (suspiciousLink && (sameTextCount >= 1 || userRate >= 5)) {
    // A suspicious link with repetition/rate context outranks a generic
    // spam verdict: the link is the more specific, actionable signal.
    category = 'suspicious_link';
    severity = 'high';
    recommended = 'timeout_suggested';
    confidence = 0.78;
  } else if (suspiciousLink) {
    category = 'suspicious_link';
    severity = 'medium';
    recommended = 'review';
    confidence = 0.6;
  } else if (score >= 4 || (hasSpamSignal && sameTextCount >= 2)) {
    category = 'spam';
    severity = 'high';
    recommended = 'timeout_suggested';
    confidence = 0.8;
  } else if (score >= 2) {
    category = 'spam';
    severity = 'medium';
    recommended = 'review';
    confidence = 0.62;
  } else if (score === 1) {
    category = 'uncertain';
    severity = 'low';
    recommended = 'monitor';
    confidence = 0.45;
  }

  // Single ambiguous message cap: never high/critical from one weak signal.
  if (
    (severity === 'high' || severity === 'critical') &&
    !isSevere &&
    sameTextCount === 0 &&
    !coordinated &&
    userRate < 5
  ) {
    severity = 'medium';
    recommended = 'review';
    confidence = Math.min(confidence, 0.65);
    reasons.push('capped at medium: single message without repetition or coordination context');
  }

  // Every flagged message needs a human decision. Nothing is acted on
  // automatically; the review queue is the only path to an action.
  const needsHumanReview = category !== 'clean';

  const explanation =
    category === 'clean'
      ? 'No spam, harassment, or suspicious-link signals detected in this message.'
      : reasons.length > 0
        ? `Flagged for ${category.replace('_', ' ')}: ${reasons.join('; ')}.`
        : `Flagged for ${category.replace('_', ' ')}. Human review is recommended before any action.`;

  return {
    messageId: input.messageId,
    riskCategory: category,
    severity,
    confidence: Math.round(Math.min(0.95, Math.max(0.3, confidence)) * 100) / 100,
    explanation,
    reasons,
    recommendedAction: recommended,
    needsHumanReview: category === 'clean' ? false : needsHumanReview,
    engine: 'deterministic',
    createdAt: input.createdAt,
  };
}
