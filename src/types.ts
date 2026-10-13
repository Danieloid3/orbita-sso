export interface Role {
  key: string;
  displayName: string;
  description?: string;
}

export interface Identity {
  subject: string;
  email: string;
  name: string;
  roles: string[];
  tokenId: string;
  expiresAt: number;
  migration: boolean;
  attributes: Record<string, string>;
}

/** Server-only. Never send accessToken to the browser. expiresAt is Unix seconds. */
export interface VerifiedToken {
  identity: Identity;
  accessToken: string;
  expiresAt: number;
}

export interface ClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  roles: readonly Role[];
  roleMode?: "single" | "multiple";
  syncRolesOnInitialize?: boolean;
  development?: boolean;
  timeoutMs?: number;
  cacheTtlMs?: number;
  clockToleranceSeconds?: number;
  fetch?: typeof globalThis.fetch;
}

export interface Discovery {
  contract_version: "1.0";
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  introspection_endpoint?: string;
  role_adoption_endpoint?: string;
  logout_ticket_endpoint?: string;
  role_catalog_sync_endpoint?: string;
  token_signing_alg_values_supported: string[];
}

export interface MigrationContinuation {
  accountId: string;
  subject: string;
  role: string;
}

export interface StateRecord {
  nonceHash: string;
  expiresAt: number;
  migration?: MigrationContinuation;
}

/** consume must check nonce + expiry and remove the record atomically across replicas. */
export interface StateStore {
  put(stateHash: string, record: StateRecord): Promise<void>;
  consume(stateHash: string, nonceHash: string, now: number): Promise<StateRecord | null>;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type User = { id: string; [key: string]: JsonValue };

/** This entire record is server-only; protect the provider token at rest. */
export interface SessionRecord<U extends User = User> {
  user: U;
  identity: Identity;
  providerToken: string;
  expiresAt: number;
  csrfToken: string;
}

/** Keys passed to this adapter are SHA-256 digests, not raw session cookies. */
export interface SessionStore<U extends User = User> {
  put(sessionHash: string, session: SessionRecord<U>): Promise<void>;
  get(sessionHash: string, now: number): Promise<SessionRecord<U> | null>;
  delete(sessionHash: string): Promise<void>;
}

export interface LegacyAccount {
  accountId: string;
  /** Key in the complete application role catalog, not a local display label. */
  role: string;
}

export interface MigrationAdapter<U extends User = User> {
  findAccount(identity: Identity, request: Request): Promise<LegacyAccount | null>;
  /** Require proof of local ownership or an administrator-approved mapping. Email alone is insufficient. */
  authorizeLink(account: LegacyAccount, identity: Identity, request: Request): Promise<boolean>;
  /** Called ONLY after a second authorization proves the same subject and adopted role. Atomic/idempotent. */
  linkAccount(accountId: string, identity: Identity): Promise<U>;
}

export interface SsoOptions<U extends User = User> extends ClientOptions {
  /** Public origin of these auth routes, not an origin inferred from forwarded headers. */
  appUrl: string;
  stateStore: StateStore;
  sessionStore: SessionStore<U>;
  routePrefix?: string;
  successRedirect?: string;
  errorRedirect?: string;
  sessionCookieName?: string;
  sessionSameSite?: "lax" | "strict" | "none";
  /** Extra browser frontend origins allowed for POST logout; CORS remains application-owned. */
  allowedOrigins?: readonly string[];
  /** always gives current revocation checks; expiry bounds access to the original JWT expiration. */
  introspection?: "always" | "expiry";
  logout?: "local" | "central";
  postLogoutUri?: string;
  resolveUser?: (identity: Identity, request: Request) => Promise<U>;
  migration?: MigrationAdapter<U>;
  /** Receives safe error codes only, never request URLs, codes, secrets or tokens. */
  onError?: (error: { code: string; status: number }) => void;
}

export interface PublicSession<U extends User = User> {
  user: U;
  identity: Identity;
  expiresAt: number;
  csrfToken: string;
}
