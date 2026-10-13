import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { OrbitaError } from "./errors.js";
import { nowSeconds, validateUrl } from "./security.js";
import type { ClientOptions, Discovery, Identity, VerifiedToken } from "./types.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrbitaClient {
  readonly options: Readonly<ClientOptions>;
  private readonly fetcher: typeof globalThis.fetch;
  private metadata: { value: Discovery; expiresAt: number } | undefined;
  private keyCache: { value: JWK[]; expiresAt: number } | undefined;
  private initialization: Promise<void> | undefined;
  private metadataRequest: Promise<Discovery> | undefined;
  private keysRequest: Promise<JWK[]> | undefined;
  private lastForcedKeyRefresh = 0;

  constructor(options: ClientOptions) {
    const base = validateUrl(options.baseUrl, options.development);
    validateUrl(options.redirectUri, options.development);
    if (base.search || base.pathname !== "/" || !options.clientId || options.clientId.length < 2 || options.clientId.length > 255 || !options.clientSecret || options.clientSecret.length > 512) {
      throw new OrbitaError("configuration_error", 500);
    }
    if (!Array.isArray(options.roles) || options.roles.length > 100) throw new OrbitaError("configuration_error", 500);
    const keys = new Set<string>();
    for (const role of options.roles) {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(role.key) || keys.has(role.key) || !role.displayName?.trim() || role.displayName.length > 120 || (role.description?.length ?? 0) > 500) {
        throw new OrbitaError("configuration_error", 500);
      }
      keys.add(role.key);
    }
    for (const [value, min, max] of [
      [options.timeoutMs ?? 8000, 100, 60000],
      [options.cacheTtlMs ?? 300000, 1000, 3600000],
      [options.clockToleranceSeconds ?? 30, 0, 60],
    ]) {
      if (!Number.isInteger(value) || value! < min! || value! > max!) throw new OrbitaError("configuration_error", 500);
    }
    if (options.roleMode && !["single", "multiple"].includes(options.roleMode)) throw new OrbitaError("configuration_error", 500);
    this.options = Object.freeze({ ...options, baseUrl: base.origin, roles: Object.freeze(options.roles.map((role) => Object.freeze({ ...role }))) });
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  /** Syncs the COMPLETE role catalog once per client instance, before accepting traffic. */
  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        await this.discovery();
        if (this.options.syncRolesOnInitialize !== false) await this.syncRoles();
      })().catch((error: unknown) => { this.initialization = undefined; throw error; });
    }
    return this.initialization;
  }

  private trustedEndpoint(value: string): string {
    const endpoint = validateUrl(value, this.options.development);
    if (endpoint.origin !== this.options.baseUrl) throw new OrbitaError("configuration_error", 500);
    return endpoint.href;
  }

  private async request(url: string, method = "GET", body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(this.trustedEndpoint(url), {
        method, redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs ?? 8000),
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        throw new OrbitaError(response.status === 429 || response.status >= 500 ? "provider_unavailable" : "provider_rejected", response.status === 429 || response.status >= 500 ? 503 : response.status === 409 ? 409 : response.status === 403 ? 403 : 401);
      }
      const value: unknown = await response.json();
      if (!object(value)) throw new OrbitaError("provider_rejected", 502);
      return value;
    } catch (error) {
      if (error instanceof OrbitaError) throw error;
      throw new OrbitaError("provider_unavailable", 503);
    }
  }

  async discovery(): Promise<Discovery> {
    if (this.metadata && this.metadata.expiresAt > Date.now()) return this.metadata.value;
    if (!this.metadataRequest) {
      this.metadataRequest = (async () => {
        const value = await this.request(`${this.options.baseUrl}/api/.well-known/orbita-configuration`);
        if (value.contract_version !== "1.0" || value.issuer !== this.options.baseUrl || !Array.isArray(value.token_signing_alg_values_supported) || !value.token_signing_alg_values_supported.includes("RS256")) {
          throw new OrbitaError("configuration_error", 500);
        }
        for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
          if (typeof value[key] !== "string") throw new OrbitaError("configuration_error", 500);
          this.trustedEndpoint(value[key]);
        }
        for (const key of ["introspection_endpoint", "role_adoption_endpoint", "logout_ticket_endpoint", "role_catalog_sync_endpoint"]) {
          if (value[key] !== undefined) {
            if (typeof value[key] !== "string") throw new OrbitaError("configuration_error", 500);
            this.trustedEndpoint(value[key].replace("{client_id}", encodeURIComponent(this.options.clientId)));
          }
        }
        const discovery = value as unknown as Discovery;
        this.metadata = { value: discovery, expiresAt: Date.now() + (this.options.cacheTtlMs ?? 300000) };
        return discovery;
      })().finally(() => { this.metadataRequest = undefined; });
    }
    return this.metadataRequest;
  }

  private async endpoint(key: keyof Discovery): Promise<string> {
    const metadata = await this.discovery();
    const value = metadata[key];
    if (typeof value !== "string") throw new OrbitaError("configuration_error", 500);
    return this.trustedEndpoint(value.replace("{client_id}", encodeURIComponent(this.options.clientId)));
  }

  async syncRoles(): Promise<void> {
    await this.request(await this.endpoint("role_catalog_sync_endpoint"), "PUT", {
      client_secret: this.options.clientSecret,
      roles: this.options.roles.map((role) => ({ key: role.key, display_name: role.displayName, description: role.description ?? "" })),
    });
  }

  async authorizationUrl(state: string): Promise<string> {
    await this.initialize();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new OrbitaError("invalid_state");
    const url = new URL(await this.endpoint("authorization_endpoint"));
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("state", state);
    return url.href;
  }

  async exchangeCode(code: string): Promise<VerifiedToken> {
    await this.initialize();
    if (typeof code !== "string" || code.length < 32 || code.length > 512) throw new OrbitaError("provider_rejected");
    // The code is single-use. Never automatically retry this request.
    const payload = await this.request(await this.endpoint("token_endpoint"), "POST", {
      code, client_id: this.options.clientId, client_secret: this.options.clientSecret, redirect_uri: this.options.redirectUri,
    });
    if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number" || !Number.isSafeInteger(payload.expires_in) || payload.expires_in <= 0 || typeof payload.token_type !== "string" || payload.token_type.toLowerCase() !== "bearer") {
      throw new OrbitaError("invalid_token");
    }
    const identity = await this.verifyToken(payload.access_token);
    const expiresAt = Math.min(identity.expiresAt, nowSeconds() + payload.expires_in);
    if (expiresAt <= nowSeconds()) throw new OrbitaError("invalid_token");
    return { identity, accessToken: payload.access_token, expiresAt };
  }

  private async keys(force = false): Promise<JWK[]> {
    if (!force && this.keyCache && this.keyCache.expiresAt > Date.now()) return this.keyCache.value;
    if (!this.keysRequest) {
      this.keysRequest = (async () => {
        const data = await this.request(await this.endpoint("jwks_uri"));
        if (!Array.isArray(data.keys) || data.keys.length > 100 || !data.keys.every(object)) throw new OrbitaError("invalid_token");
        const keys = data.keys as JWK[];
        this.keyCache = { value: keys, expiresAt: Date.now() + (this.options.cacheTtlMs ?? 300000) };
        return keys;
      })().finally(() => { this.keysRequest = undefined; });
    }
    return this.keysRequest;
  }

  async verifyToken(token: string): Promise<Identity> {
    try {
      if (typeof token !== "string" || token.length > 8192) throw new OrbitaError("invalid_token");
      const header = decodeProtectedHeader(token);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 255) throw new OrbitaError("invalid_token");
      const select = (keys: JWK[]) => keys.filter((key) => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256" && (!key.use || key.use === "sig") && !key.d);
      let matches = select(await this.keys());
      if (matches.length === 0 && Date.now() - this.lastForcedKeyRefresh > 1000) {
        this.lastForcedKeyRefresh = Date.now();
        matches = select(await this.keys(true));
      }
      if (matches.length !== 1) throw new OrbitaError("invalid_token");
      const { payload } = await jwtVerify(token, await importJWK(matches[0]!, "RS256"), {
        algorithms: ["RS256"], audience: this.options.clientId,
        clockTolerance: this.options.clockToleranceSeconds ?? 30,
        requiredClaims: ["sub", "email", "name", "aud", "roles", "jti", "exp"],
      });
      // Orbita v1 has no iss/iat/nbf. Trust derives from discovery origin, JWKS and exact audience.
      if (typeof payload.sub !== "string" || !UUID.test(payload.sub) || typeof payload.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(payload.email) || typeof payload.name !== "string" || !payload.name.trim() || typeof payload.jti !== "string" || !payload.jti || payload.aud !== this.options.clientId || typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || !Array.isArray(payload.roles) || !payload.roles.every((role): role is string => typeof role === "string") || new Set(payload.roles).size !== payload.roles.length || payload.roles.length > 100 || (payload.migration !== undefined && typeof payload.migration !== "boolean")) {
        throw new OrbitaError("invalid_token");
      }
      const migration = payload.migration === true;
      const catalog = new Set(this.options.roles.map((role) => role.key));
      if (payload.roles.some((role) => !catalog.has(role)) || (this.options.roleMode === "single" && payload.roles.length > 1) || (migration ? payload.roles.length !== 0 : payload.roles.length === 0)) {
        throw new OrbitaError("access_denied", 403);
      }
      if (payload.attributes !== undefined && (!object(payload.attributes) || !Object.values(payload.attributes).every((value) => typeof value === "string"))) throw new OrbitaError("invalid_token");
      return { subject: payload.sub, email: payload.email, name: payload.name, roles: [...payload.roles], tokenId: payload.jti, expiresAt: payload.exp, migration, attributes: (payload.attributes ?? {}) as Record<string, string> };
    } catch (error) {
      if (error instanceof OrbitaError) throw error;
      throw new OrbitaError("invalid_token");
    }
  }

  async introspect(token: string): Promise<boolean> {
    const data = await this.request(await this.endpoint("introspection_endpoint"), "POST", {
      token, client_id: this.options.clientId, client_secret: this.options.clientSecret,
    });
    if (typeof data.active !== "boolean") throw new OrbitaError("provider_rejected", 502);
    return data.active;
  }

  async adoptRole(token: string, role: string): Promise<void> {
    const identity = await this.verifyToken(token);
    if (!identity.migration || identity.roles.length || identity.expiresAt <= nowSeconds() || !this.options.roles.some((entry) => entry.key === role)) throw new OrbitaError("migration_denied", 403);
    const data = await this.request(await this.endpoint("role_adoption_endpoint"), "POST", {
      token, role, client_id: this.options.clientId, client_secret: this.options.clientSecret,
    });
    if (data.reauthorize !== true || data.role !== role) throw new OrbitaError("migration_denied", 403);
  }

  async centralLogoutUrl(postLogoutUri: string): Promise<string> {
    validateUrl(postLogoutUri, this.options.development);
    const data = await this.request(await this.endpoint("logout_ticket_endpoint"), "POST", {
      client_id: this.options.clientId, client_secret: this.options.clientSecret, post_logout_uri: postLogoutUri,
    });
    if (typeof data.logout_url !== "string") throw new OrbitaError("provider_rejected", 502);
    const url = new URL(this.trustedEndpoint(data.logout_url));
    if (url.pathname !== "/api/auth/end-session" || !url.searchParams.get("ticket") || [...url.searchParams.keys()].some((key) => key !== "ticket")) throw new OrbitaError("provider_rejected", 502);
    return url.href;
  }
}
