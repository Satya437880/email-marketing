import type { FastifyRequest } from "fastify";
import { z, type ZodTypeAny } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "invalid_request", "Some fields are invalid", r.error.flatten());
  return r.data;
}

export const body = <T extends ZodTypeAny>(req: FastifyRequest, schema: T) => parse(schema, req.body);
export const query = <T extends ZodTypeAny>(req: FastifyRequest, schema: T) => parse(schema, req.query);
export const params = <T extends ZodTypeAny>(req: FastifyRequest, schema: T) => parse(schema, req.params);

export const uuid = z.string().uuid();
export const idParams = z.object({ ws: z.string(), id: uuid });

export function notFound(what = "Resource"): never {
  throw new HttpError(404, "not_found", `${what} not found`);
}
