import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OrbitaError } from "./errors.js";

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
export const randomToken = (): string => randomBytes(32).toString("base64url");
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateUrl(value: string, development = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OrbitaError("configuration_error", 500); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(development && local && url.protocol === "http:"))) {
    throw new OrbitaError("configuration_error", 500);
  }
  return url;
}

export function cookieValue(request: Request, name: string): string | null {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  try { return decodeURIComponent(matches[0]!.slice(name.length + 1)); } catch { return null; }
}

export function cookie(name: string, value: string, maxAge: number, secure: boolean, sameSite = "lax"): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function noStore(headers: Headers): void {
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
}
