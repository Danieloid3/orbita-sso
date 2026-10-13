import { OrbitaClient } from "./client.js";
import { OrbitaError, safeError } from "./errors.js";
import { cookie, cookieValue, equal, hash, noStore, nowSeconds, randomToken, validateUrl } from "./security.js";
import { MemorySessionStore, MemoryStateStore } from "./stores.js";
import type { MigrationContinuation, PublicSession, SessionRecord, SsoOptions, User } from "./types.js";

export class OrbitaSso<U extends User = User> {
  readonly client: OrbitaClient;
  readonly routePrefix: string;
  private readonly options: SsoOptions<U>;
  private readonly secure: boolean;
  private readonly sessionCookie: string;
  private readonly stateCookie: string;
  private readonly origin: string;
  private readonly allowedOrigins: Set<string>;

  constructor(options: SsoOptions<U>) {
    this.client = new OrbitaClient(options);
    const appUrl = validateUrl(options.appUrl, options.development);
    this.origin = appUrl.origin;
    this.routePrefix = options.routePrefix ?? "/auth/orbita";
    if (appUrl.pathname !== "/" || appUrl.search || !/^\/[a-zA-Z0-9/_-]+$/.test(this.routePrefix) || this.routePrefix.endsWith("/") || this.routePrefix.includes("//") || options.redirectUri !== `${this.origin}${this.routePrefix}/callback`) throw new OrbitaError("configuration_error", 500);
    if (!options.stateStore || !options.sessionStore || (!options.development && (options.stateStore instanceof MemoryStateStore || options.sessionStore instanceof MemorySessionStore))) throw new OrbitaError("configuration_error", 500);
    this.secure = appUrl.protocol === "https:";
    this.sessionCookie = options.sessionCookieName ?? (this.secure ? "__Host-orbita_app_session" : "orbita_app_session");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(this.sessionCookie) || (!this.secure && this.sessionCookie.startsWith("__Host-"))) throw new OrbitaError("configuration_error", 500);
    this.stateCookie = `${this.sessionCookie}_nonce`;
    if (options.sessionSameSite && !["lax", "strict", "none"].includes(options.sessionSameSite)) throw new OrbitaError("configuration_error", 500);
    if (options.sessionSameSite === "none" && !this.secure) throw new OrbitaError("configuration_error", 500);
    if (options.introspection && !["always", "expiry"].includes(options.introspection)) throw new OrbitaError("configuration_error", 500);
    if (options.logout && !["local", "central"].includes(options.logout)) throw new OrbitaError("configuration_error", 500);
    if (options.logout === "central" && !options.postLogoutUri) throw new OrbitaError("configuration_error", 500);
    if (options.postLogoutUri) validateUrl(options.postLogoutUri, options.development);
    this.allowedOrigins = new Set([this.origin]);
    for (const value of options.allowedOrigins ?? []) {
      const url = validateUrl(value, options.development);
      if (url.pathname !== "/" || url.search) throw new OrbitaError("configuration_error", 500);
      this.allowedOrigins.add(url.origin);
    }
    // All redirects are fixed application configuration, never callback query parameters.
    for (const path of [options.successRedirect ?? "/", options.errorRedirect ?? "/login"]) {
      validateUrl(new URL(path, this.origin).href, options.development);
    }
    this.options = { ...options };
  }

  async initialize(): Promise<void> {
    await this.client.initialize();
    const metadata = await this.client.discovery();
    if ((this.options.introspection !== "expiry" && !metadata.introspection_endpoint) || (this.options.migration && !metadata.role_adoption_endpoint) || (this.options.logout === "central" && !metadata.logout_ticket_endpoint)) throw new OrbitaError("configuration_error", 500);
  }

  private redirect(location: string, cookies: string[] = []): Response {
    const headers = new Headers({ Location: location });
    noStore(headers);
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 302, headers });
  }

  private json(value: unknown, status = 200, cookies: string[] = []): Response {
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    noStore(headers);
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(JSON.stringify(value), { status, headers });
  }

  private sessionCookieHeader(value: string, age: number): string {
    return cookie(this.sessionCookie, value, age, this.secure, this.options.sessionSameSite ?? "lax");
  }

  private clearState(): string { return cookie(this.stateCookie, "", 0, this.secure); }

  private async start(migration?: MigrationContinuation): Promise<Response> {
    const state = randomToken();
    const nonce = randomToken();
    const authorization = await this.client.authorizationUrl(state);
    await this.options.stateStore.put(hash(state), { nonceHash: hash(nonce), expiresAt: nowSeconds() + 300, ...(migration ? { migration } : {}) });
    return this.redirect(authorization, [cookie(this.stateCookie, nonce, 300, this.secure)]);
  }

  private async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const nonce = cookieValue(request, this.stateCookie);
    if (!state || !nonce || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || url.searchParams.getAll("state").length !== 1) throw new OrbitaError("invalid_state");
    const record = await this.options.stateStore.consume(hash(state), hash(nonce), nowSeconds());
    if (!record) throw new OrbitaError("invalid_state");
    if (url.searchParams.has("error")) throw new OrbitaError("access_denied", 403);
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.getAll("code").length !== 1) throw new OrbitaError("provider_rejected");
    const token = await this.client.exchangeCode(code);
    const identity = token.identity;
    let user: U;
    if (identity.migration) {
      if (!this.options.migration || record.migration) throw new OrbitaError("migration_denied", 403);
      const account = await this.options.migration.findAccount(identity, request);
      if (!account || typeof account.accountId !== "string" || !account.accountId || !this.options.roles.some((role) => role.key === account.role) || !await this.options.migration.authorizeLink(account, identity, request)) throw new OrbitaError("migration_denied", 403);
      await this.client.adoptRole(token.accessToken, account.role);
      return this.start({ accountId: account.accountId, subject: identity.subject, role: account.role });
    }
    if (record.migration) {
      if (!this.options.migration || identity.subject !== record.migration.subject || identity.roles.length !== 1 || identity.roles[0] !== record.migration.role) throw new OrbitaError("migration_denied", 403);
      user = await this.options.migration.linkAccount(record.migration.accountId, identity);
    } else if (this.options.resolveUser) {
      user = await this.options.resolveUser(identity, request);
    } else {
      // A custom U must be supplied through resolveUser; the default is the public User projection.
      user = { id: identity.subject, email: identity.email, name: identity.name } as unknown as U;
    }
    if (!user || typeof user.id !== "string" || !user.id || token.expiresAt <= nowSeconds()) throw new OrbitaError("access_denied", 403);
    const sessionId = randomToken();
    const session: SessionRecord<U> = { user, identity, providerToken: token.accessToken, expiresAt: token.expiresAt, csrfToken: randomToken() };
    await this.options.sessionStore.put(hash(sessionId), session);
    // Rotate an existing local session to prevent fixation and stale identities.
    const previous = cookieValue(request, this.sessionCookie);
    if (previous) await this.options.sessionStore.delete(hash(previous));
    return this.redirect(new URL(this.options.successRedirect ?? "/", this.origin).href, [this.clearState(), this.sessionCookieHeader(sessionId, token.expiresAt - nowSeconds())]);
  }

  private async readSession(request: Request, introspect = true): Promise<SessionRecord<U> | null> {
    const sessionId = cookieValue(request, this.sessionCookie);
    if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
    const key = hash(sessionId);
    const session = await this.options.sessionStore.get(key, nowSeconds());
    if (!session) return null;
    if (session.expiresAt <= nowSeconds() || (introspect && this.options.introspection !== "expiry" && !await this.client.introspect(session.providerToken))) {
      await this.options.sessionStore.delete(key);
      return null;
    }
    return session;
  }

  /** Use this in server-side authorization guards. Never read roles from a user-controlled cookie. */
  async getSession(request: Request): Promise<PublicSession<U> | null> {
    const session = await this.readSession(request);
    if (!session) return null;
    return { user: session.user, identity: session.identity, expiresAt: session.expiresAt, csrfToken: session.csrfToken };
  }

  private async logout(request: Request): Promise<Response> {
    // Local logout remains possible during an Orbita outage (no introspection here).
    const session = await this.readSession(request, false);
    if (!session) return this.json({ error: "session_expired" }, 401, [this.sessionCookieHeader("", 0)]);
    if (!this.allowedOrigins.has(request.headers.get("origin") ?? "") || !equal(request.headers.get("x-orbita-csrf") ?? "", session.csrfToken)) throw new OrbitaError("csrf_failed", 403);
    const sessionId = cookieValue(request, this.sessionCookie)!;
    await this.options.sessionStore.delete(hash(sessionId));
    let logoutUrl: string | null = null;
    let centralLogoutError: string | null = null;
    if (this.options.logout === "central") {
      try { logoutUrl = await this.client.centralLogoutUrl(this.options.postLogoutUri!); }
      catch (error) { centralLogoutError = safeError(error).code; this.report(error); }
    }
    return this.json({ logoutUrl, centralLogoutError }, 200, [this.sessionCookieHeader("", 0), this.clearState()]);
  }

  private report(error: unknown): void {
    const safe = safeError(error);
    try { this.options.onError?.({ code: safe.code, status: safe.status }); } catch { /* Reporting must not break authentication. */ }
  }

  /** Returns null for other routes, allowing the application's existing router to continue. */
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const route = url.pathname.slice(this.routePrefix.length);
    if (!url.pathname.startsWith(`${this.routePrefix}/`) || !["/login", "/callback", "/session", "/logout"].includes(route)) return null;
    const expected = route === "/logout" ? "POST" : "GET";
    if (request.method !== expected) {
      const response = this.json({ error: "method_not_allowed" }, 405);
      response.headers.set("Allow", expected);
      return response;
    }
    try {
      if (route === "/login") return await this.start();
      if (route === "/callback") return await this.callback(request);
      if (route === "/logout") return await this.logout(request);
      const session = await this.getSession(request);
      return session ? this.json(session) : this.json({ error: "session_expired" }, 401, [this.sessionCookieHeader("", 0)]);
    } catch (error) {
      this.report(error);
      const safe = safeError(error);
      if (route === "/callback" || route === "/login") {
        const target = new URL(this.options.errorRedirect ?? "/login", this.origin);
        target.searchParams.set("error", safe.code);
        return this.redirect(target.href, [this.clearState()]);
      }
      return this.json({ error: safe.code }, safe.status);
    }
  }
}

export function createOrbitaSso<U extends User = User>(options: SsoOptions<U>): OrbitaSso<U> {
  return new OrbitaSso(options);
}
