// Fetch a page as untrusted data and extract readable text.
import { wrapUntrusted } from '../security/untrusted.js';

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|h\d|li|br|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function assertPublicUrl(u) {
  const url = new URL(u);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http(s) URLs');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) {
    throw new Error('private network addresses are blocked');
  }
  return url;
}

export async function fetchPage(u, { maxChars = 20000 } = {}) {
  const url = assertPublicUrl(u);
  const r = await fetch(url, { headers: { 'User-Agent': 'JARVIS-AI/0.1 (personal research assistant)' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const type = r.headers.get('content-type') ?? '';
  const raw = await r.text();
  const text = (/html/.test(type) ? htmlToText(raw) : raw).slice(0, maxChars);
  const title = (raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? url.hostname).trim();
  return { url: url.href, title, text, ...wrapUntrusted(url.href, text) };
}
