import type { WorkerId } from './contracts.js';

/** Task routing intent. The configured Codex model and effort are recorded for real tasks. */
export const modelPlans: Record<WorkerId, { task: string; model: string; reason: string }[]> = {
  researcher: [
    {
      task: 'Research and compare opportunities',
      model: 'Reasoning model',
      reason: 'Compare evidence, constraints and tradeoffs before choosing a direction.',
    },
    {
      task: 'Summarize findings',
      model: 'Fast model',
      reason: 'Use a smaller model for short summaries of already reviewed information.',
    },
  ],
  creator: [
    {
      task: 'Draft and edit a product',
      model: 'Fast model',
      reason: 'Keep repeatable production work quick and inexpensive.',
    },
    {
      task: 'Resolve a difficult design brief',
      model: 'Reasoning model',
      reason: 'Escalate ambiguous work instead of spending more on every draft.',
    },
  ],
  reviewer: [
    {
      task: 'Review product quality',
      model: 'Reasoning model',
      reason: 'Check the work independently and explain failures to Studio.',
    },
    {
      task: 'Validate prices and formats',
      model: 'Code · no model',
      reason: 'Use deterministic checks for rules that have a precise answer.',
    },
  ],
  operator: [
    {
      task: 'Plan and delegate team work',
      model: 'Reasoning model',
      reason: 'Break a goal into tasks, choose the right team and resolve blockers.',
    },
    {
      task: 'Route routine updates',
      model: 'Fast model',
      reason: 'Keep simple coordination lightweight.',
    },
  ],
  treasury: [
    {
      task: 'Approve limits and record money',
      model: 'Code · no model',
      reason: 'Financial authority stays with exact, repeatable rules.',
    },
  ],
};
