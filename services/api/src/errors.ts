import type { FastifyError, FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiError } from "@doorstep/shared";

export type ErrorCode = ApiError["error"]["code"];

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  not_found: 404,
  invalid_state: 409,
  invalid_signature: 400,
  rate_limited: 429,
  chain_error: 502,
  oneclick_error: 502,
  courier_error: 502,
  internal: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

/** A failed NEAR transaction or view call; `message` carries the contract's panic text. */
export class ChainError extends AppError {
  constructor(
    message: string,
    public txHash?: string,
  ) {
    super("chain_error", message);
  }
}

export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new AppError(code, message, details);
};

/** Validates a request body with a shared zod schema. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  throw new AppError("invalid_input", `${where}${first?.message ?? "Invalid request"}`, {
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

export function errorBody(code: ErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { error: details ? { code, message, details } : { code, message } };
}

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.warn({ code: err.code, msg: err.message }, "request failed");
      return reply.status(err.status).send(errorBody(err.code, err.message, err.details));
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      const code: ErrorCode = fe.statusCode === 404 ? "not_found" : fe.statusCode === 429 ? "rate_limited" : "invalid_input";
      return reply.status(fe.statusCode).send(errorBody(code, fe.message));
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send(errorBody("internal", "Something went wrong"));
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send(errorBody("not_found", `No route ${req.method} ${req.url.split("?")[0]}`)));
}
