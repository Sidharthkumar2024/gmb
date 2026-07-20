// Error reporting shim.
//
// The monorepo wires Sentry here. This app keeps the same call signature so the
// ported errorHandler needs no edits, but reports to the console until a DSN is
// configured — a missing DSN must never throw from inside an error handler.

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  // Placeholder for a real Sentry client. Logged so an operator who has set a
  // DSN can see that reporting is not actually wired up yet, rather than
  // assuming errors are reaching their dashboard.
  console.error("[observability] would report to Sentry:", err, context ?? {});
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  console.warn("[observability] would report to Sentry:", message, context ?? {});
}
