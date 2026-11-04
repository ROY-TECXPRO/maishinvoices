import {
  DuplicateNumberError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from '../repository';

/** Errors raised by the Supabase layer beyond the shared Repository errors. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('You are not signed in.');
    this.name = 'NotAuthenticatedError';
  }
}
export class NotAuthorizedError extends Error {
  constructor(message = 'Your account cannot perform this action yet.') {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

/** The minimal shape of a PostgREST/Supabase error. */
export interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

function parseDetailJson<T>(details: string | undefined): T | null {
  if (!details) return null;
  try {
    return JSON.parse(details) as T;
  } catch {
    return null;
  }
}

/**
 * Maps database SQLSTATE codes (see supabase/migrations/*_functions.sql) to the
 * typed repository errors the UI already understands.
 * `what` names the missing resource for MX404 (e.g. "Document", "Version").
 */
export function toRepositoryError(error: SupabaseLikeError, what = 'Document'): Error {
  switch (error.code) {
    case 'MXVAL': {
      const parsed = parseDetailJson<string[]>(error.details);
      const problems = Array.isArray(parsed) && parsed.length ? parsed : ['The document is not valid.'];
      return new ValidationError(problems);
    }
    case 'MXDUP': {
      const parsed = parseDetailJson<{ number?: string }>(error.details);
      return new DuplicateNumberError(parsed?.number ?? '');
    }
    case 'MXCON':
      return new VersionConflictError();
    case 'MX404':
      return new NotFoundError(what);
    case 'MX401':
      return new NotAuthenticatedError();
    case 'MX403':
      return new NotAuthorizedError(
        what === 'Document'
          ? 'Your account cannot perform this action. Ask an administrator to activate your account.'
          : 'Your account cannot perform this action. Ask an administrator to activate your account.',
      );
    default:
      return new Error(error.message || 'The request to Supabase failed. Check your connection.');
  }
}

/** Extracts the real message from a failed Edge Function call (supabase-js hides it in error.context). */
export async function functionErrorMessage(error: unknown, fn: string): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; message?: string };
      const e = body?.error;
      if (typeof e === 'string' && e) return e;
      if (e && typeof e === 'object' && typeof (e as { message?: string }).message === 'string') return (e as { message: string }).message;
      if (typeof body?.message === 'string' && body.message) return body.message;
    } catch {
      /* fall through */
    }
  }
  const msg = (error as Error | null)?.message ?? '';
  if (/failed to send a request|failed to fetch|networkerror/i.test(msg)) {
    return `The ${fn} function could not be reached. Check your connection, and make sure it is deployed (supabase functions deploy ${fn}).`;
  }
  return msg || 'The request failed.';
}
