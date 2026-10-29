import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().min(1).default('./data/streamguardian.sqlite'),
  SESSION_SECRET: z.string().min(1).optional(),
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  TWITCH_REDIRECT_URI: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  DEMO_CHANNEL: z.string().default('streamguardian_demo'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  sessionSecret: string;
  sessionSecretGenerated: boolean;
  twitchConfigured: boolean;
  openaiConfigured: boolean;
};

function buildConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;

  let sessionSecret = env.SESSION_SECRET;
  let generated = false;
  if (!sessionSecret) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'Invalid environment configuration: SESSION_SECRET is required in production.',
      );
    }
    // Development/demo only: ephemeral secret, never persisted or logged.
    sessionSecret = `dev-only-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    generated = true;
    console.warn(
      '[config] SESSION_SECRET not set — using an ephemeral development secret. Set SESSION_SECRET in production.',
    );
  }

  const twitchConfigured = Boolean(
    env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && env.TWITCH_REDIRECT_URI,
  );
  if (
    env.TWITCH_CLIENT_ID ||
    env.TWITCH_CLIENT_SECRET ||
    env.TWITCH_REDIRECT_URI
  ) {
    if (!twitchConfigured) {
      console.warn(
        '[config] Partial Twitch configuration: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and TWITCH_REDIRECT_URI must all be set for Live Mode. Running in Demo Mode.',
      );
    }
  }

  return {
    ...env,
    sessionSecret,
    sessionSecretGenerated: generated,
    twitchConfigured,
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
  };
}

export const config: AppConfig = buildConfig();

/** Test helper: validate an arbitrary env object without touching process.env. */
export function validateEnv(input: Record<string, string | undefined>) {
  return envSchema.safeParse(input);
}
