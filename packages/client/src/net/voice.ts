/**
 * Voice chat: a peer-to-peer mesh, signalled over the socket that already exists.
 *
 * No audio ever reaches the server. Each pair of players opens one
 * `RTCPeerConnection` and the media flows directly between them; the server only
 * forwards offers, answers and ICE candidates, and does not read those either.
 *
 * ## Getting through carrier-grade NAT
 *
 * This used to be STUN-only, and STUN is enough for two home routers to find
 * each other and nothing else. A player behind carrier-grade NAT — the norm on
 * Israeli mobile networks, and this game does get played phone-only — has no
 * route a STUN candidate can describe, so those peers connected to nobody while
 * everyone on wifi was fine.
 *
 * The ICE servers now come from the server's `/ice` endpoint, which adds a TURN
 * relay (see `server/src/ice.ts` for which one and why it is free). That
 * endpoint never fails: the worst case is the old STUN-only list plus some
 * free public relays, so this module's fallback is only for the network being
 * down entirely — in which case there is no signalling either.
 *
 * Failure is still per-peer and still has to be *visible*: `peers` carries a
 * status for every other player and the UI reports it. "I can't hear Yoni"
 * should be diagnosable from the screen rather than a mystery. TURN makes that
 * rarer; it does not make it impossible.
 *
 * ## Why a mesh
 *
 * Eight players means seven connections each: about 40 kbps up per peer, so
 * ~300 kbps up at a full room. Fine on wifi, noticeable on cellular, and far
 * simpler than running an SFU for a game whose whole premise is that there is no
 * server state worth keeping.
 *
 * ## Deliberately outside React
 *
 * Like `feed` and `music`. Levels are sampled ten times a second and peers come
 * and go; pushing all of that through component state would re-render the tree
 * for no benefit. Only the parts the UI actually draws — who is connected, who
 * is talking — are mirrored into the store, and only when they change.
 */
/**
 * Only used when `/ice` itself is unreachable. Public STUN, two of them because
 * the first occasionally rate-limits and ICE is happy to use whichever answers.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: [
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/** Voice is optional; do not let a slow config fetch hold the microphone open. */
const ICE_FETCH_TIMEOUT_MS = 4000;

/** How often levels are sampled for the speaking indicator. */
const LEVEL_INTERVAL_MS = 100;
/** RMS above this counts as speech. */
const SPEAKING_ON = 0.045;
/** ...and it has to stay below for this long before the ring goes out again. */
const SPEAKING_OFF = 0.03;
const SPEAKING_HANG_MS = 280;

export type PeerStatus = 'connecting' | 'connected' | 'failed';

export type VoiceError = 'denied' | 'nodevice' | 'unsupported' | null;

export interface VoiceSnapshot {
  /** Our own microphone is open. Not the same as un-muted. */
  active: boolean;
  muted: boolean;
  error: VoiceError;
  /** playerId -> how their connection is doing. */
  peers: Record<string, PeerStatus>;
  /** playerIds currently making noise, including possibly our own. */
  speaking: string[];
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement | null;
  analyser: AnalyserNode | null;
  /** Last time this peer was over the speech threshold. */
  loudAt: number;
  status: PeerStatus;
  /** True if we are the offering side, which decides who re-offers on a restart. */
  weOffer: boolean;
  /**
   * Candidates that arrived before the remote description did.
   *
   * `addIceCandidate` throws if there is no remote description yet, and an
   * offer and its answerer's first candidates genuinely race on a slow link.
   * Buffering costs nothing and the alternative is dropping exactly the
   * candidates a struggling connection most needs.
   */
  pending: RTCIceCandidateInit[];
  /** One ICE restart is allowed per peer before we call it dead. */
  restarted: boolean;
}

type Listener = (snapshot: VoiceSnapshot) => void;

/**
 * Ask the server which ICE servers to use.
 *
 * `/ice` is itself designed never to fail, so reaching the fallback here means
 * the network is down — in which case there is no signalling either and the
 * value hardly matters. It exists so a thrown fetch cannot stop the microphone
 * from opening.
 */
