import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOMES,
  MEETING_SEATS,
  COFFEE_SPOT,
  findPath,
  walkable,
  FURNITURE,
} from '../src/shared/office-layout.js';
import { officeCue } from '../src/client/office-activity.js';
import { fixture } from './helpers.js';
import type { DashboardState, ModelTask } from '../src/shared/contracts.js';

test('every employee can reach meeting seats and coffee through open doors without crossing furniture', () => {
  for (const home of Object.values(HOMES))
    for (const destination of [...MEETING_SEATS, COFFEE_SPOT]) {
      assert.ok(walkable(home));
      const path = findPath(home, destination);
      assert.ok(path.length > 0);
      assert.deepEqual(path.at(-1), destination);
      let previous = home;
      for (const step of path) {
        assert.ok(walkable(step));
        assert.equal(Math.abs(previous.x - step.x) + Math.abs(previous.y - step.y), 1);
        previous = step;
      }
    }
  for (const prop of FURNITURE)
    assert.deepEqual(findPath(HOMES.owner, { x: prop.x, y: prop.y }), []);
  for (const point of [
    { x: -1, y: 7 },
    { x: 32, y: 24 },
    { x: 0, y: 0 },
    { x: 4.5, y: 7 },
  ])
    assert.deepEqual(findPath(HOMES.owner, point), []);
});

test('the office uses recorded handoffs and labels blocked work rather than inventing meetings', () => {
  const f = fixture();
  try {
    const snapshot = (): DashboardState => ({
      ...f.service.state(),
      inspector: f.service.inspector(),
    });
    assert.equal(officeCue(snapshot(), 0), null);
    f.command('cycle');
    assert.equal(officeCue(snapshot(), 0)?.mode, 'recorded');
    assert.equal(officeCue(snapshot(), 2)?.sender, 'creator');
    assert.equal(officeCue(snapshot(), 2)?.recipient, 'reviewer');
    assert.equal(
      officeCue(snapshot(), 2)!.message,
      snapshot().messages.find((message) => message.sender_id === 'creator')!.body,
    );
    f.command('worker', { id: 'creator', enabled: false });
    assert.throws(() => f.command('cycle'));
    assert.equal(officeCue(snapshot(), 0)?.mode, 'blocked');
  } finally {
    f.cleanup();
  }
});

test('live work follows the latest completed handoff; selecting saved steps never reports them as live', () => {
  const f = fixture();
  try {
    const task: ModelTask = {
      id: 'task-1',
      goal: 'Write a product brief',
      channel: 'product',
      status: 'running',
      active_worker: 'researcher',
      error: null,
      created_at: 1,
      steps: [
        {
          id: 'step-1',
          task_id: 'task-1',
          sequence: 0,
          worker_id: 'operator',
          recipient_id: 'researcher',
          purpose: 'Delegate',
          model: null,
          effort: 'high',
          status: 'completed',
          message: 'Actual provider response',
          artifact: 'Actual draft',
          input_tokens: 10,
          output_tokens: 10,
          duration_ms: 100,
          created_at: 1,
        },
        {
          id: 'step-2',
          task_id: 'task-1',
          sequence: 1,
          worker_id: 'researcher',
          recipient_id: 'creator',
          purpose: 'Research',
          model: null,
          effort: 'high',
          status: 'running',
          message: null,
          artifact: null,
          input_tokens: null,
          output_tokens: null,
          duration_ms: null,
          created_at: 2,
        },
      ],
    };
    const snapshot: DashboardState = {
      ...f.service.state(),
      inspector: f.service.inspector(),
      model_tasks: [task],
    };
    assert.equal(officeCue(snapshot, 1)?.sender, 'operator');
    assert.equal(officeCue(snapshot, 1)?.message, 'Actual provider response');
    assert.equal(officeCue(snapshot, 1)?.mode, 'live');
    task.status = 'completed';
    task.steps[1].status = 'completed';
    task.steps[1].message = 'Research response';
    assert.equal(officeCue(snapshot, 1)?.sender, 'researcher');
    assert.equal(officeCue(snapshot, 1)?.mode, 'recorded');
    task.status = 'blocked';
    task.steps[1].status = 'interrupted';
    assert.equal(officeCue(snapshot, 1)?.mode, 'blocked');
  } finally {
    f.cleanup();
  }
});
