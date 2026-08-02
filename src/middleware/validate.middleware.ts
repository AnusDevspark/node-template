import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type z, type ZodType } from 'zod';
import { ValidationError, type FieldError } from '@/errors';

/**
 * Validates any combination of body, query and params against Zod schemas.
 *
 *   router.post('/', validate({ body: createProviderSchema }), controller.create);
 *
 * Two things make this the security boundary of the application:
 *
 * 1. It *replaces* the raw input with the parsed output. Zod strips unknown keys
 *    by default, so `req.body` after this middleware contains only declared
 *    fields. Combined with services that map fields explicitly, that closes mass
 *    assignment from both ends.
 * 2. It is the only place a raw client string is allowed to become typed data.
 *    Nothing downstream re-reads the original request.
 *
 * Controllers read the parsed values through the `Validated*` helper types
 * below, so the request shape and the schema can never drift.
 */

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Converts a ZodError into the flat `errors` array the API returns. */
function toFieldErrors(error: z.ZodError, source: keyof ValidationSchemas): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : source,
    message: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const fieldErrors: FieldError[] = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        // `req.params` is a plain object and safe to overwrite.
        req.params = result.data as typeof req.params;
      } else {
        fieldErrors.push(...toFieldErrors(result.error, 'params'));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // Express 5 made `req.query` a getter-only property, so it cannot be
        // assigned. Redefining it is the supported way to expose parsed values.
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        fieldErrors.push(...toFieldErrors(result.error, 'query'));
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        fieldErrors.push(...toFieldErrors(result.error, 'body'));
      }
    }

    if (fieldErrors.length > 0) {
      next(new ValidationError('Validation failed', fieldErrors));
      return;
    }

    next();
  };
}

/**
 * Typed request helpers.
 *
 * A controller declares what it receives by referencing the same schema the
 * route validates with, so there is exactly one definition of the shape:
 *
 *   async create(req: ValidatedBody<typeof createProviderSchema>, res: Response) {
 *     const input = req.body; // fully typed, already validated
 *   }
 */
export type ValidatedBody<TSchema extends ZodType> = Request<
  Record<string, string>,
  unknown,
  z.infer<TSchema>
>;

export type ValidatedQuery<TSchema extends ZodType> = Request<
  Record<string, string>,
  unknown,
  unknown,
  z.infer<TSchema>
>;

export type ValidatedParams<TSchema extends ZodType> = Request<z.infer<TSchema>>;

export type ValidatedRequest<
  TParams extends ZodType,
  TBody extends ZodType = ZodType,
  TQuery extends ZodType = ZodType,
> = Request<z.infer<TParams>, unknown, z.infer<TBody>, z.infer<TQuery>>;
