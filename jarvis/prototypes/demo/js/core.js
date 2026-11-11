// Holographic JARVIS core (SVG). Rings, ticks and arcs rotate; a ring of 64 bars shows live
// voice activity; colour and speed follow the core state.
import { t } from './i18n.js';

let n = 0;
let state = 'idle';
const BARS = 64;

const polar = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [200 + r * Math.cos(a), 200 + r * Math.sin(a)]; };
function arc(r, a0, a1) { const [x0, y0] = polar(r, a0); const [x1, y1] = polar(r, a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; }

export function coreHTML({ mini = false, label = true } = {}) {
  const id = `cg${++n}`;
  let ticks = '';
  for (let i = 0; i < 120; i++) {
    const [x0, y0] = polar(192, i * 3); const [x1, y1] = polar(i % 10 === 0 ? 178 : i % 5 === 0 ? 184 : 188, i * 3);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="var(--c)" stroke-opacity="${i % 10 === 0 ? 0.9 : 0.35}" stroke-width="${i % 10 === 0 ? 1.6 : 1}"/>`;
  }
  let bars = '';
  for (let i = 0; i < BARS; i++) {
    const deg = (i * 360) / BARS;
    bars += `<rect x="198.5" y="${200 - 132}" width="3" height="6" rx="1.5" transform="rotate(${deg} 200 200)" opacity=".85"/>`;
  }
  return `<div class="core-wrap${mini ? ' mini' : ''}" data-state="${state}">
  <svg class="core-svg" viewBox="0 0 400 400" role="img" aria-label="JARVIS core">
    <defs>
      <radialGradient id="${id}o" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".25" stop-color="var(--c2)" stop-opacity=".8"/><stop offset=".6" stop-color="var(--c)" stop-opacity=".35"/><stop offset="1" stop-color="var(--c)" stop-opacity="0"/></radialGradient>
      <radialGradient id="${id}h" cx="50%" cy="50%" r="50%"><stop offset=".55" stop-color="var(--c)" stop-opacity="0"/><stop offset=".8" stop-color="var(--c)" stop-opacity=".10"/><stop offset="1" stop-color="var(--c)" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="200" cy="200" r="198" fill="url(#${id}h)"/>
    <g class="spin" style="--sp:60s">${ticks}</g>
    <g class="spin rev glow" style="--sp:26s" fill="none" stroke="var(--c)" stroke-width="2.4" stroke-linecap="round">
      <path d="${arc(166, 10, 80)}"/><path d="${arc(166, 130, 175)}"/><path d="${arc(166, 220, 320)}"/>
    </g>
    <g class="spin" style="--sp:18s" fill="none" stroke="var(--c2)" stroke-width="1" stroke-opacity=".6">
      <circle cx="200" cy="200" r="152" stroke-dasharray="2 7"/>
      <path d="${arc(146, 300, 350)}" stroke-width="3" stroke="var(--c)"/>
    </g>
    <g class="wave">${bars}</g>
    <circle cx="200" cy="200" r="112" fill="none" stroke="var(--c)" stroke-opacity=".55" stroke-width="1.2"/>
    <g class="spin rev" style="--sp:40s" fill="none" stroke="var(--c)" stroke-opacity=".8"><circle cx="200" cy="200" r="104" stroke-dasharray="60 14 6 14" stroke-width="2"/></g>
    <g class="core-orb"><circle cx="200" cy="200" r="96" fill="url(#${id}o)"/></g>
    ${mini ? '' : `<text class="core-title" x="200" y="204" text-anchor="middle" font-size="30">JARVIS</text><text class="core-sub" x="200" y="228" text-anchor="middle">AI CORE</text>`}
  </svg>${label ? `<div class="core-state" data-core-label>${t(`st_${state}`)}</div>` : ''}</div>`;
}

export function getCoreState() { return state; }
export function setCoreState(s) {
  state = s;
  document.querySelectorAll('.core-wrap').forEach((w) => { w.dataset.state = s; });
  document.querySelectorAll('[data-core-label]').forEach((l) => { l.textContent = t(`st_${s}`); });
  if (s !== 'listening' && s !== 'speaking') setWave(null);
}

/** levels: array of 0..1 (any length) or null for the resting ring. */
export function setWave(levels) {
  document.querySelectorAll('.core-wrap .wave').forEach((g) => {
    const rects = g.children;
    for (let i = 0; i < rects.length; i++) {
      const v = levels ? levels[Math.floor((i / rects.length) * levels.length)] ?? 0 : 0;
      const h = 6 + v * 34;
      rects[i].setAttribute('height', h.toFixed(1));
      rects[i].setAttribute('y', (200 - 120 - h).toFixed(1));
    }
  });
}
