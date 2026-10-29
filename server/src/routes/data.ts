import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import { config } from '../config.js';
import { requireModerator } from '../middleware/auth.js';
import { parseBody, parsePagination } from '../middleware/errors.js';
import {
  buildActivityBuckets,
  buildCopilotSummary,
  buildSentimentBuckets,
} from '../services/analytics/insights.js';
import type { RealtimeRunner } from '../services/realtime/runner.js';
import type { DecisionAction, Incident } from '../../../shared/src/types.js';

const decisionSchema = z.object({
  action: z.enum(['dismiss', 'false_positive', 'approve']),
  note: z.string().trim().max(500).optional(),
});

const demoControlSchema = z.object({
  scenario: z.enum(['mixed', 'spam_burst', 'toxic', 'questions', 'calm']).optional(),
  speed: z.number().min(0.25).max(4).optional(),
});

const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
});

export function createDataRouter(store: Store, runner: RealtimeRunner): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json(runner.getStatus());
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'streamguardian-ai', time: new Date().toISOString() });
  });

  // --- Chat messages ---------------------------------------------------------
  router.get('/messages', (req, res) => {
    const { limit, before } = parsePagination(req.query);
    res.json({ messages: store.listMessages(limit, before), limit });
  });

  // --- Moderation alerts + decisions (privileged) ----------------------------
  router.get('/alerts', (req, res) => {
    const { limit } = parsePagination(req.query);
    const onlyUnresolved = req.query.unresolved === 'true';
    const alerts = store.listAlerts(limit, onlyUnresolved).map((a) => ({
      ...a,
      source: a.message.source,
    }));
    res.json({ alerts, openCount: store.countOpenAlerts() });
  });

  router.post('/moderation/:messageId/decision', sensitiveLimiter, requireModerator, (req, res) => {
    const parsed = parseBody(decisionSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ error: { code: 'invalid_body', message: parsed.message } });
      return;
    }
    const message = store.getMessage(req.params.messageId);
    if (!message) {
      res.status(404).json({ error: { code: 'not_found', message: 'Message not found.' } });
      return;
    }
    const analysis = store.getAnalysis(message.id);
    if (!analysis || !analysis.needsHumanReview) {
      res.status(409).json({
        error: { code: 'not_reviewable', message: 'This message does not require moderation review.' },
      });
      return;
    }
    const action: DecisionAction = parsed.data.action;

    // Human control: an approval is recorded, but NOTHING is sent to Twitch
    // automatically. Submission requires a live Twitch connection plus the
    // moderator:manage:banned_users scope, which this MVP does not request.
    // The record always states plainly whether anything was submitted.
    let submittedToTwitch = false;
    let submitDetail: string;
    if (action === 'approve') {
      if (runner.isLive) {
        submitDetail =
          'Recorded as approved by the moderator. Not submitted to Twitch: this build requests only the user:read:chat scope, and moderation actions require moderator:manage:banned_users plus explicit re-authorization.';
      } else {
        submitDetail =
          'Recorded as approved by the moderator. Not submitted: Demo Mode has no live Twitch connection.';
      }
    } else if (action === 'dismiss') {
      submitDetail = 'Alert dismissed by the moderator. No action taken.';
    } else {
      submitDetail = 'Marked as a false positive by the moderator. The detection rules were not changed automatically.';
    }

    const decision = {
      id: randomUUID(),
      messageId: message.id,
      action,
      moderator: req.session?.displayName ?? 'moderator',
      note: parsed.data.note ?? null,
      submittedToTwitch,
      submitDetail,
      createdAt: new Date().toISOString(),
    };
    store.insertDecision(decision);

    const incident: Incident = {
      id: randomUUID(),
      type: action === 'approve' ? 'approved_action' : 'moderator_review',
      title:
        action === 'approve'
          ? `Action approved for @${message.username} (not submitted to Twitch)`
          : action === 'false_positive'
            ? `False positive marked for @${message.username}`
            : `Alert dismissed for @${message.username}`,
      detail: `${decision.moderator}: ${submitDetail}${decision.note ? ` Note: ${decision.note}` : ''}`,
      severity: analysis.severity,
      status: 'acknowledged',
      messageId: message.id,
      username: message.username,
      createdAt: decision.createdAt,
    };
    store.insertIncident(incident);

    res.status(201).json({ decision, incident });
  });

  router.get('/decisions', (req, res) => {
    const { limit } = parsePagination(req.query);
    res.json({ decisions: store.listDecisions(limit) });
  });

  // --- Incidents ---------------------------------------------------------------
  router.get('/incidents', (req, res) => {
    const { limit } = parsePagination(req.query);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    res.json({ incidents: store.listIncidents(limit, type, severity) });
  });

  router.get('/incidents/:id', (req, res) => {
    const incident = store.getIncident(req.params.id);
    if (!incident) {
      res.status(404).json({ error: { code: 'not_found', message: 'Incident not found.' } });
      return;
    }
    const message = incident.messageId ? store.getMessage(incident.messageId) : null;
    const analysis = incident.messageId ? store.getAnalysis(incident.messageId) : null;
    res.json({ incident, message, analysis });
  });

  // --- Insights ------------------------------------------------------------------
  router.get('/insights/summary', (req, res) => {
    const windowMinutes = Number(req.query.windowMinutes ?? 30);
    const safeWindow = Number.isFinite(windowMinutes) && windowMinutes >= 5 && windowMinutes <= 180 ? windowMinutes : 30;
    const until = new Date();
    const since = new Date(until.getTime() - safeWindow * 60_000);
    res.json({
      windowMinutes: safeWindow,
      since: since.toISOString(),
      until: until.toISOString(),
      messageCount: store.countMessages(since.toISOString()),
      uniqueParticipants: store.countUniqueParticipants(since.toISOString()),
      flaggedCount: store.countFlagged(since.toISOString()),
      openAlerts: store.countOpenAlerts(),
      questionGroupsOpen: store.listQuestionGroups('open').length,
    });
  });

  router.get('/insights/activity', (req, res) => {
    const windowMinutes = Number(req.query.windowMinutes ?? 60);
    const safeWindow = Number.isFinite(windowMinutes) && windowMinutes >= 5 && windowMinutes <= 180 ? windowMinutes : 60;
    const until = new Date();
    const since = new Date(until.getTime() - safeWindow * 60_000);
    res.json({
      windowMinutes: safeWindow,
      buckets: buildActivityBuckets(store, since.toISOString(), until.toISOString()),
      note: 'Observed counts from stored events in this window. Unique participants counts distinct usernames seen.',
    });
  });

  router.get('/insights/sentiment', (req, res) => {
    const windowMinutes = Number(req.query.windowMinutes ?? 60);
    const safeWindow = Number.isFinite(windowMinutes) && windowMinutes >= 5 && windowMinutes <= 180 ? windowMinutes : 60;
    const until = new Date();
    const since = new Date(until.getTime() - safeWindow * 60_000);
    res.json({
      windowMinutes: safeWindow,
      buckets: buildSentimentBuckets(store, since.toISOString(), until.toISOString()),
      note: 'Lexicon-based sentiment estimates over stored messages. Estimates, not objective facts about every viewer. Messages with no signal are counted as uncertain.',
    });
  });

  // --- Questions -------------------------------------------------------------------
  router.get('/questions', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && status !== 'open' && status !== 'answered') {
      res.status(400).json({ error: { code: 'invalid_query', message: 'status must be open or answered.' } });
      return;
    }
    res.json({ questions: store.listQuestionGroups(status) });
  });

  router.post('/questions/:id/answer', sensitiveLimiter, requireModerator, (req, res) => {
    const group = store.getQuestionGroup(req.params.id);
    if (!group) {
      res.status(404).json({ error: { code: 'not_found', message: 'Question group not found.' } });
      return;
    }
    store.setQuestionStatus(group.id, 'answered');
    res.json({ question: { ...group, status: 'answered' as const } });
  });

  // --- Copilot ----------------------------------------------------------------------
  router.get('/copilot/summary', (req, res) => {
    const windowMinutes = Number(req.query.windowMinutes ?? 30);
    const safeWindow = Number.isFinite(windowMinutes) && windowMinutes >= 5 && windowMinutes <= 180 ? windowMinutes : 30;
    res.json(buildCopilotSummary(store, safeWindow, config.openaiConfigured));
  });

  router.get('/copilot/suggestions', (_req, res) => {
    res.json({ suggestions: store.listSuggestions(20) });
  });

  router.post('/copilot/suggest-reply', sensitiveLimiter, requireModerator, (req, res) => {
    const schema = z.object({ questionGroupId: z.string().min(1) });
    const parsed = parseBody(schema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ error: { code: 'invalid_body', message: parsed.message } });
      return;
    }
    const group = store.getQuestionGroup(parsed.data.questionGroupId);
    if (!group) {
      res.status(404).json({ error: { code: 'not_found', message: 'Question group not found.' } });
      return;
    }
    // Deterministic, template-based suggestion from the stored question only.
    // No model call, no auto-send. Sending is disabled in Demo Mode.
    const suggestion = {
      id: randomUUID(),
      kind: 'reply' as const,
      text: `Good question, @${group.username}! "${group.representativeText}" — I'll cover that right after this segment. Thanks for asking!`,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
    store.insertSuggestion(suggestion);
    res.status(201).json({ suggestion, sendable: false, note: 'Suggested replies are never sent automatically. Sending is disabled in Demo Mode.' });
  });

  router.post('/copilot/suggestions/:id/approve', sensitiveLimiter, requireModerator, (req, res) => {
    store.setSuggestionStatus(req.params.id, 'approved');
    res.json({
      suggestionId: req.params.id,
      status: 'approved',
      sent: false,
      note: runner.isLive
        ? 'Approved by the moderator. Not sent: sending replies requires chat write scopes, which this build does not request.'
        : 'Approved by the moderator. Not sent: Demo Mode has no live Twitch connection.',
    });
  });

  router.post('/copilot/suggestions/:id/dismiss', sensitiveLimiter, requireModerator, (req, res) => {
    store.setSuggestionStatus(req.params.id, 'dismissed');
    res.json({ suggestionId: req.params.id, status: 'dismissed' });
  });

  // --- Demo controls ------------------------------------------------------------------
  router.post('/demo/start', sensitiveLimiter, requireModerator, (req, res) => {
    const parsed = parseBody(demoControlSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ error: { code: 'invalid_body', message: parsed.message } });
      return;
    }
    if (runner.isLive) {
      res.status(409).json({
        error: { code: 'live_mode', message: 'Demo Mode cannot start while a live Twitch connection is active. Disconnect Twitch first.' },
      });
      return;
    }
    runner.startDemo(parsed.data.scenario ?? 'mixed', parsed.data.speed ?? runner.currentSpeed);
    res.json({ ok: true, simulator: runner.getStatus().simulator });
  });

  router.post('/demo/pause', sensitiveLimiter, requireModerator, (_req, res) => {
    runner.pauseDemo();
    res.json({ ok: true, simulator: runner.getStatus().simulator });
  });

  router.post('/demo/reset', sensitiveLimiter, requireModerator, (_req, res) => {
    runner.resetDemo();
    res.json({ ok: true, simulator: runner.getStatus().simulator });
  });

  router.post('/demo/speed', sensitiveLimiter, requireModerator, (req, res) => {
    const parsed = parseBody(z.object({ speed: z.number().min(0.25).max(4) }), req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ error: { code: 'invalid_body', message: parsed.message } });
      return;
    }
    runner.setSpeed(parsed.data.speed);
    res.json({ ok: true, simulator: runner.getStatus().simulator });
  });

  router.post('/demo/scenario', sensitiveLimiter, requireModerator, (req, res) => {
    const parsed = parseBody(z.object({ scenario: z.enum(['mixed', 'spam_burst', 'toxic', 'questions', 'calm']) }), req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ error: { code: 'invalid_body', message: parsed.message } });
      return;
    }
    runner.setScenario(parsed.data.scenario);
    res.json({ ok: true, scenario: parsed.data.scenario });
  });

  return router;
}
