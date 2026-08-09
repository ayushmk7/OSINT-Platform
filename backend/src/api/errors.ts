import { Response } from 'express';

export interface ApiError {
  status: number;
  error: string;
  message: string;
  details: null;
}

/**
 * Standard error envelope. `details` is ALWAYS null and `message` is ALWAYS a safe,
 * caller-supplied string: the raw error (and its stack) is logged server-side only, never
 * serialized to the client. Leaking `err.stack` or `err.message` is information disclosure.
 */
export function sendError(res: Response, status: number, error: string, message: string): void {
  const body: ApiError = { status, error, message, details: null };
  res.status(status).json(body);
}

export function sendServerError(res: Response, context: string, err: unknown): void {
  console.error(`[api] ${context}:`, err);
  sendError(res, 500, 'Internal Server Error', context);
}
