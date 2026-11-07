import { format } from "node:util";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { waitUntil } from "@vercel/functions";
import { redactText } from "./analytics-redact";
import { POSTHOG_INGEST_HOST } from "./posthog-server";

const LEVELS = {
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.INFO,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
} as const;

/** The digest Next.js gives a server render error: the key that joins this log line to its `$exception`. */
const digestOf = (args: unknown[]) => {
  for (const arg of args) {
    const digest = arg && typeof arg === "object" ? (arg as { digest?: unknown }).digest : undefined;
    if (typeof digest === "string") return digest;
  }
};

/**
 * Copies the server's console to PostHog Logs (OTLP), so one place holds the
 * logs and the errors. Next.js writes the real error behind a production
 * render failure to `console.error`, with the digest that `onRequestError`
 * reports, so the two join on `digest`. Lines are redacted like exception
 * messages, and the console itself still prints as before.
 */
export function forwardConsoleToPostHog(token: string) {
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "demo-queue-web",
      "deployment.environment": process.env.VERCEL_ENV ?? "development",
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${POSTHOG_INGEST_HOST}/i/v1/logs`,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          timeoutMillis: 5000,
        }),
      }),
    ],
  });
  const logger = provider.getLogger("console");

  // A Vercel function may freeze once it has answered, so each burst of lines
  // is flushed while the request is kept open. Outside Vercel waitUntil is a no-op.
  let flush: Promise<void> | undefined;
  const flushSoon = () => {
    flush ??= new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
      flush = undefined;
      return provider.forceFlush();
    }).catch(() => {});
    waitUntil(flush);
  };

  let emitting = false;
  for (const level of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      // Whatever the exporter itself prints must not loop back into it.
      if (emitting) return;
      emitting = true;
      try {
        const digest = digestOf(args);
        logger.emit({
          severityNumber: LEVELS[level],
          severityText: level === "log" ? "INFO" : level.toUpperCase(),
          body: redactText(format(...args), 8000),
          ...(digest ? { attributes: { digest } } : {}),
        });
        flushSoon();
      } catch {
        // Logging must never break the request that logged.
      } finally {
        emitting = false;
      }
    };
  }
}
