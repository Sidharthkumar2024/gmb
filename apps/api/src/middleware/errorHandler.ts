import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { captureException } from "../lib/observability";

/**
 * Global error handler middleware. Must be the last middleware registered.
 */
export const errorHandler = (
  err: Error | ApiError | ZodError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  console.error("[ERROR]", {
    message: err.message,
    code: err instanceof ApiError ? err.code : err.constructor.name,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    const detail = err.errors
      .map((e) => `${e.path.join(".") || "body"}: ${e.message}`)
      .join("; ");
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.BAD_REQUEST,
        message: `Validation failed: ${detail}`,
      },
    });
    return;
  }

  // Anthropic SDK throws AuthenticationError / APIError with .status — surface it.
  const maybeStatus = (err as { status?: number }).status;
  const looksLikeAnthropic =
    typeof maybeStatus === "number" &&
    /anthropic|claude/i.test(err.message ?? "");
  if (looksLikeAnthropic) {
    // Clamp to a valid HTTP error status. A provider can carry a non-standard
    // status (e.g. 0 or >599) that would make res.status() throw RangeError
    // *inside* this handler — turning a handled error into an unhandled one.
    const status =
      Number.isInteger(maybeStatus) && maybeStatus >= 400 && maybeStatus <= 599
        ? maybeStatus
        : 502;
    res.status(status).json({
      success: false,
      error: {
        code: status === 401 ? ErrorCodes.UNAUTHORIZED : ErrorCodes.BAD_REQUEST,
        // Never echo the raw provider message to the client in production — it
        // can embed model ids, org identifiers, request context, or prompt
        // fragments. Mirror the 500 branch's prod/dev split below.
        message:
          process.env.NODE_ENV === "production"
            ? "AI provider error. Please try again."
            : `AI provider error: ${err.message}`,
      },
    });
    return;
  }

  // 500-class — capture in Sentry. ApiError / ZodError are caller bugs and
  // already returned above; this branch is the truly unexpected one.
  captureException(err, {
    url: req.originalUrl,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message ?? "Internal server error",
    },
  });
};
