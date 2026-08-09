import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const remoteBase = process.argv[2]?.replace(/\/$/, '') || null;
const reservePort = () =>
  new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string') {
        socket.close();
        reject(new Error('Could not reserve an audit port'));
        return;
      }
      const { port } = address;
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
const [serverPort, clientPort, debugPortA, debugPortB] = await Promise.all([
  reservePort(),
  reservePort(),
  reservePort(),
  reservePort(),
]);
const profiles = [
  join(tmpdir(), `hasalon-voice-a-${process.pid}`),
  join(tmpdir(), `hasalon-voice-b-${process.pid}`),
];
const output = join(tmpdir(), 'hasalon-voice-browser-audit');
await Promise.all(profiles.map((profile) => mkdir(profile, { recursive: true })));
await mkdir(output, { recursive: true });

const server = remoteBase
  ? null
  : spawn(process.execPath, [join(root, 'packages/server/dist/server.js'), '--port', String(serverPort)], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true,
    });
const vite = remoteBase
  ? null
  : spawn(
      process.execPath,
      [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(clientPort)],
      {
        cwd: join(root, 'packages/client'),
        env: { ...process.env, SERVER_PORT: String(serverPort) },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
const appUrl = remoteBase ?? `http://127.0.0.1:${clientPort}`;

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edges = [0, 1].map((index) =>
  spawn(
    edgePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--remote-debugging-port=${index === 0 ? debugPortA : debugPortB}`,
      `--user-data-dir=${profiles[index]}`,
      `${appUrl}/?voice-audit=${index}`,
    ],
    { stdio: 'ignore', windowsHide: true },
  ),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      // Server not up yet; keep polling until the deadline below.
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function connectBrowser(port) {
  let target = null;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
    const targets = await (await waitForHttp(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find((item) => item.type === 'page' && item.url.startsWith(appUrl));
    if (!target) await sleep(100);
  }
  if (!target) throw new Error(`No page target on ${port}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  await call('Runtime.enable');
  await call('Page.enable');
  return { ws, call, evaluate, errors };
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform !== 'win32') {
    child.kill();
    return;
  }
  await new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', resolve);
    killer.once('exit', resolve);
  });
}

async function waitForValue(browser, expression, label, timeoutMs = 15_000) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await browser.evaluate(expression);
      lastValue = value;
      if (value) return value;
    } catch (error) {
      // A hash navigation during create/join can collect an in-flight Runtime
      // promise. The page stays alive; retry against its next execution context.
      if (!String(error).includes('Promise was collected')) throw error;
    }
    await sleep(100);
  }
  let voiceState = null;
  let appState = null;
  try {
    voiceState = await browser.evaluate(`typeof window.mgVoiceDiagnostics === 'function' ? window.mgVoiceDiagnostics() : null`);
  } catch { /* diagnostics are best effort; the throw below is the real report */ }
  try {
    appState = await browser.evaluate(`(() => {
      const state = window.mgStore?.getState();
      return state ? { status: state.status, error: state.error, roomCode: state.room?.code ?? null } : null;
    })()`);
  } catch { /* diagnostics are best effort; the throw below is the real report */ }
  throw new Error(
    `Timed out waiting for ${label}; last=${JSON.stringify(lastValue)} app=${JSON.stringify(appState)} voice=${JSON.stringify(voiceState)} browserErrors=${JSON.stringify(browser.errors)}`,
  );
}

async function diagnostics(browser) {
  return browser.evaluate('window.mgVoiceDiagnostics()');
}

