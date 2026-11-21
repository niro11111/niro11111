// Explicit execution states and the only transitions allowed between them.
export const S = Object.freeze({
  PENDING: 'PENDING', PLANNING: 'PLANNING', AWAITING_INPUT: 'AWAITING_INPUT', AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  EXECUTING: 'EXECUTING', VERIFYING: 'VERIFYING', COMPLETED: 'COMPLETED',
  FAILED: 'FAILED', CANCELLED: 'CANCELLED',
});

const T = {
  PENDING: ['PLANNING', 'CANCELLED'],
  PLANNING: ['AWAITING_INPUT', 'AWAITING_APPROVAL', 'EXECUTING', 'FAILED', 'CANCELLED'],
  AWAITING_INPUT: ['PLANNING', 'CANCELLED'], // a clarification question was asked
  AWAITING_APPROVAL: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'CANCELLED', 'AWAITING_APPROVAL'],
  VERIFYING: ['COMPLETED', 'FAILED'],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};

export const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function transition(task, to, note) {
  if (!T[task.state]?.includes(to)) {
    throw new Error(`Illegal transition ${task.state} -> ${to}`);
  }
  task.history.push({ from: task.state, to, at: new Date().toISOString(), note: note ?? null });
  task.state = to;
  return task;
}
