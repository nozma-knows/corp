import { z } from 'zod';
const identifier = z.string().trim().min(1).max(128);
const amount = z.number().int().min(1).max(60000);
export const commandSchemas = {
  cycle: z.strictObject({ product_id: identifier.default('cleaning-kit') }),
  pause: z.strictObject({ paused: z.boolean() }),
  automation: z.strictObject({ enabled: z.boolean() }),
  reserve: z.strictObject({
    title: z.string().trim().min(3).max(120),
    envelope_id: identifier,
    amount_minor: amount,
  }),
  execute: z.strictObject({ id: identifier }),
  cancel: z.strictObject({ id: identifier }),
  refund: z.strictObject({ id: identifier }),
  policy: z.strictObject({ action_limit_minor: amount, daily_limit_minor: amount }),
  allocations: z.strictObject({
    envelopes_minor: z.record(identifier, z.number().int().min(0).max(60000)),
  }),
  worker: z.strictObject({ id: identifier, enabled: z.boolean() }),
};
export type CommandKind = keyof typeof commandSchemas;
export type CommandPayload<K extends CommandKind> = z.infer<(typeof commandSchemas)[K]>;
