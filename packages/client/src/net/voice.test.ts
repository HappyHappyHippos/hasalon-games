import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Voice } from './voice';

class FakeTrack extends EventTarget {
  kind = 'audio';
  enabled = true;
  muted = false;
  readyState: MediaStreamTrackState = 'live';

  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  private tracks: FakeTrack[];

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeTrack[] {
    return this.getTracks();
  }

  addTrack(track: FakeTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  removeTrack(track: FakeTrack): void {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }
}

class FakeAudio {
  autoplay = false;
  style = { display: '' };
  srcObject: FakeStream | null = null;
  paused = true;

  setAttribute(): void {}
  remove(): void {}
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
}

class FakeSender {
  track: FakeTrack | null;
  replacements: Array<FakeTrack | null> = [];

  constructor(track: FakeTrack | null) {
    this.track = track;
  }

  async replaceTrack(track: FakeTrack | null): Promise<void> {
    this.track = track;
    this.replacements.push(track);
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  sender: FakeSender | null = null;
  transceiver: RTCRtpTransceiver | null = null;
  closed = false;
  restarts = 0;
  candidates: Array<RTCIceCandidateInit | null> = [];
  configuration: RTCConfiguration;

  onnegotiationneeded: ((event: Event) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  oniceconnectionstatechange: ((event: Event) => void) | null = null;

  constructor(configuration: RTCConfiguration = {}) {
    this.configuration = configuration;
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(trackOrKind: FakeTrack | string, init?: RTCRtpTransceiverInit): RTCRtpTransceiver {
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    this.sender = new FakeSender(track);
    this.transceiver = {
      sender: this.sender,
      receiver: { track: new FakeTrack() },
      direction: init?.direction ?? 'sendrecv',
      currentDirection: null,
      mid: null,
      setCodecPreferences: () => undefined,
      stop: () => undefined,
    } as unknown as RTCRtpTransceiver;
    return this.transceiver;
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
    if (description?.type === 'rollback') {
      this.signalingState = 'stable';
      this.localDescription = null;
      return;
    }
    const type = description?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    this.localDescription = fakeDescription(type);
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    // Modern browsers automatically roll a local offer back when the polite
    // side accepts a colliding remote offer.
    this.remoteDescription = fakeDescription(description.type);
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
    this.candidates.push(candidate ?? null);
  }

  setConfiguration(configuration: RTCConfiguration): void {
    this.configuration = configuration;
  }

  restartIce(): void {
    this.restarts += 1;
    queueMicrotask(() => this.onnegotiationneeded?.(new Event('negotiationneeded')));
  }

  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as unknown as RTCStatsReport);
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
  }
}

function fakeDescription(type: RTCSdpType): RTCSessionDescription {
  return {
    type,
    sdp: `v=0\na=${type}`,
    toJSON: () => ({ type, sdp: `v=0\na=${type}` }),
  };
}

class FakeWindow extends EventTarget {
  AudioContext = undefined;
  setTimeout = windowlessSetTimeout;
  clearTimeout = clearTimeout;
  setInterval = setInterval;
  clearInterval = clearInterval;
}

function windowlessSetTimeout(handler: TimerHandler, timeout?: number): number {
  return setTimeout(handler, timeout) as unknown as number;
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  body = { appendChild: vi.fn() };
  createElement(): FakeAudio {
    return new FakeAudio();
  }
}

const getUserMedia = vi.fn<() => Promise<MediaStream>>();

beforeEach(() => {
  FakePeerConnection.instances = [];
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(new FakeStream([new FakeTrack()]) as unknown as MediaStream);
  vi.stubGlobal('window', new FakeWindow());
  vi.stubGlobal('document', new FakeDocument());
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

/** The lifecycle tests pin the behavior that used to fail when a listener became a speaker. */
describe('Voice lifecycle', () => {
  it('prepares receiving and peers without asking for microphone permission', async () => {
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers(['a']);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0]!.sender?.track).toBeNull();
    voice.stop();
  });

  it('turns the microphone on and off with replaceTrack while preserving the peer', async () => {
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers(['a']);
    const pc = FakePeerConnection.instances[0]!;

    await voice.start('b');
    expect(FakePeerConnection.instances).toEqual([pc]);
    expect(pc.sender?.replacements.at(-1)).toBeInstanceOf(FakeTrack);
    expect(voice.getSnapshot().active).toBe(true);

    voice.stopMic();
    expect(FakePeerConnection.instances).toEqual([pc]);
    expect(pc.closed).toBe(false);
    expect(pc.sender?.replacements.at(-1)).toBeNull();
    expect(voice.getSnapshot()).toMatchObject({ active: false, listening: true });
    voice.stop();
  });

  it('offers the sender m-line when the initial answer was receive-only', async () => {
    const voice = new Voice();
    const signals: unknown[] = [];
    voice.prepare('b');
    voice.send = (_to, data) => signals.push(data);
    await voice.syncPeers(['a']);
    await voice.onSignal('a', { description: { type: 'offer', sdp: 'v=0' } });
    const pc = FakePeerConnection.instances[0]!;
    Object.assign(pc.transceiver!, { currentDirection: 'recvonly' });
    signals.length = 0;
    getUserMedia.mockResolvedValueOnce(new FakeStream([new FakeTrack()]) as unknown as MediaStream);

    await voice.start('b');
    await settle();

    expect(signals).toContainEqual({
      description: expect.objectContaining({ type: 'offer' }),
    });
    voice.stop();
  });

  it('keeps receiving when microphone permission is denied', async () => {
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers(['a']);
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));

    await voice.start('b');
    expect(voice.getSnapshot()).toMatchObject({ active: false, listening: true, error: 'denied' });
    expect(FakePeerConnection.instances[0]!.closed).toBe(false);
    voice.stop();
  });

