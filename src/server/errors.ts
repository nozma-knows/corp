import type { RunTrace } from './inspector.js';
import type { WorkerId } from '../shared/contracts.js';
export class DomainError extends Error {
  trace?: RunTrace;
  constructor(
    message: string,
    readonly status = 409,
    public workerId?: WorkerId,
    public functionId?: string,
  ) {
    super(message);
  }
}