const browsers = [];
try {
  if (!remoteBase) await waitForHttp(`http://127.0.0.1:${serverPort}/healthz`);
  await waitForHttp(appUrl);
  browsers.push(await connectBrowser(debugPortA), await connectBrowser(debugPortB));
  const [alice, bob] = browsers;
  for (const browser of browsers) {
    await waitForValue(
      browser,
      `!!document.querySelector('.home__you input.input')`,
      'home screen',
    );
  }

  const setInput = (selector, value) => `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
      input,
      ${JSON.stringify(value)},
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;

  await alice.evaluate(setInput('.home__you input.input', 'Alice'));
  await waitForValue(alice, `document.querySelector('.home__actions .btn--primary')?.disabled === false`, 'create enabled');
  await alice.evaluate(`document.querySelector('.home__actions .btn--primary')?.click()`);
  const code = await waitForValue(
    alice,
    `document.querySelector('.lobby__code')?.textContent?.trim() ?? ''`,
    'host room',
  );
  await bob.evaluate(setInput('.home__you input.input', 'Bob'));
  await bob.evaluate(`[...document.querySelectorAll('.home__actions button')][1]?.click()`);
  await waitForValue(bob, `!!document.querySelector('.home__actions form, form.home__actions')`, 'join form');
  await bob.evaluate(setInput('form.home__actions .input--code', code));
  await waitForValue(bob, `document.querySelector('form.home__actions .btn--primary')?.disabled === false`, 'join enabled');
  await bob.evaluate(`document.querySelector('form.home__actions')?.requestSubmit()`);
  for (const browser of browsers) {
    await waitForValue(
      browser,
      `document.querySelectorAll('.people > .person').length === 2`,
      'two room members',
    );
    await waitForValue(
      browser,
      `window.mgVoiceDiagnostics().then((value) => value.peers.length === 1 && value.peers[0].status === 'connected')`,
      'prompt-free peer connection',
      20_000,
    );
  }

  const quiet = await Promise.all(browsers.map(diagnostics));
  if (quiet.some((item) => item.active)) throw new Error('A microphone opened before a user action');
  if (quiet.some((item) => item.peers.some((peer) => peer.signalingState !== 'stable'))) {
    throw new Error('Initial voice negotiation did not settle');
  }

  await alice.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .voicebtn')?.click()`);
  await waitForValue(
    bob,
    `window.mgVoiceDiagnostics().then((value) => value.peers[0]?.inboundBytes > 0)`,
    'Alice audio at Bob',
    20_000,
  );

  await bob.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .voicebtn')?.click()`);
  try {
    await waitForValue(
      alice,
      `window.mgVoiceDiagnostics().then((value) => value.peers[0]?.inboundBytes > 0)`,
      'Bob audio at Alice',
      20_000,
    );
  } catch (error) {
    throw new Error(`${error.message}; sender=${JSON.stringify(await diagnostics(bob))}`);
  }

  await alice.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .btn--ghost')?.click()`);
  const aliceListening = await waitForValue(
    alice,
    `window.mgVoiceDiagnostics().then((value) => !value.active && value.peers.length === 1)`,
    'Alice speaker-to-listener downgrade',
  );

  const before = (await diagnostics(alice)).peers[0].inboundBytes;
  await sleep(800);
  const after = (await diagnostics(alice)).peers[0].inboundBytes;
  if (after <= before) throw new Error('Alice stopped receiving when her microphone closed');

  await alice.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .btn--ghost')?.click()`);
  await waitForValue(alice, `window.mgVoiceDiagnostics().then((value) => value.peers.length === 0)`, 'deaf teardown');
  await waitForValue(bob, `window.mgVoiceDiagnostics().then((value) => value.peers.length === 0)`, 'remote deaf teardown');
  await alice.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .btn--ghost')?.click()`);
  for (const browser of browsers) {
    await waitForValue(
      browser,
      `window.mgVoiceDiagnostics().then((value) => value.peers.length === 1 && value.peers[0].status === 'connected')`,
      'undeaf reconnect',
      20_000,
    );
  }
  await waitForValue(
    alice,
    `window.mgVoiceDiagnostics().then((value) =>
      value.peers[0]?.signalingState === 'stable' && value.peers[0]?.inboundBytes > 0
    )`,
    'audio after undeaf',
    20_000,
  );
  await waitForValue(
    bob,
    `window.mgVoiceDiagnostics().then((value) => value.peers[0]?.signalingState === 'stable')`,
    'speaker stable after undeaf',
    20_000,
  );

  const final = await Promise.all(browsers.map(diagnostics));
  if (final.some((item) => item.peers.some((peer) => peer.signalingState !== 'stable'))) {
    throw new Error('Voice negotiation did not return to stable after reconnect');
  }
  await alice.call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(200);
  const capture = await alice.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const screenshot = join(output, 'voice-lobby-mobile.png');
  await writeFile(screenshot, Buffer.from(capture.data, 'base64'));
  if (browsers.some((browser) => browser.errors.length > 0)) {
    throw new Error(`Browser errors: ${JSON.stringify(browsers.map((browser) => browser.errors))}`);
  }
  console.log(JSON.stringify({ code, quiet, aliceListening, final, screenshot, browserErrors: [alice.errors, bob.errors] }, null, 2));
} finally {
  for (const browser of browsers) browser.ws.close();
  await Promise.all([...edges, vite, server].map(stopProcessTree));
  await Promise.all(profiles.map((profile) => rm(profile, { recursive: true, force: true }).catch(() => undefined)));
}