async function loadIceServers(): Promise<RTCIceServer[]> {
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), ICE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/ice', { signal: abort.signal });
    if (!response.ok) return FALLBACK_ICE_SERVERS;
    const body = (await response.json()) as { iceServers?: RTCIceServer[] };
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      return FALLBACK_ICE_SERVERS;
    }
    return body.iceServers;
  } catch {
    return FALLBACK_ICE_SERVERS;
  } finally {
    window.clearTimeout(timer);
  }
}

export function supported(): boolean {
  return (
    !!window.RTCPeerConnection &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(window.AudioContext || (window as any).webkitAudioContext)
  );
}

class Voice {
  private peers = new Map<string, Peer>();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localLoudAt = 0;
  private levelTimer: number | null = null;
  private listeners = new Set<Listener>();
  private snapshot: VoiceSnapshot = {
    active: false,
    muted: false,
    error: null,
    peers: {},
    speaking: [],
  };

  /** Set by `socket` so this module does not have to import it (and cycle). */
  send: ((to: string, data: unknown) => void) | null = null;
  announce: ((on: boolean) => void) | null = null;

  /** Our own id, needed to decide who offers to whom. */
  private selfId: string | null = null;

  /** Fetched once per `start()` and reused for every peer in that session. */
  private iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;

  // -------------------------------------------------------------------------
  // Subscription — a store-shaped surface for `useSyncExternalStore`
  // -------------------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceSnapshot => this.snapshot;

  private emit(patch: Partial<VoiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  get isActive(): boolean {
    return this.snapshot.active;
  }

  // -------------------------------------------------------------------------
  // Turning it on and off
  // -------------------------------------------------------------------------

  /**
   * Open the microphone. Only ever called from a real click — permission
   * prompts that appear on page load get denied out of reflex, and the
   * `AudioContext` needs a gesture anyway.
   */
  async start(selfId: string): Promise<void> {
    if (this.stream) return;
    if (!supported()) {
      this.emit({ error: 'unsupported' });
      return;
    }
    this.selfId = selfId;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // All three on: this is a living room, and half the players will be in
        // the same room as their own speakers at some point.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      const name = (err as DOMException | undefined)?.name;
      this.emit({ error: name === 'NotFoundError' ? 'nodevice' : 'denied' });
      return;
    }

    // After the permission prompt, not before: the prompt is the slow part and
    // there is nothing to connect to until it is answered.
    this.iceServers = await loadIceServers();

    this.localAnalyser = this.analyserFor(this.stream);
    this.startLevels();

    this.emit({ active: true, muted: false, error: null });
    this.announce?.(true);
  }

  /** Close the microphone and every connection. */
  stop(): void {
    this.announce?.(false);
    for (const id of [...this.peers.keys()]) this.dropPeer(id);

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    this.localAnalyser = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;

    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }

