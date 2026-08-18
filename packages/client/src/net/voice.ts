/**
 * Prompt-free, audio-only WebRTC voice for a room of at most eight people.
 *
 * Every pair of willing listeners negotiates one `sendrecv` audio transceiver
 * when they join. The transceiver exists before either microphone does, so
 * opening and closing a microphone is only `RTCRtpSender.replaceTrack()` and
 * never an SDP direction change. Negotiation follows the WebRTC "perfect
 * negotiation" pattern; either endpoint may restart ICE without an offerer
 * deadlock or glare race.
 *
 * Audio stays peer-to-peer. The game server relays opaque signalling and mints
 * short-lived TURN credentials; it never receives media.
 */
const STUN_ONLY_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

const ICE_FETCH_TIMEOUT_MS = 4_000;
const CONNECT_TIMEOUT_MS = 12_000;
const DISCONNECTED_GRACE_MS = 4_000;
const RECOVERY_CHECK_MS = 8_000;
const MAX_ICE_RESTARTS = 3;
const LEVEL_INTERVAL_MS = 250;
const SPEAKING_ON = 0.045;
const SPEAKING_OFF = 0.03;
const SPEAKING_HANG_MS = 350;

export type PeerStatus = 'connecting' | 'connected' | 'recovering' | 'failed';
export type VoiceError = 'denied' | 'nodevice' | 'unsupported' | null;
export type RelayStatus = 'loading' | 'cloudflare' | 'stun-only';

export interface VoiceSnapshot {
  /** Our microphone exists. This remains true while its track is muted. */
  active: boolean;
  /** Receiving room audio with no local microphone. */
  listening: boolean;
  /** Explicitly opted out of hearing the room. */
  deaf: boolean;
  muted: boolean;
  error: VoiceError;
  relay: RelayStatus;
  /** Safari has not yet accepted a gesture for remote playback. */
  playbackBlocked: boolean;
  peers: Record<string, PeerStatus>;
  speaking: string[];
}
export interface VoicePeerDiagnostic {
  id: string;
  status: PeerStatus;
  connectionState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  direction: RTCRtpTransceiverDirection;
  currentDirection: RTCRtpTransceiverDirection | null;
  localSdpDirection: string | null;
  remoteSdpDirection: string | null;
  senderTrack: MediaStreamTrackState | 'missing';
  candidateType: string | null;
  inboundBytes: number;
  outboundBytes: number;
  remoteTrack: MediaStreamTrackState | 'missing';
  playbackPaused: boolean;
  restarts: number;
}

export interface VoiceDiagnostic {
  active: boolean;
  muted: boolean;
  deaf: boolean;
  relay: RelayStatus;
  peers: VoicePeerDiagnostic[];
}

interface IceResponse {
  iceServers?: RTCIceServer[];
  provider?: 'cloudflare' | 'stun-only';
}

export interface VoiceIceAuth {
  code: string;
  playerId: string;
  token: string;
}

function loadVoiceSession(): VoiceIceAuth | null {
  try {
    const raw = sessionStorage.getItem('mg.session');
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<VoiceIceAuth>;
    if (
      typeof value.code === 'string' &&
      typeof value.playerId === 'string' &&
      typeof value.token === 'string'
    ) {
      return { code: value.code, playerId: value.playerId, token: value.token };
    }
  } catch {
    // Storage can be unavailable in private browsing; STUN remains usable.
  }
  return null;
}

interface RtcSignal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  transceiver: RTCRtpTransceiver;
  remote: MediaStream;
  remoteTrack: MediaStreamTrack | null;
  audio: HTMLAudioElement;
  outputSource: MediaStreamAudioSourceNode | null;
  status: PeerStatus;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: Array<RTCIceCandidateInit | null>;
  operations: Promise<void>;
  restartAttempts: number;
  recoveryTimer: number | null;
  connectTimer: number | null;
  /** A local track exists but the last SDP answer did not permit sending yet. */
  sendNegotiationPending: boolean;
  loudAt: number;
  statsInFlight: boolean;
}

type Listener = (snapshot: VoiceSnapshot) => void;

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record' };
};

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext ?? null;
}

function canReceive(): boolean {
  return typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined';
}

