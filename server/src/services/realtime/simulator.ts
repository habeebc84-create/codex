import type { MessageSource } from '../../../../shared/src/types.js';

/**
 * Demo Mode simulator.
 * Emits clearly labelled simulated chat events through the same pipeline
 * as live Twitch events. Nothing here touches Twitch. The PRNG is seeded
 * so automated runs are reproducible; the live demo uses a time-based seed.
 */

export interface SimulatorEvent {
  username: string;
  text: string;
  channel: string;
  source: MessageSource;
}

export type SimulatorScenario = 'mixed' | 'spam_burst' | 'toxic' | 'questions' | 'calm';

const VIEWERS = [
  'pixel_fox', 'novaPlays', 'quietstorm', 'luna_tv', 'modmoth', 'kappa_king',
  'glhf_gal', 'byte-sized', 'rowanrambles', 'chatsalot', 'vex_99', 'sunny_side',
  'orbiter', 'mossyrock', 'tiny_titan', 'echochamber', 'juniper_j', 'frostrune',
];

const NORMAL_CHAT = [
  'this run is so clean, gg',
  'LOVE this stream, the vibes are immaculate',
  'that play was incredible, clip it!',
  'first time here, this is awesome',
  'the new overlay looks fantastic',
  'W in the chat for the mods keeping this place chill',
  'that clutch was unreal, wow',
  'great music choice today',
  'been watching since the start, never miss a stream',
  'this community is so wholesome, thank you all',
  'nice shot! how long have you been playing?',
  'the production quality keeps getting better',
  'GG everyone, what a game',
  'this is my comfort stream honestly',
  'amazing energy tonight, lets gooo',
  'that was hilarious, I am crying',
  'mods are doing a great job tonight',
  'such a fun lobby, everyone is so positive',
];

const QUESTION_CHAT = [
  'what game is this? it looks fun',
  'how do I join the discord?',
  'what settings do you use for your mic?',
  'when is the next community night?',
  'how long have you been streaming?',
  'what rank are you right now?',
  'can you explain that last play? I missed it',
  'what song is playing right now?',
  'do you take game suggestions from chat?',
  'how do I set up alerts like yours?',
  'what is your streaming schedule this week?',
  'where can I find the VOD from yesterday?',
  'how did you get that overlay? it looks great',
  'what headset do you use?',
  'will you play with viewers today?',
];

const SPAM_CHAT = [
  'FOLLOW 4 FOLLOW, check out my channel!!',
  'FREE FOLLOWERS at bit.ly/free-followers-4u',
  'check my channel, check my channel, check my channel',
  'SUB 4 SUB everyone, sub for sub!!!',
  'FREE NITRO here: tinyurl.com/nitro-free-now',
  'buy viewers cheap at viewboost.example.com',
  'DM me for crypto giveaway, double your coins!',
  'FREE SKINS at bit.ly/free-skins-legit',
];

const TOXIC_CHAT = [
  'you are so stupid, uninstall right now',
  'shut up, nobody likes you',
  'this streamer is trash, worst gameplay ever',
  'idiot play, my grandma plays better',
  'I hate you, this stream is garbage',
  'moron take, you know nothing about this game',
];

/** Deterministic PRNG (mulberry32) so tests and demos are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulatorOptions {
  seed?: number;
  channel?: string;
}

export class ChatSimulator {
  private rand: () => number;
  private channel: string;
  private counter = 0;

  constructor(options: SimulatorOptions = {}) {
    this.rand = mulberry32(options.seed ?? Math.floor(Math.random() * 2 ** 31));
    this.channel = options.channel ?? 'streamguardian_demo';
  }

  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rand() * arr.length)];
  }

  next(scenario: SimulatorScenario = 'mixed'): SimulatorEvent {
    this.counter += 1;
    let text: string;
    let username = this.pick(VIEWERS);
    switch (scenario) {
      case 'spam_burst': {
        // Coordinated-looking burst: same spam text from several users.
        text = this.pick(SPAM_CHAT);
        username = this.pick(VIEWERS.slice(0, 6));
        break;
      }
      case 'toxic': {
        text = this.pick(TOXIC_CHAT);
        break;
      }
      case 'questions': {
        text = this.pick(QUESTION_CHAT);
        break;
      }
      case 'calm': {
        text = this.pick(NORMAL_CHAT);
        break;
      }
      default: {
        const roll = this.rand();
        if (roll < 0.52) text = this.pick(NORMAL_CHAT);
        else if (roll < 0.72) text = this.pick(QUESTION_CHAT);
        else if (roll < 0.84) text = this.pick(SPAM_CHAT);
        else if (roll < 0.92) text = this.pick(TOXIC_CHAT);
        else text = this.pick(NORMAL_CHAT);
      }
    }
    return { username, text, channel: this.channel, source: 'demo' };
  }

  /** A short scripted burst used by the seed/demo walkthrough. */
  scriptedBurst(): SimulatorEvent[] {
    const spam = 'FOLLOW 4 FOLLOW, check out my channel!!';
    return [
      { username: 'vex_99', text: spam, channel: this.channel, source: 'demo' },
      { username: 'orbiter', text: spam, channel: this.channel, source: 'demo' },
      { username: 'mossyrock', text: spam, channel: this.channel, source: 'demo' },
      { username: 'pixel_fox', text: 'what game is this? it looks fun', channel: this.channel, source: 'demo' },
      { username: 'luna_tv', text: 'mods are doing a great job tonight', channel: this.channel, source: 'demo' },
    ];
  }

  get emitted(): number {
    return this.counter;
  }
}
