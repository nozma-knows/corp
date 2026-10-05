import type { Database } from './database.js';
import type {
  AgentAction,
  AgentJob,
  AgentMemory,
  AgentArtifact,
} from '../shared/agent-contracts.js';
import { AGENT_LIMITS } from './agent-protocol.js';
import { WORKERS } from './registry.js';
import { balances } from './treasury.js';

export class ToolDenied extends Error {}
type ToolAction = Exclude<AgentAction, { type: 'delegate' | 'complete' | 'blocked' }>;

/** The application owns every tool. No model-supplied executable code or filesystem paths. */
export function executeAgentTool(
  db: Database,
  job: AgentJob,
  action: ToolAction,
  now: number,
): string {
  switch (action.type) {
    case 'company.read': {
      const company = balances(db, now);
      return JSON.stringify({
        mode: 'virtual simulation',
        company,
        team: WORKERS.map(({ id, name, position, manager_id }) => ({
          id,
          name,
          position,
          manager_id,
          enabled: !!db.get<{ enabled: number }>('SELECT enabled FROM workers WHERE id=?', id)
            ?.enabled,
        })),
      });
    }
    case 'memory.read':
      return JSON.stringify(
        db.get<AgentMemory>(
          'SELECT * FROM agent_memory WHERE worker_id=? AND key=?',
          job.worker_id,
          action.key,
        ) ?? { key: action.key, value: null },
      );
    case 'memory.write': {
      const exists = db.get(
        'SELECT key FROM agent_memory WHERE worker_id=? AND key=?',
        job.worker_id,
        action.key,
      );
      if (
        !exists &&
        db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM agent_memory WHERE worker_id=?',
          job.worker_id,
        )!.n >= AGENT_LIMITS.memoryKeys
      )
        throw new ToolDenied(
          'Memory is full. Update an existing key or ask the owner to clear an entry.',
        );
      db.run(
        'INSERT INTO agent_memory(worker_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(worker_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
        job.worker_id,
        action.key,
        action.value,
        now,
      );
      return JSON.stringify({ saved: action.key });
    }
    case 'artifact.read':
      return JSON.stringify(
        db.get<AgentArtifact>(
          'SELECT name,worker_id,content,updated_at FROM agent_artifacts WHERE task_id=? AND name=?',
          job.task_id,
          action.name,
        ) ?? { name: action.name, content: null },
      );
    case 'artifact.save': {
      const existing = db.get<AgentArtifact>(
        'SELECT * FROM agent_artifacts WHERE task_id=? AND name=?',
        job.task_id,
        action.name,
      );
      if (action.name === 'final-deliverable' || action.name.startsWith('job-'))
        throw new ToolDenied(
          'This artifact name is reserved for completed jobs. Choose another name.',
        );
      if (existing && existing.worker_id !== job.worker_id)
        throw new ToolDenied(
          'You cannot overwrite another employee’s artifact. Save a new artifact.',
        );
      if (
        !existing &&
        db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM agent_artifacts WHERE task_id=?',
          job.task_id,
        )!.n >= AGENT_LIMITS.artifacts
      )
        throw new ToolDenied('This task has reached its artifact limit.');
      db.run(
        'INSERT INTO agent_artifacts(task_id,name,worker_id,content,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(task_id,name) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at',
        job.task_id,
        action.name,
        job.worker_id,
        action.content,
        now,
      );
      return JSON.stringify({ saved: action.name });
    }
  }
}
