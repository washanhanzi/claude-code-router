import { ProxyAgent } from "undici";
import { UnifiedChatRequest } from "../types/llm";

export function sendUnifiedRequest(
  url: URL | string,
  request: UnifiedChatRequest,
  config: any,
  logger?: any,
  context: any
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (config.headers) {
    Object.entries(config.headers).forEach(([key, value]) => {
      if (value) {
        headers.set(key, value as string);
      }
    });
  }
  let combinedSignal: AbortSignal;
  const timeoutSignal = AbortSignal.timeout(config.TIMEOUT ?? 60 * 1000 * 60);

  if (config.signal) {
    const controller = new AbortController();
    const abortHandler = () => controller.abort();
    config.signal.addEventListener("abort", abortHandler);
    timeoutSignal.addEventListener("abort", abortHandler);
    combinedSignal = controller.signal;
  } else {
    combinedSignal = timeoutSignal;
  }

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: headers,
    body: JSON.stringify(request),
    signal: combinedSignal,
  };

  if (config.httpsProxy) {
    (fetchOptions as any).dispatcher = new ProxyAgent(
      new URL(config.httpsProxy).toString()
    );
  }
  const timeoutMs = config.TIMEOUT ?? 60 * 1000 * 60;
  const requestUrl = typeof url === "string" ? url : url.toString();
  const requestStartTime = Date.now();

  logger?.info(
    {
      type: "provider_request_start",
      reqId: context?.req?.id,
      requestUrl,
      timeoutMs,
      useProxy: !!config.httpsProxy,
    },
    "Starting provider request"
  );

  logger?.debug(
    {
      reqId: context?.req?.id,
      request: fetchOptions,
      headers: Object.fromEntries(headers.entries()),
      requestUrl,
      useProxy: config.httpsProxy,
    },
    "final request"
  );

  return fetch(requestUrl, fetchOptions)
    .then((response) => {
      const durationMs = Date.now() - requestStartTime;
      logger?.info(
        {
          type: "provider_request_complete",
          reqId: context?.req?.id,
          requestUrl,
          statusCode: response.status,
          durationMs,
        },
        "Provider request completed"
      );
      return response;
    })
    .catch((error) => {
      const durationMs = Date.now() - requestStartTime;
      const isTimeout = error.name === "TimeoutError" || error.code === "UND_ERR_CONNECT_TIMEOUT";
      logger?.error(
        {
          type: "provider_request_error",
          reqId: context?.req?.id,
          requestUrl,
          durationMs,
          timeoutMs,
          isTimeout,
          error: {
            name: error.name,
            message: error.message,
            code: error.code,
            cause: error.cause?.message,
          },
        },
        isTimeout ? "Provider request timed out" : "Provider request failed"
      );
      throw error;
    });
}
