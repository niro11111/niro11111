// Permission model. Every tool declares a risk level; the policy decides
// whether it runs directly, needs explicit approval, or is never allowed autonomously.
export const RISK = Object.freeze({
  READ: 'read',            // reads data the user already authorized
  WRITE: 'write',          // creates/changes the user's own records (tasks, memory)
  EXTERNAL: 'external',    // talks to an outside service or device
  SENSITIVE: 'sensitive',  // physical security, messages to others, file deletion
  FINANCIAL: 'financial',  // money movement, investments, purchases
});

const DEFAULTS = {
  read: 'allow',
  write: 'allow',
  external: 'allow',
  sensitive: 'approve',
  financial: 'approve', // and can never be lowered: see effective()
};

// Autonomy levels:
// 1 Advisory    - JARVIS only answers and recommends; nothing beyond reading is executed.
// 2 Assisted    - JARVIS prepares every non-read action and asks before executing.
// 3 Controlled  - (default) pre-authorized low-risk actions run; sensitive/financial ask.
// 4 Delegation  - like 3, with larger multi-step budgets. Sensitive/financial still ask.
export const AUTONOMY = { 1: 'advisory', 2: 'assisted', 3: 'controlled', 4: 'delegation' };

export class Policy {
  constructor(store) { this.store = store; }
  autonomy() { return this.store.getMeta('autonomy', 3); }
  setAutonomy(level) {
    const l = Number(level);
    if (!AUTONOMY[l]) throw Object.assign(new Error('autonomy must be 1-4'), { status: 400 });
    this.store.setMeta('autonomy', l);
    return l;
  }
  stepBudget(agent) { return agent.maxSteps * (this.autonomy() === 4 ? 2 : 1); }
  settings() { return { ...DEFAULTS, ...this.store.getMeta('policy', {}) }; }
  set(risk, mode) {
    if (!['allow', 'approve', 'deny'].includes(mode)) throw new Error('mode must be allow|approve|deny');
    if (!(risk in DEFAULTS)) throw new Error(`unknown risk ${risk}`);
    if ((risk === 'financial' || risk === 'sensitive') && mode === 'allow') {
      throw new Error(`${risk} actions always require explicit approval`);
    }
    this.store.setMeta('policy', { ...this.store.getMeta('policy', {}), [risk]: mode });
  }
  /**
   * @param {{name:string, risk:string, alwaysConfirm?:boolean}} tool  risk already resolved for these args
   * @returns {'allow'|'approve'|'deny'|'advise'}
   */
  effective(tool, agent) {
    if (agent && !agent.tools.includes(tool.name)) return 'deny';
    const mode = this.settings()[tool.risk] ?? 'approve';
    if (mode === 'deny') return 'deny';
    const level = this.autonomy();
    if (tool.risk !== RISK.READ && level === 1) return 'advise';
    if (tool.risk !== RISK.READ && level === 2) return 'approve';
    if (tool.risk === RISK.FINANCIAL || tool.risk === RISK.SENSITIVE || tool.alwaysConfirm) {
      return mode === 'deny' ? 'deny' : 'approve';
    }
    return mode;
  }
}
