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
    // Server not up yet; keep polling until the deadline below.
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* retry */ }
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
    source: `Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: { overlaysContent: false } });`,
  });
  await call('Page.reload', { ignoreCache: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(`typeof window.mgStore !== 'undefined'`)) break;
    await sleep(100);
  }
  const install = await screenshot('install-iphone-portrait');
  const installAudit = await evaluate(`(() => {
    const dialog = document.querySelector('.installprompt');
    const share = document.querySelector('.installprompt__share-demo svg');
    const home = document.querySelector('.installprompt__home-demo svg');
    return {
      present: !!dialog,
      steps: document.querySelectorAll('.installprompt__steps li').length,
      sharePaths: share?.querySelectorAll('path').length ?? 0,
      homeIcon: !!home?.querySelector('rect'),
      benefitsFullscreen: dialog?.textContent.includes('Safari') ?? false,
      keyboardOverlays: navigator.virtualKeyboard?.overlaysContent ?? false,
      appFixed: getComputedStyle(document.querySelector('.app')).position,
    };
  })()`);
  await evaluate(`document.querySelector('.installprompt .btn')?.click()`);
  await sleep(100);
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
  const landscapeLobbyRoom = {
    ...room,
    phase: 'lobby',
    players: Array.from({ length: 8 }, (_, seat) => ({
      id: `p${seat}`,
      name: ['Maya', 'Noam', 'Ari', 'Lior', 'Dana', 'Gal', 'Roni', 'Tal'][seat],
      colorIndex: seat,
      hat: seat,
      face: seat,
      ready: true,
      connected: true,
      isHost: seat === 0,
      seat,
      score: 0,
      totalScore: 0,
      voice: false,
      listening: true,
    })),
  };
  const players = [0, 1, 2].map((seat) => ({ seat, score: 0, alive: true, roundScore: 0, submitted: seat === 1, voted: false }));
  const privateView = { templateId: 'drake-hotline-bling', slots: 2, nudge: 'on', draft: ['When the family says one quick game', 'When it is suddenly 2 AM'], positions: [{ x: 0.5102, y: 0.0102, w: 0.4796, h: 0.4796 }, { x: 0.5102, y: 0.5102, w: 0.4796, h: 0.4796 }], submitted: false, myVote: null, isAuthor: false };
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
  const animatedPrivate = { ...privateView, templateId: 'gif-222516354-disappearing-kid-gif', positions: [{ x: 0.04, y: 0.03, w: 0.92, h: 0.18 }, { x: 0.04, y: 0.73, w: 0.92, h: 0.18 }] };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ memesPrivate: animatedPrivate })})`);
  await sleep(900);
  const animatedAudit = await evaluate(`(() => { const card = document.querySelector('.meme-card'); const video = card?.querySelector('video'); return { present: !!video, paused: video?.paused, readyState: video?.readyState, objectFit: video ? getComputedStyle(video).objectFit : '', cardClass: card?.className, fallback: card?.querySelector('.meme-card__fallback')?.textContent, mediaRequests: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('gif-222516354')) }; })()`);

  const stage = { templateId: 'distracted-boyfriend', texts: ['Me opening one message', 'The game night group chat'], positions: [{ x: 0.0975, y: 0.6275, w: 0.3592, h: 0.205 }, { x: 0.7, y: 0.50125, w: 0.2667, h: 0.1988 }], authorSeat: -1, ballots: 1, eligible: 2, tally: null, award: 0, top: 0, reactions: [2, 0, 0] };
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
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: landscapeLobbyRoom, playerId: 'p0' })})`);
  await sleep(300);
  await evaluate(`window.mgStore.setState({ error: null })`);
  const lobbyLandscape = await screenshot('lobby-landscape');
  const lobbyLandscapeAudit = await evaluate(`(() => {
    const sameRow = (selector) => {
      const tops = [...document.querySelectorAll(selector)].map((el) => Math.round(el.getBoundingClientRect().top));
      return tops.length ? Math.max(...Object.values(Object.groupBy(tops, (top) => top)).map((row) => row.length)) : 0;
    };
    const picker = document.querySelector('.picker');
    const people = document.querySelector('.people');
    return {
      overflowX: document.documentElement.scrollWidth > innerWidth,
      pickerColumns: getComputedStyle(picker).gridTemplateColumns.split(' ').length,
      peopleColumns: getComputedStyle(people).gridTemplateColumns.split(' ').length,
      gamesOnOneRow: sameRow('.gamecard'),
      peopleOnOneRow: sameRow('.person'),
      playersOnOneRow: sameRow('.person:not(.person--self)'),
      gameArtWidths: [...document.querySelectorAll('.gamecard__art')].map((el) => Math.round(el.getBoundingClientRect().width)),
      boxArtBackgrounds: [...document.querySelectorAll('.boxart')].map((el) => getComputedStyle(el).backgroundColor),
      selfWidth: Math.round(document.querySelector('.person--self').getBoundingClientRect().width),
      playerWidth: Math.round(document.querySelector('.person:not(.person--self)').getBoundingClientRect().width),
      arrowDirection: getComputedStyle(document.querySelector('.person--self .appearance__arrows')).flexDirection,
      gameExplanationPresent: !!document.querySelector('.controls-hint'),
      pickerHeadingPresent: !!document.querySelector('.lobby__choice > .eyebrow'),
      micNotes: [...document.querySelectorAll('.voicebar p')].map((element) => element.textContent),
    };
  })()`);

  const gunLobbyRoom = {
    ...landscapeLobbyRoom,
    gameId: 'gunmayhem',
    settings: { game: 'gunmayhem', levelId: 'salon', stocks: 4, targetWins: 3, weaponsEnabled: true, bombsEnabled: true, powerupsEnabled: true },
  };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: gunLobbyRoom, playerId: 'p0' })})`);
  await sleep(200);
  await evaluate(`document.querySelector('.lobby__settings')?.scrollIntoView({ block: 'start' }); window.mgStore.setState({ error: null })`);
  await sleep(100);
  const settingsLandscape = await screenshot('settings-landscape');
  const settingsLandscapeAudit = await evaluate(`(() => {
    const settings = document.querySelector('.lobby__settings .settings');
    const buttons = [...document.querySelectorAll('.number-stepper__button')];
    return {
      columns: getComputedStyle(settings).gridTemplateColumns.split(' ').length,
      stepperCount: document.querySelectorAll('.number-stepper').length,
      targets: buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
      gameExplanationPresent: !!document.querySelector('.controls-hint'),
    };
  })()`);

  const gunPlayRoom = { ...gunLobbyRoom, phase: 'playing' };
  const gunHud = {
    phase: 'playing', round: 1, countdown: 0,
    players: [0, 1].map((seat) => ({ seat, score: 0, alive: true, stocks: 4, damage: seat * 12, weapon: 'pistol', ammo: 8, bombs: 2 })),
  };
  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: gunPlayRoom, playerId: 'p0', hud: gunHud, net: { rtt: 54, jitter: 11, delay: 72 }, error: null })})`);
  await sleep(300);
  const pingLandscape = await screenshot('ping-landscape');
  const pingAudit = await evaluate(`(() => {
    const badge = document.querySelector('.netbadge');
    const rect = badge?.getBoundingClientRect();
    return {
      text: badge?.textContent,
      display: badge ? getComputedStyle(badge).display : 'missing',
      fontSize: badge ? parseFloat(getComputedStyle(badge).fontSize) : 0,
      insideViewport: !!rect && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      bottomGap: rect ? innerHeight - rect.bottom : null,
    };
  })()`);

  const musicAudit = await evaluate(`Promise.all(['/music/lobby.mp3', '/music/gunmayhem.mp3', '/music/achtung.mp3', '/music/memes.mp3'].map((url) => new Promise((resolve) => {
    const audio = new Audio(url);
    const finish = (ok) => resolve({ url, ok, duration: Number.isFinite(audio.duration) ? audio.duration : null });
    audio.addEventListener('loadedmetadata', () => finish(true), { once: true });
    audio.addEventListener('error', () => finish(false), { once: true });
    setTimeout(() => finish(false), 8000);
    audio.load();
  })))`);

  await evaluate(`window.mgStore.setState(${JSON.stringify({ room, hud: writingHud, memesPrivate: privateView, error: null })})`);
  await sleep(500);
  const landscape = await screenshot('writing-landscape');
  const landscapeAudit = await evaluate(`(() => {
    const caption = document.querySelector('.meme-card__caption--editable');
    const handle = caption?.querySelector('.meme-card__resize');
    const fields = document.querySelector('.memes__fields');
    const preview = document.querySelector('.memes__preview');
    const card = document.querySelector('.memes__preview .meme-card');
    const before = parseFloat(caption?.style.width ?? '0');
    handle?.focus();
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const handleRect = handle?.getBoundingClientRect();
    const previewRect = preview?.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    return new Promise((resolve) => requestAnimationFrame(() => resolve({
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight,
      fieldsScrollable: !!fields && fields.scrollHeight > fields.clientHeight,
      fieldsPaddingBlock: fields ? [getComputedStyle(fields).paddingTop, getComputedStyle(fields).paddingBottom] : [],
      cardFitsPreview: !!previewRect && !!cardRect && cardRect.top >= previewRect.top && cardRect.bottom <= previewRect.bottom,
      cardHeight: cardRect?.height ?? 0,
      previewHeight: previewRect?.height ?? 0,
      resizeTarget: handleRect ? { width: handleRect.width, height: handleRect.height } : null,
      resized: { before, after: parseFloat(caption?.style.width ?? '0') },
    })));
  })()`);

  await evaluate(`window.mgStore.setState(${JSON.stringify({ room: skribblRoom, playerId: 'p1', hud: skribblHud, secret: { word: 'boat', choices: [] }, matchWinnerSeat: null, error: null })})`);
  await sleep(300);
  const skribblLandscape = await screenshot('skribbl-landscape');
  const skribblLandscapeAudit = await evaluate(`(() => {
    const selectors = ['.skribbl__side', '.skribbl__stage', '.skribbl__chat'];
    const rects = selectors.map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    return {
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight,
      columns: getComputedStyle(document.querySelector('.skribbl__body')).gridTemplateColumns.split(' ').length,
      aligned: rects.every((rect) => Math.abs(rect.top - rects[0].top) < 1 && Math.abs(rect.bottom - rects[0].bottom) < 1),
      paperAligned: (() => {
        const paper = document.querySelector('.skribbl__paper').getBoundingClientRect();
        return Math.abs(paper.top - rects[0].top) < 1 && Math.abs(paper.bottom - rects[0].bottom) < 1;
      })(),
      fillPresent: [...document.querySelectorAll('.skribbl__act')].some((button) => button.textContent.trim() === 'Fill'),
      actionTargets: [...document.querySelectorAll('.skribbl__act')].map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
      rects,
    };
  })()`);

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

  console.log(JSON.stringify({ output, screenshots: { install, lobby, boxArt, skribblArt, memesArt, writing, voting, result, matchOver, skribbl, lobbyLandscape, settingsLandscape, pingLandscape, landscape, skribblLandscape, options }, installAudit, lobbyAudit, writingAudit, dragAudit, animatedAudit, votingAudit, downloadAudit, matchOverAudit, skribblAudit, lobbyLandscapeAudit, settingsLandscapeAudit, pingAudit, musicAudit, landscapeAudit, skribblLandscapeAudit, optionsAudit, browserErrors }, null, 2));
} finally {
  cdp?.close();
  edge.kill();
  vite.kill();
  server.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
