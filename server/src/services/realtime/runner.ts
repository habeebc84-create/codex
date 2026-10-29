import type { Server as SocketServer } from 'socket.io';
import type { Store } from '../../db/store.js';
import { config } from '../../config.js';
import { ChatSimulator, type SimulatorScenario } from './simulator.js';
import { processIncomingEvent, type BroadcastFn } from './pipeline.js';
import {
  TwitchChatListener,
  fetchTwitchUser,
  refreshAccessToken,
  type TwitchTokens,
} from '../twitch/twitch.js';
import type { TwitchConnectionState } from '../../../../shared/src/types.js';

/**
 * RealtimeRunner owns every live data source: the Demo Mode simulator and
 * the Twitch EventSub listener. Exactly one source is active at a time.
 * The runner exposes the connection state that the UI renders — Demo Mode
 * is always labelled as simulated, and Live Mode only reports "connected"
 * after Twitch confirms the EventSub subscription.
 */
export class RealtimeRunner {
  private store: Store;
  private io: SocketServer;
  private simulator: ChatSimulator;
  private timer: NodeJS.Timeout | null = null;
  private scenario: SimulatorScenario = 'mixed';
  private speed = 1;
  private emitted = 0;
  private listener: TwitchChatListener | null = null;
  private tokens: TwitchTokens | null = null;
  private twitchState: TwitchConnectionState = 'disconnected';
  private lastError: string | null = null;

  constructor(store: Store, io: SocketServer) {
    this.store = store;
    this.io = io;
    this.simulator = new ChatSimulator({ channel: config.DEMO_CHANNEL });
  }

  private broadcast: BroadcastFn = (event, payload) => {
    this.io.emit(event, payload);
  };

  private emitStatus(): void {
    this.io.emit('status:update', this.getStatus());
  }

  getStatus() {
    return {
      mode: (this.tokens ? 'live' : 'demo') as 'live' | 'demo',
      twitch: {
        state: this.tokens ? this.twitchState : 'disconnected',
        login: this.tokens?.user.login ?? null,
        channel: this.tokens?.user.login ?? config.DEMO_CHANNEL,
        lastError: this.lastError,
        scopes: ['user:read:chat'],
      },
      ai: {
        available: config.openaiConfigured,
        engine: (config.openaiConfigured ? 'openai' : 'deterministic') as 'openai' | 'deterministic',
        note: config.openaiConfigured
          ? 'OpenAI classification enabled (server-side, with deterministic fallback on failure).'
          : 'Deterministic fallback — no AI call made. Set OPENAI_API_KEY to enable AI-assisted classification.',
      },
      simulator: {
        running: this.timer != null,
        speed: this.speed,
        emitted: this.emitted,
      },
      serverTime: new Date().toISOString(),
    };
  }

  // --- Demo Mode ------------------------------------------------------------

  startDemo(scenario: SimulatorScenario = 'mixed', speed = 1): void {
    this.stopTwitch();
    this.scenario = scenario;
    this.speed = speed;
    if (this.timer) return;
    const baseIntervalMs = 1400;
    const tick = () => {
      void this.emitOne();
      this.timer = setTimeout(tick, baseIntervalMs / this.speed);
    };
    this.timer = setTimeout(tick, 300);
    this.emitStatus();
  }

  pauseDemo(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emitStatus();
  }

  resetDemo(): void {
    this.pauseDemo();
    this.store.clearDemoData();
    this.emitted = 0;
    this.emitStatus();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    if (this.timer) {
      this.pauseDemo();
      this.startDemo(this.scenario, speed);
    }
    this.emitStatus();
  }

  setScenario(scenario: SimulatorScenario): void {
    this.scenario = scenario;
  }

  async emitOne(): Promise<void> {
    const event = this.simulator.next(this.scenario);
    await processIncomingEvent(
      {
        username: event.username,
        text: event.text,
        channel: event.channel,
        source: 'demo',
      },
      { store: this.store, broadcast: this.broadcast, aiEnabled: config.openaiConfigured },
    );
    this.emitted += 1;
  }

