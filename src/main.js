import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import './styles.css';

/* ================= CONFIG ================= */
const API_URL = 'https://api.open-meteo.com/v1/forecast';
const LOCATIONS = [
  { id: 'pitesti',    name: 'Pitești, Romania',    short: 'Pitești',    sub: 'Str. Banat, Argeș County', lat: 44.8606,   lon: 24.8678 },
  { id: 'valea-mare', name: 'Valea Mare, Romania', short: 'Valea Mare', sub: 'Dâmbovița County',         lat: 45.063641, lon: 25.156696 },
  { id: 'arefu',      name: 'Arefu, Romania',      short: 'Arefu',      sub: 'Argeș County',             lat: 45.3283,   lon: 24.6256 }
];
const SCREEN_MS        = 20000;           // clock <-> Pitești rotation, and idle return from other locations
const REFRESH_MS       = 15 * 60 * 1000;  // weather refresh interval
const FETCH_TIMEOUT_MS = 15000;
const HOURS_SHOWN      = 24;
const CACHE_PREFIX     = 'weather-cache-v1:';

const DAYS     = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS   = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RO_DAYS  = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
const COMPASS  = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'), watch: $('watch'), weather: $('weather'),
  hh: $('hh'), mm: $('mm'), ss: $('ss'), dayname: $('dayname'), datefull: $('datefull'),
  sky: $('sky'), locName: $('locName'), locSub: $('locSub'), curTemp: $('curTemp'), tabs: $('tabs'),
  curIcon: $('curIcon'), curDesc: $('curDesc'), curDetails: $('curDetails'),
  panel: $('forecastPanel'), scroll: $('forecastScroll'), forecast: $('forecast'),
  toggle: $('forecastToggle'), status: $('status'), dots: $('dots')
};
const pad = (n) => String(n).padStart(2, '0');

