import assert from 'node:assert/strict';
import test from 'node:test';
import { Database } from '../src/server/database.js';
import { CompanyService } from '../src/server/service.js';
import { fixture } from './helpers.js';

test('team handoffs match committed work and command retries do not duplicate messages', () => {
  const f = fixture();
  try {
    assert.equal(f.service.state().messages.length, 0);
    const result = f.command('cycle', {}, 'team-task-123');
    const messages = f.service.state().messages;
    assert.equal(messages.length, 6);
    assert.ok(messages.every((message) => message.run_id === result.run_id));
    assert.deepEqual(
      messages.map((message) => [message.sender_id, message.recipient_id]),
      [
        ['researcher', 'treasury'],
        ['treasury', 'creator'],
        ['creator', 'reviewer'],
        ['reviewer', 'operator'],
        ['operator', 'treasury'],
        ['treasury', 'owner'],
      ],
    );
    assert.equal(messages.at(-1)?.channel, 'finance');
    assert.equal(messages.at(-1)?.function_id, 'post_ledger');
    f.command('cycle', {}, 'team-task-123');
    assert.equal(f.service.state().messages.length, 6);
  } finally {
    f.cleanup();
  }
});

test('blocked work reports its reason without claiming rolled-back approvals or deliveries', () => {
  const f = fixture();
  try {
    f.command('worker', { id: 'creator', enabled: false });
    assert.throws(() => f.command('cycle'), /Studio is disabled/);
    const state = f.service.state();
    assert.equal(state.company.cash_minor, 100000);
    assert.equal(state.messages.length, 1);
    assert.match(state.messages[0].body, /No sale or expense was committed/);
    assert.equal(state.messages[0].sender_id, 'creator');
    assert.equal(state.messages[0].function_id, 'prepare_delivery');
  } finally {
    f.cleanup();
  }
});

test('owner notes survive restart, stay literal, and cannot impersonate employees', () => {
  const f = fixture();
  try {
    const note = '<img src=x onerror=alert(1)>\nPlease review the brief.';
    f.command('message', { channel: 'general', body: note }, 'owner-note-123');
    f.command('message', { channel: 'general', body: note }, 'owner-note-123');
    for (const input of [
      { channel: 'unknown', body: 'hello' },
      { channel: 'general', body: '  ' },
      { channel: 'general', body: 'x'.repeat(2001) },
      { channel: 'general', body: 'hello', sender_id: 'operator' },
    ])
      assert.throws(() => f.command('message', input), /Check the entered values/);
    const reopened = new Database(f.db.path);
    try {
      const service = new CompanyService(reopened, f.clock);
      service.initialize();
      assert.equal(service.state().messages.length, 1);
      assert.equal(service.state().messages[0].body, note);
      assert.equal(service.state().messages[0].sender_id, 'owner');
      assert.equal(service.state().messages[0].run_id, null);
    } finally {
      reopened.close();
    }
  } finally {
    f.cleanup();
  }
});

test('a busy team does not evict notes from other channels', () => {
  const f = fixture();
  try {
    f.command('message', { channel: 'general', body: 'Keep this owner note.' });
    for (let i = 0; i < 105; i++)
      f.command('message', { channel: 'product', body: `Product note ${i}` });
    const messages = f.service.state().messages;
    assert.equal(messages.filter((message) => message.channel === 'product').length, 100);
    assert.equal(messages.filter((message) => message.channel === 'general').length, 1);
  } finally {
    f.cleanup();
  }
});

test('the new message migration preserves existing money and runs without inventing past conversations', () => {
  const f = fixture();
  try {
    f.command('cycle', {}, 'existing-company-task');
    f.db.transaction(() => {
      f.db.exec('DROP TABLE team_messages');
      f.db.run('DELETE FROM schema_migrations WHERE version=?', '004_team_messages.sql');
    });
    f.service.initialize();
    assert.equal(f.service.state().company.cash_minor, 101950);
    assert.equal(f.service.inspector().runs.length, 1);
    assert.deepEqual(f.service.state().messages, []);
    f.command('cycle', {}, 'existing-company-task');
    assert.deepEqual(f.service.state().messages, []);
    f.command('cycle');
    assert.equal(f.service.state().messages.length, 6);
  } finally {
    f.cleanup();
  }
});

test('expense decisions produce one finance update after the actual outcome', () => {
  const f = fixture();
  try {
    const approved = f.reserve(1200, 'expense-proposal-1');
    f.command('execute', { id: approved.action_id }, 'expense-approval-1');
    f.command('execute', { id: approved.action_id }, 'expense-approval-1');
    const declined = f.reserve();
    f.command('cancel', { id: declined.action_id });
    assert.equal(f.service.state().company.cash_minor, 98800);
    const messages = f.service.state().messages;
    assert.equal(messages.length, 4);
    assert.ok(messages.every((message) => message.channel === 'finance'));
    assert.match(messages[1].body, /approved expense/);
    assert.match(messages[3].body, /hold was released/);
  } finally {
    f.cleanup();
  }
});
