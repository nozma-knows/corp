CREATE TABLE model_tasks (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK(channel IN ('general','product','finance')),
  goal TEXT NOT NULL CHECK(length(goal) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','blocked')),
  active_worker TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE model_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES model_tasks(id),
  sequence INTEGER NOT NULL,
  worker_id TEXT NOT NULL CHECK(worker_id IN ('operator','researcher','creator','reviewer')),
  recipient_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT,
  effort TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
  message TEXT,
  artifact TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id,sequence)
);
ALTER TABLE team_messages ADD COLUMN model_task_id TEXT REFERENCES model_tasks(id);
