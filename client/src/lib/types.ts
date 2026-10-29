import type { ChatMessage, MessageAnalysis, ModerationDecision } from '../../../shared/src/types.js';

/** One review-queue entry: the flagged message, its analysis, and any
 * decision already recorded for it. Matches GET /api/alerts. */
export interface AlertItem {
  message: ChatMessage;
  analysis: MessageAnalysis;
  decision: ModerationDecision | null;
  source: string;
}