    this.emit({ active: false, muted: false, peers: {}, speaking: [] });
  }

  /** Drop all peers without closing the microphone. Used when socket reconnects. */
  clearPeers(): void {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
  }

  /**
   * Mute by disabling the track rather than dropping the stream.
   *
   * The connections stay up, so unmuting is instant instead of a fresh round of
   * ICE — and the other side sees silence rather than a peer disappearing.
   */
  setMuted(muted: boolean): void {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = !muted;
    this.emit({ muted });
  }

  // -------------------------------------------------------------------------
  // Mesh membership
  // -------------------------------------------------------------------------

  /**
   * Reconcile the mesh against who is actually in the room.
   *
   * Called whenever the room view changes. Adds connections for new people,
   * drops them for anyone who left, and does nothing at all when the microphone
   * is closed.
   */
  syncPeers(playerIds: string[]): void {
    if (!this.stream || !this.selfId) return;
    const wanted = new Set(playerIds.filter((id) => id !== this.selfId));

    for (const id of [...this.peers.keys()]) {
      if (!wanted.has(id)) this.dropPeer(id);
    }

    for (const id of wanted) {
      if (this.peers.has(id)) continue;
      // Glare avoidance without perfect negotiation: the lower id offers. Both
      // sides know both ids, so there is no race to resolve and no chance of
      // two simultaneous offers colliding.
      this.createPeer(id, this.selfId < id);
    }
  }

  private createPeer(id: string, weOffer: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = {
      pc,
      audio: null,
      analyser: null,
      loudAt: 0,
      status: 'connecting',
      weOffer,
      pending: [],
      restarted: false,
    };
    this.peers.set(id, peer);
    this.publishPeers();

    if (this.stream) {
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) this.send?.(id, { kind: 'ice', candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (!remote) return;
      
      // Handle repeat ontrack
      const current = this.peers.get(id);
      if (current && current.audio && current.audio.srcObject === remote) return;

      this.attach(id, remote);
    };

    const checkState = () => {
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        this.setPeerStatus(id, 'connected');
        return;
      }
      if (state === 'disconnected' || iceState === 'disconnected') {
        this.setPeerStatus(id, 'connecting');
        return;
      }
      if (state !== 'failed' && state !== 'closed' && iceState !== 'failed' && iceState !== 'closed') return;

      // One restart before giving up. The case this recovers is a relay
      // candidate that gathered after ICE had already run out of pairs to try
      // — common on cellular, where the TURN allocation is the slowest
      // candidate of the lot. A restart re-gathers with everything now known.
      const current = this.peers.get(id);
      const isFailed = state === 'failed' || iceState === 'failed';
      if (isFailed && current && !current.restarted && pc.restartIce) {
        current.restarted = true;
        pc.restartIce();
        // Only the offering side may re-offer; the other end will answer the
        // restart, and two simultaneous offers is the glare this design avoids.
        if (current.weOffer) void this.offer(id, pc);
        return;
      }

      // Genuinely unreachable. The UI has to say so out loud rather than just
      // going quiet — a peer that is silently absent is undiagnosable.
      this.setPeerStatus(id, 'failed');
    };

    pc.onconnectionstatechange = checkState;
    pc.oniceconnectionstatechange = checkState;

    if (weOffer) void this.offer(id, pc);
    return peer;
  }

  private async offer(id: string, pc: RTCPeerConnection): Promise<void> {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send?.(id, { kind: 'offer', sdp: pc.localDescription?.toJSON() });
    } catch {
      this.setPeerStatus(id, 'failed');
    }
  }

  private dropPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    this.peers.delete(id);
    this.publishPeers();
  }

  // -------------------------------------------------------------------------
  // Signalling
  // -------------------------------------------------------------------------

  /**
   * Hand over every candidate that arrived early, now that there is somewhere
   * to put them. Individually — one malformed candidate should not take the
   * rest of the queue with it.
   */
  private async flushCandidates(peer: Peer): Promise<void> {
    const queued = peer.pending;
    peer.pending = [];
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        // Ignore this one and keep going.
      }
    }
  }

  /** A payload relayed from another player. Shape is ours; treat it as untrusted. */
  async onSignal(from: string, data: unknown): Promise<void> {
    if (!this.stream || !this.selfId) return;
    const message = data as { kind?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (!message || typeof message.kind !== 'string') return;

    // An offer can arrive before `syncPeers` has seen the new player — the room
    // broadcast and the offer race. Create the connection on demand, as the
    // answering side, which is what the id comparison would have decided anyway.
    let peer = this.peers.get(from);
    if (!peer) {
      if (message.kind !== 'offer') return;
      peer = this.createPeer(from, false);
    }

    try {
      if (message.kind === 'offer' && message.sdp) {
        const collision = peer.pc.signalingState !== 'stable' || peer.weOffer;
        if (collision) {
          const polite = this.selfId > from;
          if (!polite) return;
          // Polite implies rolling back. In perfect negotiation, a polite peer receiving an offer
          // will rollback automatically via setRemoteDescription on modern browsers.
        }
        await peer.pc.setRemoteDescription(message.sdp);
        await this.flushCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send?.(from, { kind: 'answer', sdp: peer.pc.localDescription?.toJSON() });
      } else if (message.kind === 'answer' && message.sdp) {
        await peer.pc.setRemoteDescription(message.sdp);
        await this.flushCandidates(peer);
      } else if (message.kind === 'ice' && message.candidate) {
        // Hold it rather than dropping it. This used to be an `addIceCandidate`
        // whose throw was swallowed as "routine and recoverable" — routine it
        // is, but the candidate was gone, and on a link slow enough for the
        // race to happen it is the relay candidate you cannot spare.
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate);
        else peer.pending.push(message.candidate);
      }
    } catch {
      // A genuinely broken negotiation shows up as `failed` on the connection
      // state, which is where it gets reported.
    }
  }

  // -------------------------------------------------------------------------
  // Playback and levels
  // -------------------------------------------------------------------------

  private attach(id: string, remote: MediaStream): void {
    const peer = this.peers.get(id);
    if (!peer) return;

    if (!peer.audio) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      // Without this iOS opens the stream full-screen in a video player.
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      document.body.appendChild(audio);
      peer.audio = audio;
    }

    peer.audio.srcObject = remote;
    // iOS refuses playback until a gesture. Voice is always started by a tap, so
    // this rarely fires — but the retry is the same pattern `music.ts` uses, and
    // the failure mode without it is silence nobody can explain.
    const attemptPlay = () => {
      void peer.audio?.play().catch(() => {
        const retry = (): void => {
          window.removeEventListener('pointerdown', retry);
          attemptPlay();
        };
        window.addEventListener('pointerdown', retry, { once: true });
      });
    };
    attemptPlay();
  }

  private analyserFor(stream: MediaStream): AnalyserNode | null {
    if (!this.ctx) return null;
    try {
      const source = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      // Deliberately not connected to the destination: playback is the
      // `<audio>` element's job, and routing it here as well would double it.
      return analyser;
    } catch {
      return null;
    }
  }

  /**
   * Sample everyone's level on an interval — **not** `requestAnimationFrame`,
   * which browsers throttle to a crawl and then suspend outright in a
   * backgrounded tab. Someone alt-tabbed out of the game is exactly the person
   * still talking.
   */
  private startLevels(): void {
    if (this.levelTimer !== null) return;

    const buffer = new Float32Array(256);
    const rms = (analyser: AnalyserNode): number => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i]! * buffer[i]!;
      return Math.sqrt(sum / buffer.length);
    };

    this.levelTimer = window.setInterval(() => {
      const now = performance.now();
      const speaking: string[] = [];

      // Hysteresis both ways: a bare threshold makes the indicator flicker on
      // every syllable gap, which reads as a broken connection rather than as
      // speech.
      if (this.localAnalyser && this.selfId && !this.snapshot.muted) {
        const level = rms(this.localAnalyser);
        if (level > SPEAKING_ON) this.localLoudAt = now;
        if (level > SPEAKING_OFF && now - this.localLoudAt < SPEAKING_HANG_MS) {
          speaking.push(this.selfId);
        }
      }

      for (const [id, peer] of this.peers) {
        let level = 0;
        let hasSyncSource = false;
        const receivers = peer.pc.getReceivers();
        
        for (const receiver of receivers) {
          const sources = receiver.getSynchronizationSources?.() ?? [];
          for (const source of sources) {
            if (source.audioLevel !== undefined) {
              level = Math.max(level, source.audioLevel);
              hasSyncSource = true;
            }
          }
        }
        
        if (hasSyncSource) {
          if (level > SPEAKING_ON) peer.loudAt = now;
        } else {
          // Fallback to getStats for browsers where getSynchronizationSources lacks audioLevel
          peer.pc.getStats().then(stats => {
            let sLevel = 0;
            stats.forEach(report => {
              if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.audioLevel !== undefined) {
                sLevel = Math.max(sLevel, report.audioLevel);
              }
            });
            if (sLevel > SPEAKING_ON) peer.loudAt = performance.now();
          }).catch(() => undefined);
        }

        if (now - peer.loudAt < SPEAKING_HANG_MS) speaking.push(id);
      }

      // Only publish on a change, so the HUD is not re-rendered ten times a
      // second to show the same thing.
      const previous = this.snapshot.speaking;
      if (speaking.length !== previous.length || speaking.some((id, i) => previous[i] !== id)) {
        this.emit({ speaking });
      }
    }, LEVEL_INTERVAL_MS);
  }

  private setPeerStatus(id: string, status: PeerStatus): void {
    const peer = this.peers.get(id);
    if (!peer || peer.status === status) return;
    peer.status = status;
    this.publishPeers();
  }

  private publishPeers(): void {
    const peers: Record<string, PeerStatus> = {};
    for (const [id, peer] of this.peers) peers[id] = peer.status;
    this.emit({ peers });
  }
}

export const voice = new Voice();
