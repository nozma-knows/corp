import type { WorkerId } from './contracts.js';

export type AgentId = Exclude<WorkerId, 'treasury'>;
export type AgentAction =
  | { type: 'company.read' }
  | { type: 'memory.read'; key: string }
  | { type: 'memory.write'; key: string; value: string }
  | { type: 'artifact.read'; name: string }
  | { type: 'artifact.save'; name: string; content: string }
  | { type: 'delegate'; worker: Exclude<AgentId, 'operator'>; brief: string }
  | { type: 'complete' }
  | { type: 'blocked'; reason: string };

export interface AgentJob {
  id: string;
  task_id: string;
  parent_id: string | null;
  worker_id: AgentId;
  brief: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'blocked' | 'interrupted';
  result: string | null;
  created_at: number;
}
export interface AgentEvent {
  id: number;
  task_id: string;
  job_id: string | null;
  worker_id: AgentId;
  type: string;
  summary: string;
  created_at: number;
}
export interface AgentArtifact {
  name: string;
  worker_id: AgentId;
  content: string;
  updated_at: number;
}
export interface AgentMemory {
  worker_id: AgentId;
  key: string;
  value: string;
  updated_at: number;
}
export interface AgentRun {
  jobs: AgentJob[];
  events: AgentEvent[];
  artifacts: AgentArtifact[];
  calls: number;
  known_tokens: number;
  usage_complete: boolean;
  max_calls: number;
  max_tokens: number;
}
