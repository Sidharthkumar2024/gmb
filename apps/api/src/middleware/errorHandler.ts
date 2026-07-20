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
    res.status(maybeStatus).json({
      success: false,
      error: {
        code: maybeStatus === 401 ? ErrorCodes.UNAUTHORIZED : ErrorCodes.BAD_REQUEST,
        message: `AI provider error: ${err.message}`,
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