  it('fully disconnects only when the listener opts out', async () => {
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers(['a']);
    const pc = FakePeerConnection.instances[0]!;

    voice.setDeaf(true);
    expect(pc.closed).toBe(true);
    expect(voice.getSnapshot()).toMatchObject({ deaf: true, peers: {} });
    voice.stop();
  });
});

/** Initial setup is deterministic; later recovery glare must still converge. */
describe('Voice negotiation', () => {
  it('uses the shared id ordering to produce exactly one initial offer', async () => {
    const alice = new Voice();
    const bob = new Voice();
    alice.prepare('a');
    bob.prepare('b');
    alice.send = (_to, data) => void bob.onSignal('a', data);
    bob.send = (_to, data) => void alice.onSignal('b', data);
    await Promise.all([alice.syncPeers(['b']), bob.syncPeers(['a'])]);
    const alicePc = FakePeerConnection.instances[0]!;
    const bobPc = FakePeerConnection.instances[1]!;
    await settle();

    expect(alicePc.signalingState).toBe('stable');
    expect(bobPc.signalingState).toBe('stable');
    expect(alicePc.remoteDescription?.type).toBe('answer');
    expect(bobPc.remoteDescription?.type).toBe('offer');
    alice.stop();
    bob.stop();
  });

  it('resolves simultaneous recovery offers with polite and impolite roles', async () => {
    const alice = new Voice();
    const bob = new Voice();
    alice.prepare('a');
    bob.prepare('b');
    await Promise.all([
      alice.onSignal('b', { description: { type: 'offer', sdp: 'initial-b' } }),
      bob.onSignal('a', { description: { type: 'offer', sdp: 'initial-a' } }),
    ]);
    const alicePc = FakePeerConnection.instances[0]!;
    const bobPc = FakePeerConnection.instances[1]!;
    await Promise.all([alicePc.setLocalDescription(), bobPc.setLocalDescription()]);
    const aliceOffer = alicePc.localDescription!.toJSON();
    const bobOffer = bobPc.localDescription!.toJSON();
    alice.send = (_to, data) => void bob.onSignal('a', data);
    bob.send = (_to, data) => void alice.onSignal('b', data);

    await Promise.all([
      alice.onSignal('b', { description: bobOffer }),
      bob.onSignal('a', { description: aliceOffer }),
    ]);
    await settle();

    expect(alicePc.signalingState).toBe('stable');
    expect(bobPc.signalingState).toBe('stable');
    alice.stop();
    bob.stop();
  });

  it('buffers an ICE candidate that arrives before the remote description', async () => {
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers(['a']);
    const pc = FakePeerConnection.instances[0]!;
    voice.send = () => undefined;

    await voice.onSignal('a', { candidate: { candidate: 'candidate:1' } });
    expect(pc.candidates).toEqual([]);
    await voice.onSignal('a', { description: { type: 'offer', sdp: 'v=0' } });
    expect(pc.candidates).toEqual([{ candidate: 'candidate:1' }]);
    voice.stop();
  });

  it('accepts an in-room offer that beats the authoritative room effect', async () => {
    const voice = new Voice();
    voice.prepare('b');
    voice.send = () => undefined;

    await voice.onSignal('a', { description: { type: 'offer', sdp: 'v=0' } });
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0]!.remoteDescription?.type).toBe('offer');
    expect(FakePeerConnection.instances[0]!.signalingState).toBe('stable');
    voice.stop();
  });

  it('rejects an offer excluded by the latest authoritative room effect', async () => {
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers([]);

    await voice.onSignal('a', { description: { type: 'offer', sdp: 'v=0' } });
    expect(FakePeerConnection.instances).toEqual([]);
    voice.stop();
  });

  it('lets either endpoint initiate an ICE restart after failure', async () => {
    vi.useFakeTimers();
    const voice = new Voice();
    voice.prepare('b');
    await voice.syncPeers(['a']);
    const pc = FakePeerConnection.instances[0]!;
    pc.connectionState = 'failed';
    pc.iceConnectionState = 'failed';
    pc.onconnectionstatechange?.(new Event('connectionstatechange'));

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(pc.restarts).toBe(1);
    expect(voice.getSnapshot().peers).toEqual({ a: 'recovering' });
    voice.stop();
    vi.useRealTimers();
  });
});