/* ================= 720p PROPORTIONAL SCALING ================= */
function fit() {
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  el.app.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
fit();

/* ================= WATCH (device system clock) ================= */
function tick() {
  const d = new Date();
  el.hh.textContent = pad(d.getHours());
  el.mm.textContent = pad(d.getMinutes());
  el.ss.textContent = pad(d.getSeconds());
  el.dayname.textContent = DAYS[d.getDay()];
  el.datefull.textContent = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
let clockTimer = null;
function startClock() {
  clearTimeout(clockTimer);
  tick();
  clockTimer = setTimeout(startClock, 1000 - (Date.now() % 1000) + 5); // aligned to the second, no drift
}
startClock();

/* ================= WEATHER ICONS (inline SVG) ================= */
function sun(cx, cy, r) {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    rays += `<line x1="${cx + Math.cos(a) * (r + 4)}" y1="${cy + Math.sin(a) * (r + 4)}" x2="${cx + Math.cos(a) * (r + 10)}" y2="${cy + Math.sin(a) * (r + 10)}" stroke="#FDB813" stroke-width="3.5" stroke-linecap="round"/>`;
  }
  return `<g>${rays}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FDB813"/><circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="#FFD54F"/></g>`;
}
function moon(cx, cy, s) {
  return `<path transform="translate(${cx - 32 * s},${cy - 32 * s}) scale(${s})" d="M40 12a20 20 0 1 0 14 32 16 16 0 0 1-14-32z" fill="#F4E7B0"/>`;
}
function cloud(dx, dy, fill) {
  return `<g transform="translate(${dx},${dy})" fill="${fill}">
    <circle cx="22" cy="38" r="10"/><circle cx="34" cy="30" r="13"/><circle cx="46" cy="38" r="9"/>
    <rect x="12" y="36" width="44" height="12" rx="6"/></g>`;
}
function kind(c) {
  if (c === 0 || c === 1) return 'clear';
  if (c === 2) return 'partly';
  if (c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'cloud';
}
function iconSVG(code, isDay) {
  let g = '';
  switch (kind(code)) {
    case 'clear':  g = isDay ? sun(32, 32, 12) : moon(32, 32, 0.9); break;
    case 'partly': g = (isDay ? sun(24, 22, 9) : moon(24, 22, 0.55)) + cloud(4, 6, '#F2F4F7'); break;
    case 'cloud':  g = cloud(-2, -6, '#CFD6DE') + cloud(2, 2, '#F2F4F7'); break;
    case 'fog':    g = cloud(0, -8, '#E3E7EB') + [46, 52, 58].map((y) => `<line x1="12" y1="${y}" x2="52" y2="${y}" stroke="#E3E7EB" stroke-width="3" stroke-linecap="round"/>`).join(''); break;
    case 'rain':   g = cloud(0, -8, '#E8ECF0') + [20, 30, 40].map((x) => `<line x1="${x}" y1="46" x2="${x - 4}" y2="58" stroke="#4FC3F7" stroke-width="3.5" stroke-linecap="round"/>`).join(''); break;
    case 'snow':   g = cloud(0, -8, '#F2F4F7') + [[20, 50], [32, 56], [44, 50], [26, 60], [38, 62]].map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.8" fill="#fff"/>`).join(''); break;
    case 'storm':  g = cloud(0, -8, '#9AA5B1') + '<polygon points="32,42 24,54 31,54 27,64 40,49 33,49 37,42" fill="#FFD600"/>'; break;
  }
  return `<svg viewBox="0 0 64 64">${g}</svg>`;
}
const DESC = {
  0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Dense Drizzle', 56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains', 80: 'Rain Showers', 81: 'Rain Showers', 82: 'Violent Showers',
  85: 'Snow Showers', 86: 'Snow Showers', 95: 'Thunderstorm', 96: 'Thunderstorm, Hail', 99: 'Thunderstorm, Hail'
};
function theme(code, isDay) {
  const k = kind(code);
  if (k === 'storm' || k === 'rain' || k === 'snow' || k === 'fog') return k;
  if (!isDay) return 'night';
  return k === 'cloud' ? 'cloudy-day' : 'clear-day';
}

/* ================= DYNAMIC WEATHER BACKGROUND ================= */
const rnd = (a, b) => a + Math.random() * (b - a);
const SKYLINE = (() => {
  let x = 0, r = '', w = '';
  while (x < 1280) {
    const bw = rnd(28, 80), bh = rnd(40, 150);
    r += `<rect x="${x}" y="${170 - bh}" width="${bw}" height="${bh}"/>`;
    for (let wy = 170 - bh + 10; wy < 160; wy += 16) {
      for (let wx = x + 6; wx < x + bw - 8; wx += 14) {
        if (Math.random() < 0.35) w += `<rect x="${wx}" y="${wy}" width="5" height="7"/>`;
      }
    }
    x += bw + rnd(0, 6);
  }
  let trees = '';
  for (let t = 0; t < 1280; t += rnd(18, 40)) trees += `<circle cx="${t}" cy="${rnd(160, 172)}" r="${rnd(10, 20)}"/>`;
  return { r, w, trees };
})();
let lastSkyTheme = null;
function renderSky(th) {
  if (th === lastSkyTheme) return; // avoid restarting animations on every render
  lastSkyTheme = th;
  el.sky.className = 'sky ' + th;
  let h = '';
  if (th === 'clear-day') h += '<div class="glow"></div>';
  if (th === 'night') for (let i = 0; i < 90; i++) h += `<div class="star" style="left:${rnd(0, 100)}%;top:${rnd(0, 60)}%;animation-delay:${rnd(0, 3)}s"></div>`;
  const nClouds = { 'clear-day': 3, 'cloudy-day': 8, rain: 9, storm: 9, snow: 6, fog: 4, night: 2 }[th];
  const cColor = { rain: '#cfd6dd', storm: '#7d8792', night: '#43557a' }[th] || '#fff';
  for (let i = 0; i < nClouds; i++) {
    const w = rnd(160, 340), dur = rnd(60, 140);
    h += `<div class="cloudshape" style="width:${w}px;height:${w * 0.28}px;top:${rnd(20, 190)}px;background:${cColor};animation-duration:${dur}s;animation-delay:-${rnd(0, dur)}s"></div>`;
  }
  if (th === 'rain' || th === 'storm') for (let i = 0; i < 110; i++) h += `<div class="drop" style="left:${rnd(0, 105)}%;animation-duration:${rnd(0.5, 0.9)}s;animation-delay:-${rnd(0, 1)}s"></div>`;
  if (th === 'snow') for (let i = 0; i < 90; i++) h += `<div class="flake" style="left:${rnd(0, 100)}%;width:${rnd(4, 8)}px;height:${rnd(4, 8)}px;animation-duration:${rnd(5, 10)}s;animation-delay:-${rnd(0, 10)}s"></div>`;
  if (th === 'fog') for (let i = 0; i < 5; i++) h += `<div class="mist" style="top:${60 + i * 65}px"></div>`;
  if (th === 'storm') h += '<div class="flash"></div>';
  const bld = th === 'night' ? '#0a1428' : 'rgba(30,45,65,.85)';
  const win = th === 'night' ? '#ffd27a' : 'rgba(200,220,240,.35)';
  h += `<svg class="skyline" viewBox="0 0 1280 170" preserveAspectRatio="none">
      <g fill="${bld}">${SKYLINE.r}</g><g fill="${win}">${SKYLINE.w}</g>
      <g fill="${th === 'night' ? '#07101f' : '#2f4a3a'}">${SKYLINE.trees}</g></svg>`;
  el.sky.innerHTML = h;
}

/* ================= WEATHER DATA: Open-Meteo + Preferences cache ================= */
const cache = {};    // id -> { at, data }  (last successful response)
const offline = {};  // id -> true when the latest refresh failed
let refreshing = null;

function buildUrl(loc) {
  const p = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    hourly: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'Europe/Bucharest',
    forecast_days: '7',
    wind_speed_unit: 'kmh'
  });
  return `${API_URL}?${p.toString()}`;
}
function isValid(d) {
  return !!(d && d.current && d.hourly && d.daily &&
    Array.isArray(d.hourly.time) && d.hourly.time.length &&
    Array.isArray(d.daily.time) && d.daily.time.length);
}
async function loadCache() {
  await Promise.all(LOCATIONS.map(async (loc) => {
    try {
      const { value } = await Preferences.get({ key: CACHE_PREFIX + loc.id });
      if (!value) return;
      const entry = JSON.parse(value);
      if (entry && isValid(entry.data)) cache[loc.id] = entry;
    } catch (err) {
      console.warn('Cache read failed', loc.id, err);
    }
  }));
}
async function fetchLocation(loc) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let entry;
  try {
    const res = await fetch(buildUrl(loc), { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!isValid(data)) throw new Error('Invalid Open-Meteo response');
    entry = { at: Date.now(), data };
    cache[loc.id] = entry;
    offline[loc.id] = false;
  } catch (err) {
    offline[loc.id] = true;
    console.warn('Weather refresh failed', loc.id, err);
    return;
  } finally {
    clearTimeout(timeout);
  }
  try {
    await Preferences.set({ key: CACHE_PREFIX + loc.id, value: JSON.stringify(entry) });
  } catch (err) {
    console.warn('Cache write failed', loc.id, err);
  }
}
function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = Promise.allSettled(LOCATIONS.map(fetchLocation)).then(() => {
    refreshing = null;
    if (current.screen === 'weather') renderWeather();
  });
  return refreshing;
}