function canSpeak(): boolean {
  return canReceive() && !!navigator.mediaDevices?.getUserMedia;
}

function setAudioSession(type: 'playback' | 'play-and-record'): void {
  try {
    const session = (navigator as NavigatorWithAudioSession).audioSession;
    if (session) session.type = type;
  } catch {
    // Experimental WebKit API: routing still works through the normal element.
  }
}

async function loadIceConfig(
  authenticatedSession: VoiceIceAuth | null,
): Promise<{ iceServers: RTCIceServer[]; provider: RelayStatus }> {
  const session = authenticatedSession ?? loadVoiceSession();
  if (!session) return { iceServers: STUN_ONLY_SERVERS, provider: 'stun-only' };

  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), ICE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/ice', {
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${session.token}`,
        'X-Room-Code': session.code,
        'X-Player-Id': session.playerId,
      },
    });
    if (!response.ok) return { iceServers: STUN_ONLY_SERVERS, provider: 'stun-only' };
    const body = (await response.json()) as IceResponse;
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      return { iceServers: STUN_ONLY_SERVERS, provider: 'stun-only' };
    }
    return {
      iceServers: body.iceServers,
      provider: body.provider === 'cloudflare' ? 'cloudflare' : 'stun-only',
    };
  } catch {
    return { iceServers: STUN_ONLY_SERVERS, provider: 'stun-only' };
  } finally {
    window.clearTimeout(timer);
  }
}

function microphoneConstraints(): MediaStreamConstraints {
  return {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

function isHealthy(peer: Peer): boolean {
  return (
    peer.pc.connectionState === 'connected' ||
    peer.pc.iceConnectionState === 'connected' ||
    peer.pc.iceConnectionState === 'completed'
  );
}

export class Voice {
  private peers = new Map<string, Peer>();
  private wantedPeers = new Set<string>();
  private meshSynced = false;
  /** Candidates can beat both the offer and React's room-effect by one task. */
  private orphanCandidates = new Map<string, Array<RTCIceCandidateInit | null>>();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localLoudAt = 0;
  private levelTimer: number | null = null;
  private listeners = new Set<Listener>();
  private selfId: string | null = null;
  private iceAuth: VoiceIceAuth | null = null;
  private deaf = false;
  private iceServers: RTCIceServer[] = STUN_ONLY_SERVERS;
  private iceReady: Promise<void> | null = null;
  private iceRequest = 0;
  private lifecycleWatched = false;
  private contextWatched = false;
  private wakeContext: (() => void) | null = null;
  private recoveringMic = false;
  /** Invalidates getUserMedia/fetch work that outlives a room. */
  private generation = 0;

  private snapshot: VoiceSnapshot = {
    active: false,
    listening: false,
    deaf: false,
    muted: false,
    error: null,
    relay: 'loading',
    playbackBlocked: false,
    peers: {},
    speaking: [],
  };

  /** Injected by `socket.ts` to avoid a module cycle. */
  send: ((to: string, data: unknown) => void) | null = null;
  announce: ((on: boolean) => void) | null = null;
  announceListening: ((on: boolean) => void) | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceSnapshot => this.snapshot;

  get isActive(): boolean {
    return this.snapshot.active;
  }

  /** Supply membership from the accepted welcome frame; storage is only a reload fallback. */
  setIceAuth(auth: VoiceIceAuth): void {
    const changed =
      this.iceAuth?.code !== auth.code ||
      this.iceAuth.playerId !== auth.playerId ||
      this.iceAuth.token !== auth.token;
    this.iceAuth = auth;
    if (changed) {
      this.iceReady = null;
      this.iceRequest += 1;
    }
  }

  private emit(patch: Partial<VoiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /** Prepare prompt-free receiving after the socket has confirmed membership. */
  prepare(selfId: string): void {
    if (!canReceive()) {
      this.emit({ error: 'unsupported', relay: 'stun-only' });
      return;
    }
    if (this.selfId && this.selfId !== selfId) {
      this.generation += 1;
      this.wantedPeers.clear();
      this.meshSynced = false;
      this.orphanCandidates.clear();
      this.teardownPeers();
      this.iceReady = null;
    }
    this.selfId = selfId;
    this.watchLifecycle();
    this.startLevels();
    void this.ensureIce();
  }

  private ensureIce(force = false): Promise<void> {
    if (force) this.iceReady = null;
    if (!this.iceReady) {
      const generation = this.generation;
      const request = ++this.iceRequest;
      this.emit({ relay: 'loading' });
      this.iceReady = loadIceConfig(this.iceAuth).then(({ iceServers, provider }) => {
        if (generation !== this.generation || request !== this.iceRequest) return;
        this.iceServers = iceServers;
        this.emit({ relay: provider });
        for (const peer of this.peers.values()) {
          try {
            peer.pc.setConfiguration({ iceServers });
          } catch {
            // An active connection can keep using its existing configuration.
          }
        }
      });
    }
    return this.iceReady;
  }

  /** Open the microphone. The caller must invoke this from a real user gesture. */
  async start(selfId: string): Promise<void> {
    if (this.stream) return;
    if (!canSpeak()) {
      this.emit({ error: 'unsupported' });
      return;
    }
    this.prepare(selfId);
    const generation = this.generation;

    // Optional and local-only. Creating it before the permission await keeps the
    // iOS analyser inside the user-activation window; voice itself does not
    // depend on the context succeeding.
    this.ensureOutputContext();
    setAudioSession('play-and-record');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
    } catch (error) {
      const name = (error as DOMException | undefined)?.name;
      setAudioSession('playback');
      this.emit({ error: name === 'NotFoundError' ? 'nodevice' : 'denied' });
      return;
    }

    if (generation !== this.generation || this.selfId !== selfId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.stream = stream;
    this.deaf = false;
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      this.stream = null;
      setAudioSession('playback');
      this.emit({ error: 'nodevice' });
      return;
    }
    this.watchTrack(track);
    this.localAnalyser = this.analyserFor(stream);
    this.watchContext();

    await Promise.all(
      [...this.peers.values()].map((peer) =>
        peer.transceiver.sender
          .replaceTrack(track)
          .then(() => this.ensurePeerCanSend(peer))
          .catch(() => this.beginRecovery(peer, true)),
      ),
    );

    this.emit({ active: true, listening: false, deaf: false, muted: false, error: null });
    this.announce?.(true);
  }

  private watchTrack(track: MediaStreamTrack): void {
    track.addEventListener('ended', () => void this.recoverTrack(), { once: true });
  }

  private async recoverTrack(): Promise<void> {
    if (!this.stream || !this.selfId || this.recoveringMic) return;
    this.recoveringMic = true;
    const generation = this.generation;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
      if (generation !== this.generation || !this.stream) {
        replacement.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = replacement.getAudioTracks()[0];
      if (!track) {
        replacement.getTracks().forEach((item) => item.stop());
        return;
      }
      track.enabled = !this.snapshot.muted;
      this.watchTrack(track);
      const old = this.stream;
      this.stream = replacement;
      this.localAnalyser = this.analyserFor(replacement);
      await Promise.all(
        [...this.peers.values()].map((peer) =>
          peer.transceiver.sender
            .replaceTrack(track)
            .then(() => this.ensurePeerCanSend(peer))
            .catch(() => this.beginRecovery(peer, true)),
        ),
      );
      old.getTracks().forEach((item) => item.stop());
    } catch {
      // Permission/device errors are actionable only when the user explicitly
      // opens the mic. During recovery, retain the visible active state and let
      // the next foreground/online event retry without a misleading toast.
    } finally {
      this.recoveringMic = false;
    }
  }

  /** Close the microphone while preserving every receive path. */
  stopMic(announce = true): void {
    if (announce && this.stream) this.announce?.(false);
    for (const peer of this.peers.values()) {
      peer.sendNegotiationPending = false;
      void peer.transceiver.sender.replaceTrack(null).catch(() => undefined);
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.localAnalyser = null;
    setAudioSession('playback');
    this.emit({ active: false, muted: false });
    this.publishPeers();
  }

  setMuted(muted: boolean): void {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = !muted;
    this.emit({ muted });
  }

  setDeaf(deaf: boolean): void {
    if (this.deaf === deaf) return;
    this.deaf = deaf;
    this.announceListening?.(!deaf);
    if (deaf) {
      this.stopMic();
      this.wantedPeers.clear();
      this.teardownPeers();
    } else {
      // The server echo will immediately establish the new authoritative set;
      // until then an offer from that same echo may legitimately win the race.
      this.meshSynced = false;
    }
    this.emit({ deaf });
  }

  /** Full teardown for leaving the room. */
  stop(): void {
    this.generation += 1;
    this.stopMic(false);
    this.wantedPeers.clear();
    this.meshSynced = false;
    this.orphanCandidates.clear();
    this.teardownPeers();
    this.unwatchContext();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.unwatchLifecycle();
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    this.selfId = null;
    this.iceAuth = null;
    this.iceReady = null;
    this.iceRequest += 1;
    this.iceServers = STUN_ONLY_SERVERS;
    this.emit({
      active: false,
      listening: false,
      muted: false,
      relay: 'loading',
      playbackBlocked: false,
      peers: {},
      speaking: [],
    });
  }

  /** Explicit hard clear; normal transient socket closes deliberately do not call this. */
  clearPeers(): void {
    this.teardownPeers();
  }

  reannounce(): void {
    if (this.stream) this.announce?.(true);
    if (this.deaf) this.announceListening?.(false);
    if ([...this.peers.values()].some((peer) => !isHealthy(peer))) this.retryFailed();
  }

  /** Reconcile against listening players from one authoritative room broadcast. */
  async syncPeers(playerIds: string[]): Promise<void> {
    if (!this.selfId || this.deaf) return;
    this.wantedPeers = new Set(playerIds.filter((id) => id !== this.selfId));
    this.meshSynced = true;
    for (const id of [...this.peers.keys()]) {
      if (!this.wantedPeers.has(id)) this.dropPeer(id);
    }
    if (this.wantedPeers.size === 0) {
      this.publishPeers();
      return;
    }

    const generation = this.generation;
    await this.ensureIce();
    if (generation !== this.generation || !this.selfId || this.deaf) return;
    for (const id of this.wantedPeers) {
      if (!this.peers.has(id)) this.createPeer(id);
    }
  }

  private createPeer(id: string, startInitialOffer = true): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const track = this.stream?.getAudioTracks()[0] ?? null;
    // Keep an outbound stream association even before there is a track. This
    // gives a later replaceTrack the same stable msid without opening a device.
    const init: RTCRtpTransceiverInit = {
      direction: 'sendrecv',
      streams: [this.stream ?? new MediaStream()],
    };
    const transceiver = pc.addTransceiver(track ?? 'audio', init);
    const remote = new MediaStream();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.volume = 1;
    audio.muted = false;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    audio.srcObject = remote;
    document.body.appendChild(audio);

    const peer: Peer = {
      id,
      pc,
      transceiver,
      remote,
      remoteTrack: null,
      audio,
      outputSource: null,
      status: 'connecting',
      polite: !!this.selfId && this.selfId > id,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      operations: Promise.resolve(),
      restartAttempts: 0,
      recoveryTimer: null,
      connectTimer: null,
      sendNegotiationPending: track !== null,
      loudAt: 0,
      statsInFlight: false,
    };
    peer.pendingCandidates.push(...(this.orphanCandidates.get(id) ?? []));
    this.orphanCandidates.delete(id);
    this.peers.set(id, peer);

    pc.onicecandidate = ({ candidate }) => {
      this.send?.(id, { candidate: candidate?.toJSON() ?? null });
    };

    pc.ontrack = ({ track: remoteTrack }) => {
      if (peer.remoteTrack && peer.remoteTrack !== remoteTrack) peer.remote.removeTrack(peer.remoteTrack);
      peer.remoteTrack = remoteTrack;
      if (!peer.remote.getTracks().includes(remoteTrack)) peer.remote.addTrack(remoteTrack);
      this.connectRemoteOutput(peer);
      remoteTrack.onunmute = () => this.attemptPlay(peer);
      remoteTrack.onended = () => {
        if (peer.remoteTrack === remoteTrack) peer.remoteTrack = null;
      };
      this.attemptPlay(peer);
    };

    const checkState = () => this.observePeerState(peer);
    pc.onconnectionstatechange = checkState;
    pc.oniceconnectionstatechange = checkState;

    peer.connectTimer = window.setTimeout(() => {
      peer.connectTimer = null;
      if (!isHealthy(peer)) this.beginRecovery(peer, true);
    }, CONNECT_TIMEOUT_MS);
    this.publishPeers();
    // Room membership is byte-identical at both endpoints, so the id ordering
    // gives initial setup exactly one offerer. Perfect negotiation below still
    // handles the genuinely concurrent case: both sides restarting ICE.
    if (startInitialOffer && this.selfId && this.selfId < id) void this.negotiate(peer);
    return peer;
  }

  private negotiate(peer: Peer): Promise<void> {
    return this.queuePeer(peer, async () => {
      peer.makingOffer = true;
      try {
        await peer.pc.setLocalDescription();
        this.send?.(peer.id, { description: peer.pc.localDescription?.toJSON() });
      } finally {
        peer.makingOffer = false;
      }
    });
  }

  private ensurePeerCanSend(peer: Peer): void {
    if (this.peers.get(peer.id) !== peer || !peer.transceiver.sender.track) {
      peer.sendNegotiationPending = false;
      return;
    }
    const direction = peer.transceiver.currentDirection;
    if (direction === 'sendrecv' || direction === 'sendonly') {
      peer.sendNegotiationPending = false;
      return;
    }
    peer.sendNegotiationPending = true;
    if (peer.pc.signalingState !== 'stable') return;
    // Before the first remote description, null means initial setup is still in
    // flight. Afterwards it means Chrome did not associate our pre-created
    // sender transceiver with the remote m-line; offer it as a second m-line.
    if (direction === null && !peer.pc.remoteDescription) return;
    peer.sendNegotiationPending = false;
    void this.negotiate(peer);
  }

  private queuePeer(peer: Peer, operation: () => Promise<void>): Promise<void> {
    peer.operations = peer.operations
      .then(async () => {
        if (this.peers.get(peer.id) !== peer) return;
        await operation();
      })
      .catch(() => {
        if (this.peers.get(peer.id) === peer) this.beginRecovery(peer, true);
      });
    return peer.operations;
  }

  /** Opaque, untrusted signalling delivered by the room server. */
  async onSignal(from: string, data: unknown): Promise<void> {
    if (!this.selfId || this.deaf) return;
    if (!data || typeof data !== 'object') return;
    const signal = data as RtcSignal;
    if (!('description' in signal) && !('candidate' in signal)) return;
    if (this.meshSynced && !this.wantedPeers.has(from)) return;

    let peer = this.peers.get(from);
    if (!peer) {
      if (!signal.description || signal.description.type !== 'offer') {
        if ('candidate' in signal) {
          const queued = this.orphanCandidates.get(from) ?? [];
          // A normal gather is single digits. The cap keeps an authenticated but
          // misbehaving room member from growing this before the room echo lands.
          if (queued.length < 64) queued.push(signal.candidate ?? null);
          this.orphanCandidates.set(from, queued);
        }
        return;
      }
      await this.ensureIce();
      if (!this.selfId || this.deaf) return;
      // The server only relays within this room. The authoritative room effect
      // will retain or drop it moments later; accepting now closes the
      // broadcast/offer race without letting local state decide peer shape.
      this.wantedPeers.add(from);
      peer = this.peers.get(from) ?? this.createPeer(from, false);
    }

    return this.queuePeer(peer, () => this.applySignal(peer!, signal));
  }

  private async applySignal(peer: Peer, signal: RtcSignal): Promise<void> {
    const pc = peer.pc;
    if (signal.description) {
      const description = signal.description;
      const readyForOffer =
        !peer.makingOffer && (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;

      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      try {
        await pc.setRemoteDescription(description);
      } finally {
        peer.isSettingRemoteAnswerPending = false;
      }
      await this.flushCandidates(peer);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.send?.(peer.id, { description: pc.localDescription?.toJSON() });
      }
      if (peer.sendNegotiationPending) this.ensurePeerCanSend(peer);
      return;
    }

    if ('candidate' in signal) {
      const candidate = signal.candidate ?? null;
      if (!pc.remoteDescription) {
        peer.pendingCandidates.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        if (!peer.ignoreOffer) throw error;
      }
    }
  }

  private async flushCandidates(peer: Peer): Promise<void> {
    const queued = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        if (!peer.ignoreOffer) throw error;
      }
    }
  }

  private observePeerState(peer: Peer): void {
    if (this.peers.get(peer.id) !== peer) return;
    if (isHealthy(peer)) {
      peer.restartAttempts = 0;
      this.clearRecovery(peer);
      if (peer.connectTimer !== null) {
        window.clearTimeout(peer.connectTimer);
        peer.connectTimer = null;
      }
      this.setPeerStatus(peer, 'connected');
      this.attemptPlay(peer);
      return;
    }

    const failed = peer.pc.connectionState === 'failed' || peer.pc.iceConnectionState === 'failed';
    const disconnected =
      peer.pc.connectionState === 'disconnected' || peer.pc.iceConnectionState === 'disconnected';
    if (failed) this.beginRecovery(peer, true);
    else if (disconnected) this.beginRecovery(peer, false);
    else if (peer.pc.connectionState === 'closed' || peer.pc.iceConnectionState === 'closed') {
      this.setPeerStatus(peer, 'failed');
    } else {
      this.setPeerStatus(peer, 'connecting');
    }
  }

  private beginRecovery(peer: Peer, immediate: boolean): void {
    if (this.peers.get(peer.id) !== peer || isHealthy(peer) || peer.recoveryTimer !== null) return;
    if (peer.restartAttempts >= MAX_ICE_RESTARTS) {
      this.setPeerStatus(peer, 'failed');
      return;
    }
    this.setPeerStatus(peer, 'recovering');
    const delay = immediate ? 0 : DISCONNECTED_GRACE_MS;
    peer.recoveryTimer = window.setTimeout(() => {
      peer.recoveryTimer = null;
      if (this.peers.get(peer.id) !== peer || isHealthy(peer)) return;
      peer.restartAttempts += 1;
      void this.ensureIce(this.snapshot.relay !== 'cloudflare').then(() => {
        if (this.peers.get(peer.id) !== peer || isHealthy(peer)) return;
        try {
          peer.pc.setConfiguration({ iceServers: this.iceServers });
          peer.pc.restartIce();
          void this.negotiate(peer);
        } catch {
          // The bounded follow-up below turns this into a visible failure.
        }
        peer.recoveryTimer = window.setTimeout(() => {
          peer.recoveryTimer = null;
          if (!isHealthy(peer)) this.beginRecovery(peer, true);
        }, RECOVERY_CHECK_MS);
      });
    }, delay);
  }

  retryFailed(): void {
    void this.ensureIce(true).then(() => {
      for (const peer of this.peers.values()) {
        if (isHealthy(peer)) continue;
        this.clearRecovery(peer);
        peer.restartAttempts = 0;
        this.beginRecovery(peer, true);
      }
    });
  }

  private clearRecovery(peer: Peer): void {
    if (peer.recoveryTimer !== null) window.clearTimeout(peer.recoveryTimer);
    peer.recoveryTimer = null;
  }

  private dropPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    this.orphanCandidates.delete(id);
    this.clearRecovery(peer);
    if (peer.connectTimer !== null) window.clearTimeout(peer.connectTimer);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.remoteTrack = null;
    peer.outputSource?.disconnect();
    peer.outputSource = null;
    peer.remote.getTracks().forEach((track) => peer.remote.removeTrack(track));
    peer.audio.srcObject = null;
    peer.audio.remove();
    peer.pc.close();
    this.publishPeers();
  }

  private teardownPeers(): void {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
  }

  private attemptPlay(peer: Peer): void {
    if (this.peers.get(peer.id) !== peer) return;
    void peer.audio
      .play()
      .then(() => this.refreshPlaybackBlocked())
      .catch(() => this.emit({ playbackBlocked: true }));
  }

  /**
   * Route remote speech through the same user-activated Web Audio context used
   * by the mic analyser. Mobile WebKit otherwise sometimes switches the audio
   * element to the quiet call receiver as soon as getUserMedia opens.
   */
  private connectRemoteOutput(peer: Peer): void {
    if (!this.ctx || peer.outputSource || peer.remote.getAudioTracks().length === 0) return;
    try {
      const source = this.ctx.createMediaStreamSource(peer.remote);
      source.connect(this.ctx.destination);
      peer.outputSource = source;
      peer.audio.muted = true;
    } catch {
      peer.audio.muted = false;
    }
  }

  /** Only called from a user gesture (`wake` or microphone start). */
  private ensureOutputContext(): void {
    if (!this.ctx) {
      const Ctor = audioContextCtor();
      try {
        this.ctx = Ctor ? new Ctor() : null;
      } catch {
        this.ctx = null;
      }
    }
    if (!this.ctx) return;
    setAudioSession(this.stream ? 'play-and-record' : 'playback');
    this.watchContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    for (const peer of this.peers.values()) this.connectRemoteOutput(peer);
  }

  private refreshPlaybackBlocked(): void {
    const blocked = [...this.peers.values()].some(
      (peer) => !!peer.remoteTrack && !peer.remoteTrack.muted && peer.audio.paused,
    );
    if (blocked !== this.snapshot.playbackBlocked) this.emit({ playbackBlocked: blocked });
  }

  private watchLifecycle(): void {
    if (this.lifecycleWatched) return;
    this.lifecycleWatched = true;
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('pageshow', this.wake);
    window.addEventListener('online', this.wake);
    window.addEventListener('pointerdown', this.wake);
    window.addEventListener('touchend', this.wake);
    window.addEventListener('click', this.wake);
  }

  private unwatchLifecycle(): void {
    if (!this.lifecycleWatched) return;
    this.lifecycleWatched = false;
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('pageshow', this.wake);
    window.removeEventListener('online', this.wake);
    window.removeEventListener('pointerdown', this.wake);
    window.removeEventListener('touchend', this.wake);
    window.removeEventListener('click', this.wake);
  }

  private wake = (): void => {
    if (document.visibilityState === 'hidden') return;
    this.ensureOutputContext();
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    const track = this.stream?.getAudioTracks()[0];
    if (track && (track.readyState === 'ended' || track.muted)) void this.recoverTrack();
    for (const peer of this.peers.values()) {
      if (peer.audio.paused) this.attemptPlay(peer);
      if (!isHealthy(peer)) this.beginRecovery(peer, true);
    }
  };

  private watchContext(): void {
    if (this.contextWatched) return;
    this.contextWatched = true;
    const wake = () => {
      if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    };
    this.wakeContext = wake;
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pointerdown', wake);
  }

  private unwatchContext(): void {
    if (!this.wakeContext) return;
    document.removeEventListener('visibilitychange', this.wakeContext);
    window.removeEventListener('pointerdown', this.wakeContext);
    this.wakeContext = null;
    this.contextWatched = false;
  }

  private analyserFor(stream: MediaStream): AnalyserNode | null {
    if (!this.ctx) return null;
    try {
      const source = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return analyser;
    } catch {
      return null;
    }
  }

  private startLevels(): void {
    if (this.levelTimer !== null) return;
    const buffer = new Float32Array(256);
    const rms = (analyser: AnalyserNode): number => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += buffer[i]! * buffer[i]!;
      return Math.sqrt(sum / buffer.length);
    };

    this.levelTimer = window.setInterval(() => {
      const now = performance.now();
      const speaking: string[] = [];
      if (this.localAnalyser && this.selfId && !this.snapshot.muted) {
        const level = rms(this.localAnalyser);
        if (level > SPEAKING_ON) this.localLoudAt = now;
        if (level > SPEAKING_OFF && now - this.localLoudAt < SPEAKING_HANG_MS) {
          speaking.push(this.selfId);
        }
      }

      for (const peer of this.peers.values()) {
        if (!peer.remoteTrack || peer.remoteTrack.muted) continue;
        if (!peer.statsInFlight) {
          peer.statsInFlight = true;
          void peer.pc
            .getStats(peer.remoteTrack)
            .then((stats) => {
              let best = 0;
              stats.forEach((report) => {
                const item = report as { type?: string; kind?: string; audioLevel?: number };
                if (
                  (item.type === 'inbound-rtp' || item.type === 'media-source') &&
                  (!item.kind || item.kind === 'audio') &&
                  typeof item.audioLevel === 'number'
                ) {
                  best = Math.max(best, item.audioLevel);
                }
              });
              if (best > SPEAKING_ON) peer.loudAt = performance.now();
            })
            .catch(() => undefined)
            .finally(() => {
              peer.statsInFlight = false;
            });
        }
        if (now - peer.loudAt < SPEAKING_HANG_MS) speaking.push(peer.id);
      }

      const previous = this.snapshot.speaking;
      if (speaking.length !== previous.length || speaking.some((id, index) => previous[index] !== id)) {
        this.emit({ speaking });
      }
    }, LEVEL_INTERVAL_MS);
  }

  private setPeerStatus(peer: Peer, status: PeerStatus): void {
    if (peer.status === status) return;
    peer.status = status;
    this.publishPeers();
  }

  private publishPeers(): void {
    const peers: Record<string, PeerStatus> = {};
    for (const [id, peer] of this.peers) peers[id] = peer.status;
    this.emit({
      peers,
      listening: !this.stream && !this.deaf && this.peers.size > 0,
    });
  }

  /** Safe production diagnostics: no SDP, credentials, candidate addresses, or device labels. */
  async diagnostics(): Promise<VoiceDiagnostic> {
    const peers = await Promise.all(
      [...this.peers.values()].map(async (peer): Promise<VoicePeerDiagnostic> => {
        let candidateType: string | null = null;
        let inboundBytes = 0;
        let outboundBytes = 0;
        try {
          const stats = await peer.pc.getStats();
          let selectedPair: { localCandidateId?: string; remoteCandidateId?: string } | null = null;
          stats.forEach((report) => {
            const item = report as {
              type?: string;
              state?: string;
              nominated?: boolean;
              selectedCandidatePairId?: string;
              localCandidateId?: string;
              remoteCandidateId?: string;
              candidateType?: string;
              bytesReceived?: number;
              bytesSent?: number;
            };
            if (item.type === 'inbound-rtp') inboundBytes += Number(item.bytesReceived ?? 0);
            if (item.type === 'outbound-rtp') outboundBytes += Number(item.bytesSent ?? 0);
            if (item.type === 'transport' && item.selectedCandidatePairId) {
              selectedPair = stats.get(item.selectedCandidatePairId) as typeof selectedPair;
            } else if (item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) {
              selectedPair = item;
            }
          });
          if (selectedPair) {
            const pair = selectedPair as { localCandidateId?: string; remoteCandidateId?: string };
            const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : null;
            const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : null;
            const types = [local, remote]
              .map((item) => (item as { candidateType?: string } | undefined)?.candidateType)
              .filter((value): value is string => !!value);
            candidateType = types.includes('relay') ? 'relay' : (types[0] ?? null);
          }
        } catch {
          // Diagnostics must never interfere with media.
        }
        return {
          id: peer.id,
          status: peer.status,
          connectionState: peer.pc.connectionState,
          iceState: peer.pc.iceConnectionState,
          signalingState: peer.pc.signalingState,
          direction: peer.transceiver.direction,
          currentDirection: peer.transceiver.currentDirection,
          localSdpDirection:
            peer.pc.localDescription?.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/)?.[1] ?? null,
          remoteSdpDirection:
            peer.pc.remoteDescription?.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/)?.[1] ?? null,
          senderTrack: peer.transceiver.sender.track?.readyState ?? 'missing',
          candidateType,
          inboundBytes,
          outboundBytes,
          remoteTrack: peer.remoteTrack?.readyState ?? 'missing',
          playbackPaused: peer.audio.paused,
          restarts: peer.restartAttempts,
        };
      }),
    );
    return {
      active: this.snapshot.active,
      muted: this.snapshot.muted,
      deaf: this.snapshot.deaf,
      relay: this.snapshot.relay,
      peers,
    };
  }
}

export const voice = new Voice();

if (typeof window !== 'undefined') {
  (window as unknown as { mgVoiceDiagnostics: () => Promise<VoiceDiagnostic> }).mgVoiceDiagnostics =
    () => voice.diagnostics();
}
