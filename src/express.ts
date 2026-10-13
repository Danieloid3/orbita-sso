import type { NextFunction, Request as ExpressRequest, RequestHandler, Response as ExpressResponse } from "express";
import type { OrbitaSso } from "./sso.js";
import type { User } from "./types.js";

/** Builds a Web Request with the configured public origin. Does not trust Host/X-Forwarded-Host. */
export function toWebRequest(request: ExpressRequest, appUrl: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (value) headers.set(name, value.join(", "));
  }
  const base = new URL(appUrl);
  const path = new URL(request.originalUrl, base.origin);
  // Absolute or protocol-relative URLs must never change the configured origin.
  const url = new URL(path.pathname + path.search, base.origin);
  return new Request(url, { method: request.method, headers });
}

export function orbitaExpress<U extends User>(sso: OrbitaSso<U>, options: { appUrl: string }): RequestHandler {
  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction): Promise<void> => {
    try {
      const response = await sso.handle(toWebRequest(req, options.appUrl));
      if (!response) { next(); return; }
      for (const [key, value] of response.headers) if (key !== "set-cookie") res.setHeader(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      res.status(response.status).send(await response.text());
    } catch (error) { next(error); }
  };
}
