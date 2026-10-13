-- Apply through the application's migration system before starting the SDK.
-- These SDK tables are independent from the application's users table.
CREATE TABLE IF NOT EXISTS orbita_sdk_states (
    namespace text NOT NULL,
    key_hash text NOT NULL,
    nonce_hash text NOT NULL,
    expires_at bigint NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (namespace, key_hash)
);
CREATE INDEX IF NOT EXISTS orbita_sdk_states_expiry ON orbita_sdk_states (expires_at);

CREATE TABLE IF NOT EXISTS orbita_sdk_sessions (
    namespace text NOT NULL,
    key_hash text NOT NULL,
    expires_at bigint NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (namespace, key_hash)
);
CREATE INDEX IF NOT EXISTS orbita_sdk_sessions_expiry ON orbita_sdk_sessions (expires_at);

-- Schedule this cleanup separately; it does not affect active records.
-- DELETE FROM orbita_sdk_states WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
-- DELETE FROM orbita_sdk_sessions WHERE expires_at <= EXTRACT(EPOCH FROM NOW());
