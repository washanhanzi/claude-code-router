import { FastifyRequest, FastifyReply } from "fastify";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  type?: string;
}

export function createApiError(
  message: string,
  statusCode: number = 500,
  code: string = "internal_error",
  type: string = "api_error"
): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.code = code;
  error.type = type;
  return error;
}

export async function errorHandler(
  error: ApiError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Skip if response already sent/ended/destroyed - avoids secondary errors
  if (reply.sent || reply.raw.writableEnded || reply.raw.destroyed) {
    return;
  }

  // Suppress benign client disconnection errors (common in K8s environments)
  const errorCode = (error as any).code;
  if (
    (errorCode === 'ERR_STREAM_PREMATURE_CLOSE' || errorCode === 'ECONNRESET' || errorCode === 'EPIPE') &&
    (request.raw.aborted || reply.raw.destroyed)
  ) {
    request.log.debug({ err: error }, 'Client closed connection');
    return;
  }

  request.log.error(error);

  const statusCode = error.statusCode || 500;
  const response = {
    error: {
      message: error.message + error.stack || "Internal Server Error",
      type: error.type || "api_error",
      code: error.code || "internal_error",
    },
  };

  return reply.code(statusCode).send(response);
}
