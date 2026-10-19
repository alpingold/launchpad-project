// Words and numbers the game-making pages share (/create/<id> and /admin).

/** While a game is being made, the pages ask the server for it this often (plan §11: simpler than pushing). */
export const POLL_MS = 2000;

/** A version's status, in words. */
export const VERSION_STATUS_TEXT = {
  designing: 'Writing the design',
  design_ready: 'Design ready',
  generating: 'Building',
  failed: 'Failed',
  ready: 'Passed the checks',
};
/** A change's design is a plan; the words follow. */
export const PLAN_STATUS_TEXT = { ...VERSION_STATUS_TEXT, designing: 'Writing the plan', design_ready: 'Plan ready' };

/** "Oct 19, 3:04 PM" */
export function formatTime(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
