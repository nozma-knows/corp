import type { Database } from './database.js';
import type { TeamMessage, WorkerId, MessageChannel } from '../shared/contracts.js';

export function postMessage(
  db: Database,
  channel: MessageChannel,
  sender: WorkerId | 'owner',
  body: string,
  now: number,
  recipient: WorkerId | 'owner' | null = null,
  runId: string | null = null,
  functionId: string | null = null,
) {
  db.run(
    'INSERT INTO team_messages(channel,sender_id,recipient_id,body,run_id,function_id,created_at) VALUES (?,?,?,?,?,?,?)',
    channel,
    sender,
    recipient,
    body,
    runId,
    functionId,
    now,
  );
}

export function messagesSnapshot(db: Database): TeamMessage[] {
  // Bound each channel independently so a busy team cannot hide owner messages.
  return (['general', 'product', 'finance'] as const)
    .flatMap((channel) =>
      db.all<TeamMessage>(
        'SELECT * FROM team_messages WHERE channel=? ORDER BY id DESC LIMIT 100',
        channel,
      ),
    )
    .sort((a, b) => a.id - b.id);
}