/* ================= RENDERING ================= */
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function indexFrom(times, key) {
  const exact = times.indexOf(key);
  if (exact >= 0) return exact;
  const next = times.findIndex((t) => t >= key); // ISO strings sort chronologically
  return next >= 0 ? next : -1;
}
function statusText(entry, isOffline) {
  if (!entry) return isOffline ? 'Offline data unavailable' : 'Loading…';
  const t = new Date(entry.at);
  const sameDay = dateKey(t) === dateKey(new Date());
  const when = (sameDay ? '' : `${pad(t.getDate())}.${pad(t.getMonth() + 1)} `) + `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return `Updated ${when} · ${isOffline ? 'Offline data' : 'Open-Meteo'}`;
}

let forecastMode = 'hours';
function renderTabs(active) {
  el.tabs.innerHTML = LOCATIONS.map((l, j) =>
    `<button type="button" class="tab ${j === active ? 'on' : ''}" data-i="${j}">${l.short}</button>`).join('');
}
function renderWeather() {
  const i = current.loc, loc = LOCATIONS[i], entry = cache[loc.id], isOffline = !!offline[loc.id];
  el.locName.textContent = loc.name;
  el.locSub.textContent = loc.sub;
  renderTabs(i);
  el.toggle.textContent = forecastMode === 'days' ? 'Prognoză pe ore' : 'Zile următoare';
  el.status.textContent = statusText(entry, isOffline);
  el.status.classList.toggle('offline', isOffline);

  if (!entry) {
    el.curTemp.textContent = '--°C';
    el.curIcon.innerHTML = '';
    el.curDesc.textContent = isOffline ? 'No connection' : 'Loading…';
    el.curDetails.innerHTML = '';
    el.forecast.innerHTML = '';
    renderSky('cloudy-day');
    return;
  }

  const d = entry.data, cur = d.current, now = new Date();
  const today = Math.max(0, indexFrom(d.daily.time, dateKey(now)));
  el.curTemp.textContent = `${Math.round(cur.temperature_2m)}°C`;
  el.curIcon.innerHTML = iconSVG(cur.weather_code, cur.is_day === 1 || cur.is_day === true);
  el.curDesc.textContent = DESC[cur.weather_code] || '—';
  el.curDetails.innerHTML =
    `H: ${Math.round(d.daily.temperature_2m_max[today])}° | L: ${Math.round(d.daily.temperature_2m_min[today])}°<br>` +
    `Wind: ${Math.round(cur.wind_speed_10m)} km/h ${COMPASS[Math.round(cur.wind_direction_10m / 45) % 8]}<br>` +
    `Humidity: ${cur.relative_humidity_2m}%`;
  renderSky(theme(cur.weather_code, cur.is_day === 1 || cur.is_day === true));

  let html = '';
  if (forecastMode === 'days') {
    for (let k = today; k < d.daily.time.length; k++) {
      const [y, m, dd] = d.daily.time[k].split('-').map(Number);
      const dt = new Date(y, m - 1, dd);
      const label = k === today ? 'Azi' : k === today + 1 ? 'Mâine' : `${RO_DAYS[dt.getDay()]} ${dd}`;
      html += `<div class="dcard"><div class="day">${label}</div>${iconSVG(d.daily.weather_code[k], true)}` +
        `<div class="range">${Math.round(d.daily.temperature_2m_max[k])}° / ${Math.round(d.daily.temperature_2m_min[k])}°</div></div>`;
    }
  } else {
    let start = indexFrom(d.hourly.time, `${dateKey(now)}T${pad(now.getHours())}:00`);
    if (start < 0) start = Math.max(0, d.hourly.time.length - HOURS_SHOWN);
    const end = Math.min(d.hourly.time.length, start + HOURS_SHOWN);
    for (let k = start; k < end; k++) {
      html += `<div class="hcard"><div class="t">${d.hourly.time[k].slice(11, 16)}</div>` +
        `${iconSVG(d.hourly.weather_code[k], d.hourly.is_day[k] === 1)}` +
        `<div class="v">${Math.round(d.hourly.temperature_2m[k])}°C</div></div>`;
    }
  }
  el.forecast.innerHTML = html;
}

/* ================= SCREEN ROTATION ================= */
// Automatic rotation: Clock <-> Pitești every 20 s.
// Valea Mare and Arefu open only from the location buttons, then return to the clock after 20 s idle.
const ROTATION = [{ screen: 'watch' }, { screen: 'weather', loc: 0 }];
let pos = 0, current = ROTATION[0], timer = null;
el.dots.innerHTML = ROTATION.map(() => '<span></span>').join('');

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => show(pos + 1), SCREEN_MS);
}
function apply(locationChanged) {
  const isWeather = current.screen === 'weather';
  el.watch.classList.toggle('active', !isWeather);
  el.weather.classList.toggle('active', isWeather);
  if (isWeather) {
    if (locationChanged) el.scroll.scrollLeft = 0;
    renderWeather();
  }
  [...el.dots.children].forEach((d, j) => d.classList.toggle('on', j === pos));
  schedule();
}
function show(p) {
  const prevLoc = current.loc;
  pos = (p + ROTATION.length) % ROTATION.length;
  current = { ...ROTATION[pos] };
  apply(current.loc !== prevLoc);
}
function selectLocation(i) {
  const prevLoc = current.loc;
  pos = 1;
  current = { screen: 'weather', loc: i };
  apply(i !== prevLoc);
}
function postpone() {
  if (current.screen === 'weather') schedule();
}

/* ================= INPUT ================= */
el.tabs.addEventListener('click', (e) => {
  e.stopPropagation();
  const tab = e.target.closest('.tab');
  if (tab) selectLocation(Number(tab.dataset.i));
});
el.toggle.addEventListener('click', (e) => {
  e.stopPropagation();
  forecastMode = forecastMode === 'hours' ? 'days' : 'hours';
  el.scroll.scrollLeft = 0;
  renderWeather();
  postpone();
});
// Keep the weather screen open while the forecast strip is being scrolled or touched.
['pointerdown', 'touchstart', 'wheel', 'scroll'].forEach((type) =>
  el.scroll.addEventListener(type, postpone, { passive: true }));
el.panel.addEventListener('click', (e) => { e.stopPropagation(); postpone(); });

// Tap or swipe anywhere else toggles between clock and weather.
let sx = null, swiped = false;
el.app.addEventListener('touchstart', (e) => {
  sx = e.target.closest('.wbottom, .tabs') ? null : e.touches[0].clientX;
  swiped = false;
}, { passive: true });
el.app.addEventListener('touchend', (e) => {
  if (sx === null) return;
  const dx = e.changedTouches[0].clientX - sx;
  sx = null;
  if (Math.abs(dx) > 60) { swiped = true; show(pos + (dx < 0 ? 1 : -1)); }
}, { passive: true });
el.app.addEventListener('click', () => {
  if (swiped) { swiped = false; return; }
  show(pos + 1);
});

/* ================= LIFECYCLE ================= */
function onResume() {
  startClock();
  fit();
  refreshAll();
}
App.addListener('resume', onResume).catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden) onResume(); });
window.addEventListener('online', () => refreshAll());

async function init() {
  show(0);
  await loadCache();             // offline-first: show the last saved data immediately
  if (current.screen === 'weather') renderWeather();
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
}
init();
