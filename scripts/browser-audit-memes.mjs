import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(tmpdir(), 'hasalon-memes-browser-audit');
const profile = join(tmpdir(), `hasalon-edge-${process.pid}`);
await mkdir(output, { recursive: true });

const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '4173'], {
  cwd: join(root, 'packages', 'client'),
  stdio: 'ignore',
  windowsHide: true,
});
const server = spawn(process.execPath, [join(root, 'packages', 'server', 'dist', 'server.js'), '--port', '3000'], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
});
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  'http://127.0.0.1:4173',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await sleep(125);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let cdp;
try {
  await waitFor('http://127.0.0.1:4173');
  await waitFor('http://127.0.0.1:3000/healthz');
  const targets = await (await waitFor('http://127.0.0.1:9333/json/list')).json();
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No browser target');
  cdp = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { cdp.once('open', resolve); cdp.once('error', reject); });
  let id = 0;
  const pending = new Map();
  const browserErrors = [];
  cdp.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    cdp.send(JSON.stringify({ id: messageId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const screenshot = async (name) => {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = join(output, `${name}.png`);
    await writeFile(path, Buffer.from(result.data, 'base64'));
    return path;
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
  });
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });`,
  });
  await call('Page.reload', { ignoreCache: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(`typeof window.mgStore !== 'undefined'`)) break;
    await sleep(100);
  }
  await evaluate(`localStorage.setItem('mg.lang','en'); window.mgStore.setState({ lang: 'en' })`);

  const room = {
    code: 'MEME', gameId: 'memes', phase: 'playing', hostId: 'p0', paused: false,
    pausedBy: null, settings: { game: 'memes', writeSeconds: 60, voteSeconds: 12, rounds: 3, nudges: true },
    players: [0, 1, 2].map((seat) => ({
      id: `p${seat}`, name: ['Maya', 'Noam', 'Ari'][seat], colorIndex: seat, hat: seat,
      face: seat, ready: true, connected: true, isHost: seat === 0, seat, score: 0,
      totalScore: 0, voice: false, listening: true,
    })),
  };
  const players = [0, 1, 2].map((seat) => ({ seat, score: 0, alive: true, roundScore: 0, submitted: seat === 1, voted: false }));
  const privateView = { templateId: 'drake-hotline-bling', slots: 2, nudge: 'on', draft: ['When the family says one quick game', 'When it is suddenly 2 AM'], positions: [{ x: 0.5102, y: 0.0102 }, { x: 0.5102, y: 0.5102 }], submitted: false, myVote: null, isAuthor: false };
  const writingHud = { phase: 'writing', round: 1, countdown: 0, players, memes: { phaseTicks: 2700, phaseTotal: 3600, phaseSeq: 2, rounds: 3, entryIndex: -1, entryCount: 0, stage: null } };
  const homeInputFont = await evaluate(`(() => { const input = document.querySelector('input'); input?.focus(); return input ? parseFloat(getComputedStyle(input).fontSize) : 0; })()`);
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: { ...room, phase: 'lobby' }, playerId: 'p0' })})`);
  await sleep(600);
  const lobby = await screenshot('lobby-art-portrait');
  const lobbyAudit = await evaluate(`({
    activeTag: document.activeElement?.tagName,
    scale: visualViewport?.scale ?? 1,
    homeInputFont: ${homeInputFont},
    overflow: document.documentElement.scrollWidth > innerWidth,
    error: window.mgStore.getState().error,
    orientation: JSON.parse(document.querySelector('link[rel=manifest]') ? ${JSON.stringify(await (await fetch('http://127.0.0.1:4173/manifest.webmanifest')).text())} : '{}').orientation,
  })`);
  await evaluate(`document.querySelector('.picker')?.scrollIntoView({ block: 'start' })`);
  await sleep(100);
  const boxArt = await screenshot('lobby-box-art-portrait');
  await evaluate(`document.querySelectorAll('.gamecard')[2]?.scrollIntoView({ block: 'start' })`);
  await sleep(100);
  const skribblArt = await screenshot('skribbl-box-art-portrait');
  await evaluate(`document.querySelectorAll('.gamecard')[3]?.scrollIntoView({ block: 'start' })`);
  await sleep(100);
  const memesArt = await screenshot('memes-box-art-portrait');
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room, playerId: 'p0', hud: writingHud, memesPrivate: privateView, matchWinnerSeat: null })})`);
  await sleep(800);
  const writing = await screenshot('writing-portrait');
  const writingAudit = await evaluate(`(() => {
    const card = document.querySelector('.meme-card');
    const textarea = document.querySelector('textarea');
    const top = document.querySelector('.memes__top');
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      cardVisible: !!card && card.getBoundingClientRect().height > 100,
      fullImage: !!card && !!card.querySelector('img') && Math.abs(card.getBoundingClientRect().width / card.getBoundingClientRect().height - card.querySelector('img').naturalWidth / card.querySelector('img').naturalHeight) < 0.01,
      objectFit: card ? getComputedStyle(card.querySelector('img')).objectFit : '',
      inputFont: textarea ? parseFloat(getComputedStyle(textarea).fontSize) : 0,
      top: top?.getBoundingClientRect().top,
    };
  })()`);
  const dragAudit = await evaluate(`(() => {
    const caption = document.querySelector('.meme-card__caption--editable');
    const before = parseFloat(caption.style.left);
    caption.focus();
    caption.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    return new Promise((resolve) => requestAnimationFrame(() => resolve({ before, after: parseFloat(caption.style.left) })));
  })()`);
  const animatedPrivate = { ...privateView, templateId: 'gif-222516354-disappearing-kid-gif', positions: [{ x: 0.04, y: 0.03 }, { x: 0.04, y: 0.73 }] };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ memesPrivate: animatedPrivate })})`);
  await sleep(900);
  const animatedAudit = await evaluate(`(() => { const card = document.querySelector('.meme-card'); const video = card?.querySelector('video'); return { present: !!video, paused: video?.paused, readyState: video?.readyState, objectFit: video ? getComputedStyle(video).objectFit : '', cardClass: card?.className, fallback: card?.querySelector('.meme-card__fallback')?.textContent, mediaRequests: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('gif-222516354')) }; })()`);

  const stage = { templateId: 'distracted-boyfriend', texts: ['Me opening one message', 'The game night group chat'], positions: [{ x: 0.0975, y: 0.6275 }, { x: 0.755, y: 0.50125 }], authorSeat: -1, ballots: 1, eligible: 2, tally: null, award: 0, top: 0, reactions: [2, 0, 0] };
  const votingHud = { phase: 'voting', round: 1, countdown: 0, players, memes: { phaseTicks: 600, phaseTotal: 720, phaseSeq: 4, rounds: 3, entryIndex: 0, entryCount: 3, stage } };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ hud: votingHud, memesPrivate: { ...privateView, templateId: 'drake-hotline-bling' } })})`);
  await sleep(500);
  const voting = await screenshot('voting-portrait');
  const votingAudit = await evaluate(`[...document.querySelectorAll('.memes__vote-button')].map((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))`);

  const resultStage = { ...stage, authorSeat: 2, ballots: 2, tally: [2, 0, 0], award: 125 };
  const resultHud = { ...votingHud, phase: 'result', memes: { ...votingHud.memes, phaseTicks: 240, phaseTotal: 270, phaseSeq: 5, stage: resultStage } };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ hud: resultHud })})`);
  await sleep(700);
  const result = await screenshot('result-portrait');
  await evaluate(`(() => {
    window.__memeDownload = null;
    URL.createObjectURL = (blob) => { window.__memeDownload = { type: blob.type, size: blob.size }; return 'blob:http://127.0.0.1/fake'; };
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = function () { window.__memeDownload = { ...window.__memeDownload, name: this.download }; };
    document.querySelector('.memes__download button')?.click();
  })()`);
  await sleep(1000);
  const downloadAudit = await evaluate(`window.__memeDownload`);

  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: { ...room, phase: 'matchOver' }, hud: { ...resultHud, phase: 'matchOver' }, matchWinnerSeat: 2 })})`);
  await sleep(200);
  const matchOver = await screenshot('match-over-portrait');
  const matchOverAudit = await evaluate(`({ headerPresent: !!document.querySelector('.memes__top'), phasePresent: !!document.querySelector('.memes__phase'), overlayZ: Number(getComputedStyle(document.querySelector('.matchover')).zIndex) })`);

  const skribblRoom = { ...room, gameId: 'skribbl', phase: 'playing', settings: { game: 'skribbl', language: 'en', drawSeconds: 80, rounds: 3, hints: true } };
  const skribblHud = { phase: 'drawing', round: 1, countdown: 0, players: players.map((player) => ({ ...player, guessed: false })), skribbl: { masked: '_ _ _ _ _', drawerSeat: 1, lang: 'en', phaseTicks: 2400, rounds: 3 } };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: skribblRoom, hud: skribblHud, secret: null, matchWinnerSeat: null })})`);
  await sleep(300);
  await evaluate(`document.querySelector('.skribbl__guess')?.focus()`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  const skribbl = await screenshot('skribbl-keyboard-portrait');
  const skribblAudit = await evaluate(`(() => { const rect = document.querySelector('.skribbl__top').getBoundingClientRect(); return { focused: document.activeElement?.classList.contains('skribbl__guess'), top: rect.top, bottom: rect.bottom, fixed: getComputedStyle(document.querySelector('.skribbl__top')).position, visible: rect.top >= 0 && rect.bottom <= innerHeight }; })()`);

  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room, hud: writingHud, memesPrivate: privateView })})`);
  await sleep(500);
  const landscape = await screenshot('writing-landscape');
  const landscapeAudit = await evaluate(`({ overflowX: document.documentElement.scrollWidth > innerWidth, overflowY: document.documentElement.scrollHeight > innerHeight })`);

  await evaluate(`document.querySelector('.options')?.click()`);
  await sleep(100);
  const options = await screenshot('options-landscape');
  const optionsAudit = await evaluate(`(() => {
    const panel = document.querySelector('.options__panel').getBoundingClientRect();
    const outer = document.querySelector('.options__segmented').getBoundingClientRect();
    const selected = document.querySelector('.options__segmented .seg--on').getBoundingClientRect();
    return {
      insideViewport: panel.left >= 0 && panel.top >= 0 && panel.right + 12 <= innerWidth && panel.bottom + 12 <= innerHeight,
      segmentInset: { left: selected.left - outer.left, top: selected.top - outer.top, right: outer.right - selected.right, bottom: outer.bottom - selected.bottom },
      shadow: getComputedStyle(document.querySelector('.options__panel')).boxShadow,
      reloadInHead: document.querySelectorAll('.options__head-actions .btn').length === 2,
      reloadInFoot: !!document.querySelector('.options__foot .btn:not(.btn--primary):not(.btn--ghost)'),
    };
  })()`);

  console.log(JSON.stringify({ output, screenshots: { lobby, boxArt, skribblArt, memesArt, writing, voting, result, matchOver, skribbl, landscape, options }, lobbyAudit, writingAudit, dragAudit, animatedAudit, votingAudit, downloadAudit, matchOverAudit, skribblAudit, landscapeAudit, optionsAudit, browserErrors }, null, 2));
} finally {
  cdp?.close();
  edge.kill();
  vite.kill();
  server.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
