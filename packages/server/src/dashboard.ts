/**
 * The dashboard: one page, one screen's worth of scrolling, no build step.
 *
 * This is the whole point of the feature. A log nobody reads is a log nobody
 * has, and "open a URL" is the only interface with a low enough activation
 * energy to actually get opened on a Tuesday. Everything here is therefore
 * inline — no CDN, no chart library, no client-side fetch. Bars are `div`s with
 * a width; that is genuinely all a bar chart is, and it renders on a phone with
 * no network beyond the page itself.
 *
 * It follows the site's own conventions because they are good ones and because a
 * page that looks like the rest of the site is a page you trust: hard offset
 * shadows rather than soft, nothing rotated, and colour used to mean something
 * rather than to decorate.
 *
 * English, deliberately — the same reason the server's errors are English. This
 * is a tool for whoever runs the site, and it sits next to logs and a terminal.
 */
import type { Summary } from './summary';

const WINDOWS = [7, 30, 90];

export function renderDashboard(summary: Summary, query: string): string {
  const q = (days: number): string => `?${query ? `${query}&` : ''}days=${days}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>הסלון — usage</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div>
    <h1>הסלון <span class="dim">usage</span></h1>
    <p class="dim small">${summary.from} → ${summary.to} · times in ${esc(summary.timeZone)}</p>
  </div>
  <nav class="windows">
    ${WINDOWS.map(
      (days) =>
        `<a class="win${days === summary.days ? ' win--on' : ''}" href="${esc(q(days))}">${days}d</a>`,
    ).join('')}
    <a class="win" href="${esc(`events.ndjson${query ? `?${query}` : ''}`)}">raw ↓</a>
  </nav>
</header>

<section class="stats">
  ${stat('visitors', summary.totals.visitors, `${summary.totals.newVisitors} new`)}
  ${stat('players', summary.totals.players, 'took a seat')}
  ${stat('rooms', summary.totals.rooms, `${dash(summary.totals.matchesPerRoom)} matches each`)}
  ${stat('matches', summary.totals.matches, `${summary.totals.matchMinutes}m played`)}
  ${stat('room length', dash(summary.totals.medianRoomMinutes, 'm'), 'median evening')}
  ${stat('bounce', pct(summary.totals.bounce), 'left without joining')}
</section>

<section class="card">
  <h2>By day</h2>
  ${dailyChart(summary)}
</section>

<section class="grid">
  <div class="card">
    <h2>By hour <span class="dim small">match starts</span></h2>
    ${hourChart(summary.hours)}
  </div>
  <div class="card">
    <h2>Who they are</h2>
    ${countTable('device', summary.devices)}
    ${countTable('browser', summary.browsers)}
    ${countTable('language', summary.languages)}
    ${countTable('arrived by', summary.entry)}
    <p class="note">
      ${summary.installed} visit${summary.installed === 1 ? '' : 's'} from an installed app ·
      ${summary.controlsOverridden} had to fix the on-screen controls by hand
    </p>
  </div>
</section>

<section class="card">
  <h2>Games</h2>
  <p class="note">
    <b>picked</b> is the host selecting it in the lobby, <b>played</b> is a match actually starting —
    a game that is picked far more than it is played is not selling itself.
    <b>finished</b> is the share that ran to a real conclusion rather than being abandoned;
    <b>menu</b> counts trips to the options menu, which is where the rules live.
  </p>
  ${gamesTable(summary)}
</section>

<section class="grid">
  <div class="card">
    <h2>People</h2>
    ${peopleTable(summary)}
  </div>
  <div class="card">
    <h2>What is going wrong</h2>
    ${problems(summary)}
  </div>
</section>

<section class="card">
  <h2>Latest events</h2>
  <pre class="raw">${esc(summary.recent.map((event) => JSON.stringify(event)).join('\n')) || 'nothing yet'}</pre>
</section>

<footer class="dim small">
  Aggregated live from the event log — nothing here is precomputed.
  Field reference: <code>docs/analytics.md</code>.
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function stat(label: string, value: string | number, note: string): string {
  return `<div class="stat">
    <span class="stat__value">${esc(String(value))}</span>
    <span class="stat__label">${esc(label)}</span>
    <span class="stat__note dim small">${esc(note)}</span>
  </div>`;
}

function dailyChart(summary: Summary): string {
  const peak = Math.max(1, ...summary.daily.map((row) => row.visitors));
  // Weekly ticks only: thirty date labels on a phone is a smear.
  const step = Math.ceil(summary.daily.length / 10);

  return `<div class="bars">${summary.daily
    .map((row, index) => {
      const height = Math.round((row.visitors / peak) * 100);
      const title = `${row.day}: ${row.visitors} visitors, ${row.visits} visits, ${row.matches} matches, ${row.minutes}m played`;
      return `<div class="bar" title="${esc(title)}">
        <div class="bar__fill" style="height:${height}%"></div>
        <span class="bar__tick">${index % step === 0 ? esc(row.day.slice(5)) : ''}</span>
      </div>`;
    })
    .join('')}</div>
  <p class="note">Bar height is distinct visitors. Hover or tap a bar for the rest.</p>`;
}

function hourChart(hours: number[]): string {
  const peak = Math.max(1, ...hours);
  return `<div class="bars bars--hours">${hours
    .map((count, hour) => {
      const height = Math.round((count / peak) * 100);
      return `<div class="bar" title="${esc(`${String(hour).padStart(2, '0')}:00 — ${count} matches`)}">
        <div class="bar__fill" style="height:${height}%"></div>
        <span class="bar__tick">${hour % 6 === 0 ? hour : ''}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function countTable(label: string, rows: { label: string; count: number }[]): string {
  if (rows.length === 0) return `<p class="note">no ${esc(label)} data yet</p>`;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return `<table class="mini">
    <tr><th colspan="3">${esc(label)}</th></tr>
    ${rows
      .map(
        (row) => `<tr>
          <td>${esc(row.label)}</td>
          <td class="num">${row.count}</td>
          <td class="meter"><span style="width:${Math.round((row.count / total) * 100)}%"></span></td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

function gamesTable(summary: Summary): string {
  if (summary.games.length === 0) return '<p class="note">nothing played yet</p>';
  return `<table>
    <thead><tr>
      <th>game</th><th class="num">picked</th><th class="num">played</th>
      <th class="num">finished</th><th class="num">avg length</th>
      <th class="num">avg players</th><th class="num">menu</th><th class="num">p90 ping</th>
    </tr></thead>
    <tbody>${summary.games
      .map((row) => {
        const closed = row.finished + row.abandoned;
        const rate = closed > 0 ? row.finished / closed : 0;
        return `<tr>
          <td><b>${esc(row.id)}</b></td>
          <td class="num">${row.picks}</td>
          <td class="num">${row.plays}</td>
          <td class="num ${closed === 0 ? 'dim' : rate < 0.5 ? 'bad' : 'good'}">${
            closed === 0 ? '—' : pct(rate)
          }</td>
          <td class="num">${row.avgMinutes}m</td>
          <td class="num">${row.avgPlayers}</td>
          <td class="num">${row.menu || ''}</td>
          <td class="num ${row.p90 === 0 ? 'dim' : row.p90 > 250 ? 'bad' : ''}">${
            row.p90 === 0 ? '—' : `${row.p90}ms`
          }</td>
        </tr>`;
      })
      .join('')}</tbody>
  </table>`;
}

function peopleTable(summary: Summary): string {
  if (summary.people.length === 0) return '<p class="note">nobody has joined a room yet</p>';
  return `<table>
    <thead><tr><th>name</th><th class="num">rooms</th><th class="num">matches</th><th>last seen</th></tr></thead>
    <tbody>${summary.people
      .slice(0, 40)
      .map(
        (row) => `<tr>
          <td>${esc(row.name) || '<span class="dim">(no name)</span>'}</td>
          <td class="num">${row.rooms}</td>
          <td class="num">${row.matches}</td>
          <td class="dim small">${esc(row.last.slice(0, 16).replace('T', ' '))}</td>
        </tr>`,
      )
      .join('')}</tbody>
  </table>`;
}

function problems(summary: Summary): string {
  const { errors, crashes, reconnects, lost, p90, roughShare } = summary.problems;

  const connection = `<table class="mini">
    <tr><th colspan="2">connection</th></tr>
    <tr><td>reconnected mid-room</td><td class="num ${reconnects > 0 ? 'warn' : ''}">${reconnects}</td></tr>
    <tr><td>dropped and never returned</td><td class="num ${lost > 0 ? 'bad' : ''}">${lost}</td></tr>
    <tr><td>p90 round trip</td><td class="num ${p90 > 250 ? 'bad' : ''}">${p90 ? `${p90}ms` : '—'}</td></tr>
    <tr><td>matches that felt rough</td><td class="num ${roughShare > 0.25 ? 'bad' : ''}">${pct(roughShare)}</td></tr>
  </table>`;

  const errorRows =
    errors.length === 0
      ? '<p class="note">no errors sent to anyone</p>'
      : countTable('server errors', errors);

  const crashRows =
    crashes.length === 0
      ? '<p class="note">no browser crashes reported</p>'
      : `<table class="mini">
          <tr><th colspan="2">browser errors</th></tr>
          ${crashes
            .slice(0, 10)
            .map(
              (row) => `<tr>
                <td>
                  <code class="bad">${esc(row.msg)}</code>
                  ${row.at ? `<br><span class="dim small">${esc(row.at)}</span>` : ''}
                </td>
                <td class="num">${row.count}</td>
              </tr>`,
            )
            .join('')}
        </table>`;

  return connection + errorRows + crashRows;
}

// ---------------------------------------------------------------------------

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * A dash for "we do not know yet", never a zero.
 *
 * A dashboard that renders missing data as 0 is worse than one that renders
 * nothing: "0 matches per room" and "nobody has finished a room yet" look
 * identical and mean opposite things.
 */
function dash(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

/**
 * Escape everything that reaches the page.
 *
 * Names, crash messages and stack frames are all typed by somebody else, and
 * this page is served to whoever runs the site — the one reader whose browser
 * is worth the most to an attacker. There is no framework doing this for us.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4efe4; --panel: #fffdf7; --ink: #23201c; --dim: #7c7466;
  --line: #23201c; --accent: #f0a202; --good: #2e7d32; --bad: #c62828; --warn: #b26a00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17150f; --panel: #201d16; --ink: #f2ede1; --dim: #9a9184;
    --line: #4a4438; --accent: #f0a202; --good: #7cc47f; --bad: #ff6b6b; --warn: #e0a458;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 16px; background: var(--bg); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, sans-serif;
  max-width: 1100px; margin-inline: auto;
}
h1 { font-size: 1.4rem; margin: 0; }
h2 { font-size: 0.95rem; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.06em; }
a { color: inherit; }
.dim { color: var(--dim); }
.small { font-size: 0.82rem; }
.good { color: var(--good); }
.bad { color: var(--bad); }
.warn { color: var(--warn); }
.top { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.top p { margin: 4px 0 0; }
.windows { display: flex; gap: 6px; }
.win {
  padding: 5px 11px; border: 2px solid var(--line); border-radius: 8px;
  background: var(--panel); text-decoration: none; font-size: 0.85rem; font-weight: 600;
}
.win--on { background: var(--accent); color: #23201c; }
.card, .stat {
  background: var(--panel); border: 2px solid var(--line); border-radius: 12px;
  box-shadow: 3px 3px 0 var(--line); padding: 14px; margin-bottom: 16px;
}
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stats .stat { margin: 0; display: flex; flex-direction: column; gap: 2px; }
.stat__value { font-size: 1.7rem; font-weight: 700; line-height: 1.1; }
.stat__label { text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.07em; color: var(--dim); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.grid .card { margin-bottom: 0; }
.grid { margin-bottom: 16px; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 130px; overflow-x: auto; }
.bars--hours { height: 90px; }
.bar { flex: 1 1 0; min-width: 8px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
.bar__fill { background: var(--accent); border: 1px solid var(--line); border-bottom: 0; border-radius: 3px 3px 0 0; min-height: 2px; }
.bar__tick { font-size: 0.6rem; color: var(--dim); text-align: center; height: 1.2em; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th { text-align: start; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dim); font-weight: 600; }
th, td { padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
.num { text-align: end; font-variant-numeric: tabular-nums; }
.mini { margin-bottom: 14px; }
.mini:last-child { margin-bottom: 0; }
.meter { width: 34%; }
.meter span { display: block; height: 9px; background: var(--accent); border: 1px solid var(--line); border-radius: 3px; min-width: 2px; }
.note { color: var(--dim); font-size: 0.8rem; margin: 10px 0 0; }
.raw { overflow-x: auto; font-size: 0.72rem; line-height: 1.45; margin: 0; white-space: pre; color: var(--dim); }
code { font-size: 0.8rem; }
footer { padding: 4px 2px 24px; }
`;
