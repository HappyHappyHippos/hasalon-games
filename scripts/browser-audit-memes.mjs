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
  await call('Page.reload', { ignoreCache: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(1800);
  await evaluate(`localStorage.setItem('mg.lang','en')`);

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
  await sleep(100);
  const lobbyAudit = await evaluate(`({ activeTag: document.activeElement?.tagName, scale: visualViewport?.scale ?? 1, homeInputFont: ${homeInputFont} })`);
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

  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await evaluate(`window.mgStore.setState(${JSON.stringify({ hud: writingHud, memesPrivate: privateView })})`);
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
    };
  })()`);

  console.log(JSON.stringify({ output, screenshots: { writing, voting, result, landscape, options }, lobbyAudit, writingAudit, dragAudit, votingAudit, landscapeAudit, optionsAudit, browserErrors }, null, 2));
} finally {
  cdp?.close();
  edge.kill();
  vite.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
