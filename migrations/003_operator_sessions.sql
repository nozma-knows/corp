CREATE TABLE operator_sessions (
    token_hash TEXT PRIMARY KEY,
    credential_version TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_operator_sessions_expires ON operator_sessions(expires_at);
CREATE TABLE login_attempts (
    subject_hash TEXT PRIMARY KEY,
    window_started INTEGER NOT NULL,
    failures INTEGER NOT NULL CHECK (failures >= 0)
);
