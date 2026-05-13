import { EventEmitter } from 'node:events';
import type { TrajectoryStep } from '../types.js';

export type RunEvent =
  | { type: 'run.start'; task: string; runStartedAt: string }
  | { type: 'run.step'; step: TrajectoryStep }
  | { type: 'run.attempt'; attempt: number }
  | { type: 'run.memory_op'; kind: string; detail: string }
  | { type: 'run.complete'; runId: string; status: string; attempts: number }
  | { type: 'run.error'; message: string };

export const runEvents = new EventEmitter();
runEvents.setMaxListeners(64);

export function emitRunEvent(event: RunEvent): void {
  runEvents.emit('event', event);
}