  async emitScriptedBurst(): Promise<void> {
    for (const event of this.simulator.scriptedBurst()) {
      await processIncomingEvent(
        {
          username: event.username,
          text: event.text,
          channel: event.channel,
          source: 'demo',
        },
        { store: this.store, broadcast: this.broadcast, aiEnabled: config.openaiConfigured },
      );
      this.emitted += 1;
    }
  }

  // --- Twitch Live Mode --------------------------------------------------------

  async connectTwitch(tokens: Omit<TwitchTokens, 'user'> & { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] }): Promise<void> {
    const user = await fetchTwitchUser(tokens.accessToken);
    if (!user) {
      // Token may have expired between exchange and use — try one refresh.
      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken);
        const retryUser = await fetchTwitchUser(refreshed.access_token);
        if (!retryUser) throw new Error('Could not fetch Twitch user');
        this.tokens = {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: Date.now() + refreshed.expires_in * 1000,
          scopes: refreshed.scope,
          user: retryUser,
        };
      } catch {
        this.lastError = 'Twitch authorization failed while fetching the user profile.';
        this.twitchState = 'error';
        this.emitStatus();
        return;
      }
    } else {
      this.tokens = { ...tokens, user };
    }
    this.pauseDemo();
    this.twitchState = 'connecting';
    this.lastError = null;
    this.listener = new TwitchChatListener(
      this.tokens,
      {
        onMessage: (event) => {
          void processIncomingEvent(
            {
              username: event.username,
              text: event.text,
              channel: event.channel,
              source: 'twitch',
              messageId: event.messageId,
              userId: event.userId,
              timestamp: event.timestamp,
            },
            { store: this.store, broadcast: this.broadcast, aiEnabled: config.openaiConfigured },
          );
        },
        onState: (state, detail) => {
          this.twitchState = state as TwitchConnectionState;
          if (detail) this.lastError = detail;
          this.emitStatus();
        },
      },
    );
    this.listener.start();
    this.emitStatus();
  }

  disconnectTwitch(): void {
    this.stopTwitch();
    this.tokens = null;
    this.twitchState = 'disconnected';
    this.lastError = null;
    this.emitStatus();
  }

  private stopTwitch(): void {
    this.listener?.stop();
    this.listener = null;
  }

  get twitchTokens(): TwitchTokens | null {
    return this.tokens;
  }

  get isLive(): boolean {
    return this.tokens != null;
  }

  get currentScenario(): SimulatorScenario {
    return this.scenario;
  }

  get currentSpeed(): number {
    return this.speed;
  }

  get demoRunning(): boolean {
    return this.timer != null;
  }

  get demoEmitted(): number {
    return this.emitted;
  }

  shutdown(): void {
    this.pauseDemo();
    this.stopTwitch();
  }

  /** Seed the demo database with a scripted burst + a few calm messages. */
  async seedDemo(): Promise<void> {
    if (this.store.countMessages('1970-01-01T00:00:00.000Z') > 0) return;
    await this.emitScriptedBurst();
    const calm = new ChatSimulator({ seed: 42, channel: config.DEMO_CHANNEL });
    for (let i = 0; i < 12; i += 1) {
      const event = calm.next('calm');
      await processIncomingEvent(
        {
          username: event.username,
          text: event.text,
          channel: event.channel,
          source: 'demo',
        },
        { store: this.store, broadcast: this.broadcast, aiEnabled: false },
      );
    }
    const questions = new ChatSimulator({ seed: 7, channel: config.DEMO_CHANNEL });
    for (let i = 0; i < 4; i += 1) {
      const event = questions.next('questions');
      await processIncomingEvent(
        {
          username: event.username,
          text: event.text,
          channel: event.channel,
          source: 'demo',
        },
        { store: this.store, broadcast: this.broadcast, aiEnabled: false },
      );
    }
  }
}
