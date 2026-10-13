import type { SessionRecord, SessionStore, StateRecord, StateStore, User } from "./types.js";

/** Compatible with pg.Pool. The package never creates or migrates your database implicitly. */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export class PostgresStateStore implements StateStore {
  constructor(private readonly db: SqlClient, private readonly namespace: string) {
    if (!namespace) throw new Error("A store namespace is required");
  }
  async put(key: string, record: StateRecord): Promise<void> {
    await this.db.query("INSERT INTO orbita_sdk_states (namespace, key_hash, nonce_hash, expires_at, payload) VALUES ($1, $2, $3, $4, $5::jsonb)", [this.namespace, key, record.nonceHash, record.expiresAt, JSON.stringify(record)]);
  }
  async consume(key: string, nonce: string, now: number): Promise<StateRecord | null> {
    const result = await this.db.query("DELETE FROM orbita_sdk_states WHERE namespace = $1 AND key_hash = $2 AND nonce_hash = $3 AND expires_at > $4 RETURNING payload", [this.namespace, key, nonce, now]);
    return (result.rows[0]?.payload as StateRecord | undefined) ?? null;
  }
}

export class PostgresSessionStore<U extends User = User> implements SessionStore<U> {
  constructor(private readonly db: SqlClient, private readonly namespace: string) {
    if (!namespace) throw new Error("A store namespace is required");
  }
  async put(key: string, record: SessionRecord<U>): Promise<void> {
    await this.db.query("INSERT INTO orbita_sdk_sessions (namespace, key_hash, expires_at, payload) VALUES ($1, $2, $3, $4::jsonb)", [this.namespace, key, record.expiresAt, JSON.stringify(record)]);
  }
  async get(key: string, now: number): Promise<SessionRecord<U> | null> {
    const result = await this.db.query("SELECT payload FROM orbita_sdk_sessions WHERE namespace = $1 AND key_hash = $2 AND expires_at > $3", [this.namespace, key, now]);
    return (result.rows[0]?.payload as SessionRecord<U> | undefined) ?? null;
  }
  async delete(key: string): Promise<void> {
    await this.db.query("DELETE FROM orbita_sdk_sessions WHERE namespace = $1 AND key_hash = $2", [this.namespace, key]);
  }
}
