CREATE TABLE team_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK(channel IN ('general','product','finance')),
  sender_id TEXT NOT NULL CHECK(sender_id IN ('owner','researcher','creator','reviewer','operator','treasury')),
  recipient_id TEXT CHECK(recipient_id IN ('owner','researcher','creator','reviewer','operator','treasury')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  run_id TEXT REFERENCES workflow_runs(id),
  function_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX team_messages_channel_id ON team_messages(channel,id);
