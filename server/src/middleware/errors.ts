import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Resource not found.' } } satisfies ApiErrorBody);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[error]', err.message);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong. Please try again.' },
  } satisfies ApiErrorBody);
}

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

export function parsePagination(query: unknown): { limit: number; before?: string } {
  const parsed = paginationSchema.safeParse(query);
  if (!parsed.success) {
    return { limit: 50 };
  }
  return parsed.data;
}

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; message: string } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, data: parsed.data };
}
