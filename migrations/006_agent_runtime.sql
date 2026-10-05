CREATE TABLE agent_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES model_tasks(id),
  parent_id TEXT REFERENCES agent_jobs(id),
  worker_id TEXT NOT NULL CHECK(worker_id IN ('operator','researcher','creator','reviewer')),
  brief TEXT NOT NULL CHECK(length(brief) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','completed','blocked','interrupted')),
  result TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_jobs_task ON agent_jobs(task_id);
CREATE TABLE agent_memory (
  worker_id TEXT NOT NULL CHECK(worker_id IN ('operator','researcher','creator','reviewer')),
  key TEXT NOT NULL,
  value TEXT NOT NULL CHECK(length(value) BETWEEN 1 AND 2000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(worker_id,key)
);
CREATE TABLE agent_artifacts (
  task_id TEXT NOT NULL REFERENCES model_tasks(id),
  name TEXT NOT NULL,
  worker_id TEXT NOT NULL CHECK(worker_id IN ('operator','researcher','creator','reviewer')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(task_id,name)
);
CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES model_tasks(id),
  job_id TEXT REFERENCES agent_jobs(id),
  worker_id TEXT NOT NULL CHECK(worker_id IN ('operator','researcher','creator','reviewer')),
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_events_task ON agent_events(task_id,id);
ALTER TABLE model_steps ADD COLUMN job_id TEXT REFERENCES agent_jobs(id);
ALTER TABLE model_steps ADD COLUMN action TEXT;
ALTER TABLE model_steps ADD COLUMN observation TEXT;
ALTER TABLE model_tasks ADD COLUMN cancelled_at INTEGER;
