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

export class Policy {
  constructor(store) { this.store = store; }
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
   * @returns {'allow'|'approve'|'deny'}
   */
  effective(tool, agent) {
    if (agent && !agent.tools.includes(tool.name)) return 'deny';
    const mode = this.settings()[tool.risk] ?? 'approve';
    if (tool.risk === RISK.FINANCIAL || tool.risk === RISK.SENSITIVE || tool.alwaysConfirm) {
      return mode === 'deny' ? 'deny' : 'approve';
    }
    return mode;
  }
}
