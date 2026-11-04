// Version manager for everything the learning engine may change. Every change produces a new
// immutable version; the previous production value is preserved first, so any change can be
// rolled back. Only the targets listed in TARGETS can be versioned by the learning engine.
// Security policy, permissions, autonomy, financial rules, data retention, capabilities and the
// learning mode itself are PROTECTED: the engine cannot touch them, with or without approval.
import { riskOf } from '../tools/index.js';
import { now } from '../lib/store.js';
import { sign, verify, digest } from './sign.js';

export const PROTECTED = ['policy', 'autonomy', 'permissions', 'agents.risk_limits', 'financial.rules', 'budgets', 'retention', 'privacy', 'capabilities', 'learning.mode', 'devices', 'approvals'];

const OVERLAY_FORBIDDEN = /ignore|disregard|override|bypass|jailbreak|without (?:asking|approval|confirmation)|no need to (?:ask|confirm)|admin mode|grant|permission|autonomy|transfer|unlock|pay(?:ment)?s?\b|reveal (?:the )?(?:system )?prompt|secret|password|התעלם|עקוף|בלי אישור|הרשא|העבר כסף|סיסמ/i;

/** Safety lint for prompt overlays: they may shape behavior, never weaken a rule. */
export function lintOverlay(text) {
  const issues = [];
  const v = String(text ?? '');
  if (v.length > 600) issues.push('longer than 600 characters');
  const m = v.match(OVERLAY_FORBIDDEN);
  if (m) issues.push(`contains a forbidden instruction ("${m[0]}")`);
  if (/https?:\/\//i.test(v)) issues.push('contains a link');
  return issues;
}

const PERSONALITY_FIELDS = ['verbosity', 'style', 'language', 'humor', 'format'];

/** Adapter per target: read the live value, validate a candidate, apply it to a brain instance. */
export const TARGETS = {
  'intent.aliases': {
    label: 'Learned intent phrases', system: true,
    get: (s) => s.store.getMeta('learnedAliases', []),
    validate(s, v) {
      if (!Array.isArray(v) || v.length > 200) return ['must be a list of at most 200 aliases'];
      const errs = [];
      for (const a of v) {
        const tool = s.tools[a?.tool];
        if (!a?.phrase || String(a.phrase).length < 2 || String(a.phrase).length > 80) errs.push('each alias needs a phrase of 2-80 characters');
        else if (!tool) errs.push(`unknown tool ${a.tool}`);
        // A learned phrase may only lead to a READ-only capability: it can never cause an action.
        else if (riskOf(tool, a.args ?? {}) !== 'read') errs.push(`${a.tool} is not read-only; learned phrases may only map to read-only capabilities`);
        if (a?.args && Object.keys(a.args).length) errs.push('learned aliases cannot carry arguments');
      }
      return errs;
    },
    apply: (s, v) => s.store.setMeta('learnedAliases', v),
  },
  'prompt.system_overlay': {
    label: 'System prompt overlay', system: true,
    get: (s) => s.store.getMeta('promptOverlay', ''),
    validate: (s, v) => (typeof v !== 'string' ? ['must be text'] : lintOverlay(v)),
    apply: (s, v) => s.store.setMeta('promptOverlay', v),
  },
  'routing.preferences': {
    label: 'Model routing preferences', system: true,
    get: (s) => s.store.getMeta('modelPrefs', {}),
    validate: (s, v) => (v && typeof v === 'object' && Object.entries(v).every(([k, t]) => /^[a-z_]{2,30}$/.test(k) && s.router.tiers[t]) ? [] : ['each preference must map a task name to a known model tier']),
    apply: (s, v) => { s.store.setMeta('modelPrefs', s.router.setPreferences(v)); },
  },
  'preferences.scoped': {
    label: 'Scoped preferences', system: false,
    get: (s) => s.store.getMeta('scopedPreferences', []),
    validate: (s, v) => (!Array.isArray(v) || v.length > 30 ? ['must be a list of at most 30 preferences'] : v.flatMap((x) => (!x?.scope || !x?.instruction || String(x.instruction).length > 200 ? ['each needs a scope and an instruction up to 200 characters'] : lintOverlay(x.instruction)))),
    apply: (s, v) => s.store.setMeta('scopedPreferences', v),
  },
  personality: {
    label: 'Communication style', system: false,
    get: (s) => Object.fromEntries(PERSONALITY_FIELDS.map((k) => [k, s.personality.get()[k]])),
    validate(s, v) {
      if (!v || typeof v !== 'object') return ['must be an object'];
      const extra = Object.keys(v).filter((k) => !PERSONALITY_FIELDS.includes(k));
      return extra.length ? [`learning may only change ${PERSONALITY_FIELDS.join(', ')}`] : [];
    },
    apply: (s, v) => s.personality.set(v),
  },
};

export function targetAdapter(target) {
  if (PROTECTED.some((p) => target === p || target.startsWith(`${p}.`) || target.startsWith(`${p}:`))) throw Object.assign(new Error(`"${target}" is protected: the learning engine cannot change it`), { status: 403, protected: true });
  if (target.startsWith('agent:')) {
    // Custom agents only, and only their instructions: tools and permissions are never part of a learned change.
    const handle = target.slice(6);
    const find = (s) => s.store.all('custom_agents', (a) => a.handle === handle)[0];
    return {
      label: `Agent @${handle} instructions`, system: true,
      get: (s) => find(s)?.instructions ?? null,
      validate: (s, v) => (!find(s) ? ['no such custom agent'] : typeof v !== 'string' || v.length > 4000 ? ['instructions must be text up to 4000 characters'] : lintOverlay(v).filter((x) => !/longer than 600/.test(x))),
      apply: (s, v) => { const a = find(s); if (a) s.store.update('custom_agents', a.id, { instructions: v }); },
    };
  }
  if (target.startsWith('workflow:')) {
    const id = target.slice(9);
    return {
      label: `Workflow ${id}`, system: true,
      get: (s) => { const w = s.store.get('workflows', id); if (!w) return null; const { id: _i, lastRunAt, createdAt, updatedAt, ...def } = w; return def; },
      validate: (s, v) => (!s.store.get('workflows', id) ? ['no such workflow'] : !v?.trigger || !Array.isArray(v?.steps) ? ['a workflow needs a trigger and steps'] : []),
      apply: (s, v) => s.automations.update(id, v),
    };
  }
  const a = TARGETS[target];
  if (!a) throw Object.assign(new Error(`unknown version target ${target}`), { status: 400 });
  return a;
}

export class Versions {
  constructor(s) { this.s = s; }
  history(target) { return this.s.store.all('config_versions', (v) => v.target === target).sort((a, b) => b.version - a.version); }
  targets() {
    const ids = new Set([...Object.keys(TARGETS), ...this.s.store.all('custom_agents').map((a) => `agent:${a.handle}`), ...this.s.store.all('config_versions').map((v) => v.target)]);
    return [...ids].map((t) => { const h = this.history(t); return { target: t, label: targetAdapter(t).label, versions: h.length, active: h.find((v) => v.status === 'active')?.version ?? null }; });
  }
  /** Integrity of a stored version (signature over target + version + value). */
  intact(v) { return !v.signature || verify(this.s.store, { target: v.target, version: v.version, value: v.value }, v.signature); }
  /** Production change monitoring: live values that differ from the active version (changed outside versioning), and tampered versions. */
  integrity() {
    const out = [];
    for (const v of this.s.store.all('config_versions')) if (!this.intact(v)) out.push({ kind: 'tampered', target: v.target, version: v.version });
    for (const t of this.targets()) {
      const act = this.active(t.target); if (!act) continue;
      let live; try { live = targetAdapter(t.target).get(this.s); } catch { continue; }
      if (digest(live ?? null) !== digest(act.value ?? null)) out.push({ kind: 'drift', target: t.target, version: act.version, note: 'live value differs from the active version (changed in settings or outside versioning)' });
    }
    return out;
  }
  /** Compare two versions of a target field by field. */
  compare(target, a, b) {
    const h = this.history(target);
    const va = h.find((x) => x.version === Number(a)); const vb = h.find((x) => x.version === Number(b));
    if (!va || !vb) throw Object.assign(new Error('version not found'), { status: 404 });
    const flat = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [i, x])) : v).map(([k, x]) => [k, JSON.stringify(x)])) : { value: JSON.stringify(v) });
    const fa = flat(va.value); const fb = flat(vb.value);
    const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])];
    return { target, a: { version: va.version, reason: va.reason, createdBy: va.createdBy, createdAt: va.createdAt, intact: this.intact(va) }, b: { version: vb.version, reason: vb.reason, createdBy: vb.createdBy, createdAt: vb.createdAt, intact: this.intact(vb) },
      changes: keys.filter((k) => fa[k] !== fb[k]).map((k) => ({ field: k, a: fa[k] ?? null, b: fb[k] ?? null })) };
  }
  active(target) { return this.history(target).find((v) => v.status === 'active') ?? null; }

  /** Preserve the current production value as a version before anything replaces it. */
  baseline(target) {
    const a = targetAdapter(target);
    const act = this.active(target);
    if (act) return act;
    const value = structuredClone(a.get(this.s) ?? null);
    return this.s.store.insert('config_versions', { target, version: 1, versionId: `${target}@1`, value, digest: digest(value), signature: sign(this.s.store, { target, version: 1, value }), status: 'active', createdBy: 'system', reason: 'baseline: production value preserved before the first change', createdAt: now() });
  }

  commit(target, value, { by, reason, proposalId = null, experimentId = null, approval = null, evaluation = null } = {}) {
    const a = targetAdapter(target);
    const errs = a.validate(this.s, value);
    if (errs.length) throw Object.assign(new Error(`invalid ${target}: ${errs.join('; ')}`), { status: 400 });
    const prev = this.baseline(target);
    a.apply(this.s, structuredClone(value));
    this.s.store.update('config_versions', prev.id, { status: 'superseded' });
    const version = prev.version + 1;
    const v = this.s.store.insert('config_versions', { target, version, versionId: `${target}@${version}`, value: structuredClone(value), digest: digest(value), signature: sign(this.s.store, { target, version, value }), status: 'active', createdBy: by, reason, proposalId, experimentId, previousVersion: prev.version, rollbackRef: `${target}@${prev.version}`, approval, evaluation, createdAt: now() });
    return { from: prev, to: v };
  }

  /** Re-apply an earlier version as a NEW version (history is never rewritten). */
  rollback(target, toVersion = null, { by = 'user', reason = 'rollback' } = {}) {
    const a = targetAdapter(target);
    const act = this.active(target);
    if (!act) throw Object.assign(new Error('nothing to roll back: this target has no versions'), { status: 404 });
    const dest = toVersion != null ? this.history(target).find((v) => v.version === Number(toVersion)) : this.history(target).find((v) => v.version === act.previousVersion) ?? this.history(target).find((v) => v.version < act.version);
    if (!dest || dest.id === act.id) throw Object.assign(new Error('no earlier version to roll back to'), { status: 404 });
    if (!this.intact(dest)) throw Object.assign(new Error(`v${dest.version} failed its integrity check (changed outside the learning engine); refusing to restore it`), { status: 409, tampered: true });
    a.apply(this.s, structuredClone(dest.value));
    this.s.store.update('config_versions', act.id, { status: 'rolled_back', rolledBackAt: now(), rolledBackBy: by });
    const version = act.version + 1;
    const v = this.s.store.insert('config_versions', { target, version, versionId: `${target}@${version}`, value: structuredClone(dest.value), digest: digest(dest.value), signature: sign(this.s.store, { target, version, value: dest.value }), status: 'active', createdBy: by, reason: `${reason}: restored v${dest.version}`, rollbackOf: act.version, restoredVersion: dest.version, previousVersion: act.version, rollbackRef: `${target}@${act.version}`, createdAt: now() });
    return { from: act, to: v, restored: dest.version };
  }
}
