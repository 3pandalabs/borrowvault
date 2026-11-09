// Request-log redaction (api/ROUTES.md "Ops"). Pure: no env/db imports.
//
// Fastify's default request serializer logs the full URL, so browse search
// terms (GET /listings?q=...), storage keys (/storage/url?key=...) and other
// query values would sit in the 30-day logs. Keep the path, drop the query.

export function redactUrl(url: string | undefined): string | undefined {
  if (url === undefined) return url;
  const i = url.indexOf("?");
  return i === -1 ? url : `${url.slice(0, i)}?[redacted]`;
}

type ReqLike = {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
};

/** Fastify/pino `req` serializer: the default fields, with the query string redacted. */
export function redactedReqSerializer(req: ReqLike) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

export const loggerOptions = {
  serializers: { req: redactedReqSerializer },
};
