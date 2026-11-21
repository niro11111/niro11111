// Weather for the command center via Open-Meteo (no API key). Location comes from settings.
// Cached for 15 minutes; when the network is unavailable it says so instead of inventing data.
const CODES = { 0: ['Clear', 'בהיר'], 1: ['Mostly clear', 'בהיר ברובו'], 2: ['Partly cloudy', 'מעונן חלקית'], 3: ['Overcast', 'מעונן'], 45: ['Fog', 'ערפל'], 48: ['Fog', 'ערפל'],
  51: ['Drizzle', 'טפטוף'], 53: ['Drizzle', 'טפטוף'], 55: ['Drizzle', 'טפטוף'], 61: ['Rain', 'גשם'], 63: ['Rain', 'גשם'], 65: ['Heavy rain', 'גשם כבד'], 80: ['Showers', 'ממטרים'], 81: ['Showers', 'ממטרים'], 82: ['Heavy showers', 'ממטרים כבדים'], 95: ['Thunderstorm', 'סופת רעמים'] };

export class Weather {
  constructor(store, fetchImpl = globalThis.fetch) { this.store = store; this.fetch = fetchImpl; this.cache = null; }
  location() { return this.store.getMeta('location', { name: 'Tel Aviv', lat: 32.08, lon: 34.78 }); }
  setLocation({ name, lat, lon }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw Object.assign(new Error('invalid coordinates'), { status: 400 });
    this.store.setMeta('location', { name: String(name ?? '').slice(0, 60), lat, lon }); this.cache = null; return this.location();
  }
  async current() {
    if (this.cache && Date.now() - this.cache.at < 15 * 60e3) return this.cache.data;
    const loc = this.location();
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
      const r = await this.fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`weather ${r.status}`);
      const j = await r.json();
      const code = j.current.weather_code;
      const data = { available: true, location: loc.name, temperature: Math.round(j.current.temperature_2m), humidity: j.current.relative_humidity_2m, wind: Math.round(j.current.wind_speed_10m),
        max: Math.round(j.daily.temperature_2m_max[0]), min: Math.round(j.daily.temperature_2m_min[0]), code, text: CODES[code]?.[0] ?? '—', textHe: CODES[code]?.[1] ?? '—', source: 'open-meteo.com' };
      this.cache = { at: Date.now(), data };
      return data;
    } catch (e) {
      return { available: false, location: loc.name, reason: e.message };
    }
  }
}
