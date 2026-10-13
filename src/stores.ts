import { equal } from "./security.js";
import type { SessionRecord, SessionStore, StateRecord, StateStore, User } from "./types.js";

/** Development only. Production needs an atomic shared store (e.g. Postgres). */
export class MemoryStateStore implements StateStore {
  private records = new Map<string, StateRecord>();
  async put(key: string, record: StateRecord): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, value] of this.records) if (value.expiresAt <= now) this.records.delete(key);
    this.records.set(key, structuredClone(record));
  }
  async consume(key: string, nonce: string, now: number): Promise<StateRecord | null> {
    const record = this.records.get(key);
    if (!record) return null;
    if (record.expiresAt <= now) { this.records.delete(key); return null; }
    if (!equal(record.nonceHash, nonce)) return null;
    this.records.delete(key);
    return structuredClone(record);
  }
}

/** Development only. Tokens and sessions disappear on restart. */
export class MemorySessionStore<U extends User = User> implements SessionStore<U> {
  private records = new Map<string, SessionRecord<U>>();
  async put(key: string, record: SessionRecord<U>): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, value] of this.records) if (value.expiresAt <= now) this.records.delete(key);
    this.records.set(key, structuredClone(record));
  }
  async get(key: string, now: number): Promise<SessionRecord<U> | null> {
    const record = this.records.get(key);
    if (!record) return null;
    if (record.expiresAt <= now) { this.records.delete(key); return null; }
    return structuredClone(record);
  }
  async delete(key: string): Promise<void> { this.records.delete(key); }
}
