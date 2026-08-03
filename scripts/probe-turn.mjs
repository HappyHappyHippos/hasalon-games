/** Verify a deployed authenticated TURN configuration with a relay-only RTP call. */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, WS_PATH } from '../packages/shared/src/protocol.ts';

const target = (process.argv[2] ?? 'https://hasalon-dev-dev.up.railway.app').replace(/\/$/, '');
const ws = new WebSocket(target.replace(/^http/, 'ws') + WS_PATH);
const identity = { name: 'TURN probe', colorIndex: 0, hat: 0, face: 0 };

function next(type, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw));
      if (message.t !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    };
    ws.on('message', onMessage);
  });
}
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});
ws.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, identity }));
const welcome = await next('welcome');
const iceResponse = await fetch(`${target}/ice`, {
  headers: {
    Authorization: `Bearer ${welcome.token}`,
    'X-Room-Code': welcome.room.code,
    'X-Player-Id': welcome.playerId,
  },
});
if (!iceResponse.ok) throw new Error(`/ice returned ${iceResponse.status}`);
const config = await iceResponse.json();
if (config.provider !== 'cloudflare') {
  throw new Error(`TURN is not configured on ${target}; provider=${config.provider}`);
}

const profile = join(tmpdir(), `hasalon-turn-probe-${process.pid}`);
await mkdir(profile, { recursive: true });
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(
  edgePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--remote-debugging-port=9342',
    `--user-data-dir=${profile}`,
    target,
  ],
  { stdio: 'ignore', windowsHide: true },
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

let cdp;
try {
  const targets = await (await waitForHttp('http://127.0.0.1:9342/json/list')).json();
  const page = targets.find((item) => item.type === 'page');
  if (!page) throw new Error('No browser page for TURN probe');
  cdp = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    cdp.once('open', resolve);
    cdp.once('error', reject);
  });
  let id = 0;
  const pending = new Map();
  cdp.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      cdp.send(JSON.stringify({ id: messageId, method, params }));
    });
  const result = await call('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const iceServers = ${JSON.stringify(config.iceServers)};
      const a = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
      const b = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      a.addTrack(stream.getAudioTracks()[0], stream);
      b.addTransceiver('audio', { direction: 'recvonly' });
      a.onicecandidate = ({ candidate }) => candidate && b.addIceCandidate(candidate);
      b.onicecandidate = ({ candidate }) => candidate && a.addIceCandidate(candidate);
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      const deadline = performance.now() + 20000;
      while (performance.now() < deadline && a.connectionState !== 'connected') {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const stats = await a.getStats();
      let selected = null;
      let outboundBytes = 0;
      stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selected = stats.get(report.selectedCandidatePairId);
        }
        if (report.type === 'outbound-rtp') outboundBytes += Number(report.bytesSent ?? 0);
      });
      const local = selected?.localCandidateId ? stats.get(selected.localCandidateId) : null;
      const remote = selected?.remoteCandidateId ? stats.get(selected.remoteCandidateId) : null;
      const answer = {
        connectionState: a.connectionState,
        iceState: a.iceConnectionState,
        localCandidateType: local?.candidateType ?? null,
        remoteCandidateType: remote?.candidateType ?? null,
        outboundBytes,
      };
      stream.getTracks().forEach((track) => track.stop());
      a.close();
      b.close();
      return answer;
    })()`,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  const probe = result.result.value;
  if (
    probe.connectionState !== 'connected' ||
    probe.localCandidateType !== 'relay' ||
    probe.outboundBytes <= 0
  ) {
    throw new Error(`Relay-only media failed: ${JSON.stringify(probe)}`);
  }
  console.log(JSON.stringify({ target, provider: config.provider, probe }, null, 2));
} finally {
  cdp?.close();
  edge.kill();
  ws.close();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
