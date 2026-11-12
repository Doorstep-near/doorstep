import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Demo } from "./demo";
import { AppError, installErrorHandler } from "./errors";
import { registerRoutes } from "./routes";
import type { Deps, OrderService } from "./service";

declare module "fastify" {
  interface FastifyRequest {
    /** Exact request body text (needed to check webhook signatures). */
    rawBody?: string;
  }
}

export interface Built {
  deps: Deps;
  svc: OrderService;
  demo: Demo | null;
}

export function buildApp(built: Built, opts: { logger?: boolean } = {}): FastifyInstance {
  const { deps, svc, demo } = built;
  const app = Fastify({
    logger: opts.logger ? { level: "info", redact: ["req.headers.authorization", 'req.headers["x-dv-signature"]'] } : false,
    trustProxy: true,
  });
  if (opts.logger) {
    // Fastify's two-lines-per-request logging is off (route level "warn"); instead one short
    // line per request, never bodies or headers (they can hold phone numbers and tokens).
    app.addHook("onRoute", (route) => {
      route.logLevel = "warn";
    });
    app.addHook("onResponse", async (req, reply) => {
      if (req.url === "/health") return;
      app.log.info({ method: req.method, url: req.url.split("?")[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, "request");
    });
  }

  // Keep the exact body text (webhook signatures are over raw bytes). Webhooks may
  // send other content types, so anything that parses as JSON is accepted.
  const parse = (strict: boolean) => (req: FastifyRequest, body: string | Buffer, done: (err: Error | null, body?: unknown) => void) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    req.rawBody = text;
    if (!text.trim()) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      if (strict) done(new AppError("invalid_input", "Request body is not valid JSON"), undefined);
      else done(null, text);
    }
  };
  app.removeContentTypeParser("application/json");
  app.removeContentTypeParser("text/plain");
  app.addContentTypeParser("application/json", { parseAs: "string" }, parse(true));
  app.addContentTypeParser("*", { parseAs: "string" }, parse(false));

  const webUrl = deps.config.webUrl;
  app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin/curl requests have no Origin. Demo mode also allows any localhost port (Vite may pick another).
      if (!origin || origin === webUrl) return cb(null, true);
      if (deps.config.demoMode && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  installErrorHandler(app);
  registerRoutes(app, svc, deps, demo);
  return app;
}
