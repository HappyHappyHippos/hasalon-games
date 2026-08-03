import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverPort = 4310;
const clientPort = 4175;
const profiles = [
  join(tmpdir(), `hasalon-voice-a-${process.pid}`),
  join(tmpdir(), `hasalon-voice-b-${process.pid}`),
];
const output = join(tmpdir(), 'hasalon-voice-browser-audit');
await Promise.all(profiles.map((profile) => mkdir(profile, { recursive: true })));
await mkdir(output, { recursive: true });

const server = spawn(process.execPath, [join(root, 'packages/server/dist/server.js'), '--port', String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
});
const vite = spawn(
  process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(clientPort)],
  {
    cwd: join(root, 'packages/client'),
    env: { ...process.env, SERVER_PORT: String(serverPort) },
    stdio: 'ignore',
    windowsHide: true,
  },
);

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
      `--remote-debugging-port=${9340 + index}`,
      `--user-data-dir=${profiles[index]}`,
      `http://127.0.0.1:${clientPort}/?voice-audit=${index}`,
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
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function connectBrowser(port) {
  const targets = await (await waitForHttp(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page');
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
  try {
    voiceState = await browser.evaluate(`typeof window.mgVoiceDiagnostics === 'function' ? window.mgVoiceDiagnostics() : null`);
  } catch {}
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(lastValue)} voice=${JSON.stringify(voiceState)}`);
}

async function diagnostics(browser) {
  return browser.evaluate('window.mgVoiceDiagnostics()');
}

const browsers = [];
try {
  await waitForHttp(`http://127.0.0.1:${serverPort}/healthz`);
  await waitForHttp(`http://127.0.0.1:${clientPort}`);
  browsers.push(await connectBrowser(9340), await connectBrowser(9341));
  const [alice, bob] = browsers;
  for (const browser of browsers) {
    await waitForValue(
      browser,
      `typeof window.mgStore !== 'undefined' && window.mgStore.getState().status === 'open'`,
      'socket open',
    );
  }

  await alice.evaluate(`window.mgStore.getState().setIdentity({ name: 'Alice' })`);
  await waitForValue(alice, `document.querySelector('.home__actions .btn--primary')?.disabled === false`, 'create enabled');
  await alice.evaluate(`document.querySelector('.home__actions .btn--primary')?.click()`);
  const code = await waitForValue(
    alice,
    `window.mgStore.getState().room?.code ?? ''`,
    'host room',
  );
  await bob.evaluate(`(() => {
    const store = window.mgStore.getState();
    store.setIdentity({ name: 'Bob', colorIndex: 1 });
    store.setPendingCode(${JSON.stringify(code)});
  })()`);
  await waitForValue(bob, `!!document.querySelector('.home__actions form, form.home__actions')`, 'join form');
  await waitForValue(bob, `document.querySelector('form.home__actions .btn--primary')?.disabled === false`, 'join enabled');
  await bob.evaluate(`document.querySelector('form.home__actions')?.requestSubmit()`);
  for (const browser of browsers) {
    await waitForValue(
      browser,
      `window.mgStore.getState().room?.players.length === 2`,
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

  await alice.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .voicebtn')?.click()`);
  await waitForValue(
    bob,
    `window.mgVoiceDiagnostics().then((value) => value.peers[0]?.inboundBytes > 0)`,
    'Alice audio at Bob',
    20_000,
  );

  await bob.evaluate(`document.querySelector('.voicebar:not(.voicebar--compact) .voicebtn')?.click()`);
  await waitForValue(
    alice,
    `window.mgVoiceDiagnostics().then((value) => value.peers[0]?.inboundBytes > 0)`,
    'Bob audio at Alice',
    20_000,
  );

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

  const final = await Promise.all(browsers.map(diagnostics));
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
  for (const process of edges) process.kill();
  vite.kill();
  server.kill();
  await Promise.all(profiles.map((profile) => rm(profile, { recursive: true, force: true }).catch(() => undefined)));
}
