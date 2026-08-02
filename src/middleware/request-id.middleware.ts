import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '@/config/constants';

/** Rejects absurd or non-printable inbound ids rather than logging them verbatim. */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/**
 * Assigns a correlation id to every request.
 *
 * An id supplied by an upstream proxy or gateway is reused so a single trace id
 * spans the whole hop chain; otherwise one is generated. It is attached to
 * `req.id`, echoed in the response header so a client can quote it in a bug
 * report, and included in every log line for the request.
 *
 * Must be registered before the HTTP logger.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(HEADERS.REQUEST_ID);
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader(HEADERS.REQUEST_ID, id);
  next();
}
