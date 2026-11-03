// Small dependency-free SVG charts: line/area, donut and circular gauge.
import { esc } from './api.js';

export function lineChart(series, { w = 640, h = 230, keys, colors, fmt = (v) => v, labels } = {}) {
  const pad = { l: 56, r: 12, t: 14, b: 26 };
  const vals = series.flatMap((d) => keys.map((k) => d[k]));
  const max = Math.max(1, ...vals) * 1.1; const min = Math.min(0, ...vals);
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, series.length - 1);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4; const yy = y(v);
    g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".08"/><text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  series.forEach((d, i) => { g += `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(labels ? labels(d) : d.month)}</text>`; });
  keys.forEach((k, ki) => {
    const pts = series.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`);
    const c = colors[ki];
    g += `<defs><linearGradient id="lg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>`;
    g += `<path d="M${pts[0]} L${pts.join(' L')} L${x(series.length - 1)},${y(min)} L${x(0)},${y(min)} Z" fill="url(#lg${k})"/>`;
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px ${c})"/>`;
    series.forEach((d, i) => { g += `<circle cx="${x(i)}" cy="${y(d[k])}" r="3" fill="${c}"><title>${esc(fmt(d[k]))}</title></circle>`; });
  });
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" dir="ltr">${g}</svg>`;
}

export function donut(items, { size = 200, colors, center = '', sub = '' } = {}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const r = 70; const C = 2 * Math.PI * r; let off = 0; let g = '';
  items.forEach((it, i) => {
    const len = (it.value / total) * C;
    g += `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="20" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" style="filter:drop-shadow(0 0 4px ${colors[i % colors.length]})"><title>${esc(it.label)}</title></circle>`;
    off += len;
  });
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" dir="ltr"><circle cx="100" cy="100" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".07" stroke-width="20"/>${g}
  <text x="100" y="98" text-anchor="middle" font-size="18" font-weight="600" fill="currentColor">${esc(center)}</text><text x="100" y="118" text-anchor="middle" font-size="11" fill="currentColor" opacity=".6">${esc(sub)}</text></svg>`;
}

export function gauge(value, { label = '', suffix = '%', max = 100, color = 'var(--cyan)' } = {}) {
  const v = value == null ? null : Math.max(0, Math.min(max, value));
  const r = 38; const C = 2 * Math.PI * r * 0.75;
  const len = v == null ? 0 : (v / max) * C;
  return `<div class="gauge"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(label)}">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".1" stroke-width="7" stroke-dasharray="${C} 999" stroke-linecap="round" transform="rotate(135 50 50)"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-dasharray="${len} 999" stroke-linecap="round" transform="rotate(135 50 50)" style="filter:drop-shadow(0 0 5px ${color})"/>
    <text class="gv" x="50" y="56" text-anchor="middle">${v == null ? '—' : Math.round(value)}${v == null ? '' : `<tspan font-size="9">${suffix}</tspan>`}</text></svg><div class="gl">${esc(label)}</div></div>`;
}
