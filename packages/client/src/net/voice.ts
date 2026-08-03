/**
 * Voice chat: a peer-to-peer mesh, signalled over the socket that already exists.
 *
 * No audio ever reaches the server. Each pair of players opens one
 * `RTCPeerConnection` and the media flows directly between them; the server only
 * forwards offers, answers and ICE candidates, and does not read those either.
 *
 * ## Getting through carrier-grade NAT
 *
 * STUN alone is enough for two home routers to find each other and nothing
 * else. A player behind carrier-grade NAT — the norm on Israeli mobile
 * networks, and this game does get played phone-only — has no route a STUN
 * candidate can describe, so those peers connect to nobody while everyone on
 * wifi is fine.
 *
 * The ICE servers come from the server's `/ice` endpoint, which adds a TURN
 * relay (see `server/src/ice.ts` for which one and why it is free). That
 * endpoint never fails, so `FALLBACK_ICE_SERVERS` below is only for the network
 * being down entirely — in which case there is no signalling either.
 *
 * ## Two phones is the case that breaks
 *
 * Everything here that looks over-careful is because a desktop is forgiving and
 * two phones are not. Three separate bugs each produced "connected, but silence"
 * between an iPhone and an Android while iPhone-to-laptop worked: building the
 * mesh from room membership rather than who has a mic open (see `useVoice.ts`),
 * putting a *remote* stream through an `AudioContext` (which mutes the audio
 * element on WebKit — see `startLevels`), and creating that context outside the
 * user gesture so iOS left it suspended.
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
 * Only used when `/ice` itself is unreachable.
 *
 * Public STUN — two, because the first occasionally rate-limits and ICE will use
 * whichever answers — plus the Open Relay Project's free TURN servers on
 * TCP/TLS 443. The relay entries matter: without them a client whose `/ice`
 * fetch times out (plausible on a phone right after the mic prompt) silently
 * drops to STUN-only, which is the configuration that cannot cross CGNAT.
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
  /** In the mesh with no microphone — receiving only. Never true while `active`. */
  listening: boolean;
  /** Opted out of auto-listen entirely: no peers, no audio. */
  deaf: boolean;
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
  /** Last time this peer was over the speech threshold. */
  loudAt: number;
  status: PeerStatus;
  /** True if we are the offering side, which decides who re-offers on a restart. */
  weOffer: boolean;
  /** Whether this connection was built with a local track. Baked into the SDP. */
  weSend: boolean;
  /**
   * An offer of ours is out and unanswered.
   *
   * Distinct from `weOffer`, which is a permanent role. This is the transient
   * fact that decides whether an incoming offer is a collision — keying glare
   * detection on the role instead made every later offer look like one.
   */
  offerPending: boolean;
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
  /** Guards the `getStats` level fallback against overlapping calls. */
  statsInFlight: boolean;
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

/** The prefixed constructor is still the only one on older WebKit. */
type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext ?? null;
}

function canReceive(): boolean {
  return typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined';
}

function canSpeak(): boolean {
  return (
    canReceive() &&
    !!navigator.mediaDevices?.getUserMedia &&
    audioContextCtor() !== null
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
    listening: false,
    deaf: false,
    muted: false,
    error: null,
    peers: {},
    speaking: [],
  };

  /** Set by `socket` so this module does not have to import it (and cycle). */
  send: ((to: string, data: unknown) => void) | null = null;
  announce: ((on: boolean) => void) | null = null;
  announceListening: ((on: boolean) => void) | null = null;

  /** Our own id, needed to decide who offers to whom. */
  private selfId: string | null = null;

  /** The user has opted out of auto-listen. Mirrors `!listening` on the wire. */
  private deaf = false;

  /** Fetched once per room session and reused for every peer. */
  private iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;
  /** Deduped `/ice` fetch, shared by the listener and speaker paths. */
  private iceReady: Promise<void> | null = null;

  /** Listeners that nudge a suspended `AudioContext` back awake. */
  private contextWatched = false;
  private wakeContext: (() => void) | null = null;

  /**
   * Listener that checks the mic and every peer when the tab comes back to
   * the foreground.
   *
   * Android can suspend mic capture on a backgrounded tab with no error and no
   * state change anywhere WebRTC exposes — `RTCPeerConnection.connectionState`
   * stays `'connected'`, so nothing here notices on its own. This is the
   * catch-all: on return to visibility, re-check the local track and every
   * peer's actual connection state rather than trusting either.
   */
  private wakeLiveness: (() => void) | null = null;
  /** True once a re-acquire is in flight, so a second visibility event can't stack another. */
  private recovering = false;

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

  /** Join the receive-only mesh without opening a device or an AudioContext. */
  prepare(selfId: string): void {
    if (!canReceive()) return;
    this.selfId = selfId;
    this.watchLiveness();
    this.startLevels();
    void this.ensureIce();
  }

  private ensureIce(): Promise<void> {
    if (!this.iceReady) {
      this.iceReady = loadIceServers().then((servers) => {
        this.iceServers = servers;
      });
    }
    return this.iceReady;
  }

  /**
   * Open the microphone. Only ever called from a real click — permission
   * prompts that appear on page load get denied out of reflex, and the
   * `AudioContext` needs a gesture anyway.
   */
  async start(selfId: string): Promise<void> {
    if (this.stream) return;
    if (!canSpeak()) {
      this.emit({ error: 'unsupported' });
      return;
    }
    this.selfId = selfId;

    // Built here, synchronously, *before* the first `await` — this is still
    // inside the click that called us, and on iOS a context created after the
    // gesture window closes starts suspended and stays that way. A suspended
    // context makes the analyser read pure zeroes, so your own speaking ring
    // never lights up and it looks exactly like a dead microphone.
    const Ctor = audioContextCtor();
    try {
      this.ctx = Ctor ? new Ctor() : null;
    } catch {
      // Some browsers cap the number of live contexts. Levels are a nicety;
      // losing them must not stop the call.
      this.ctx = null;
    }

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
      void this.ctx?.close().catch(() => undefined);
      this.ctx = null;
      return;
    }

    // After the permission prompt, not before: the prompt is the slow part and
    // there is nothing to connect to until it is answered.
    await this.ensureIce();

    this.localAnalyser = this.analyserFor(this.stream);
    this.startLevels();
    this.watchContext();
    this.watchLiveness();
    const localTrack = this.stream.getAudioTracks()[0];
    if (localTrack) this.watchTrack(localTrack);

    this.deaf = false;
    this.emit({ active: true, listening: false, deaf: false, muted: false, error: null });
    this.announce?.(true);
  }

  /**
   * Notice a local mic track that has actually stopped and re-acquire it.
   *
   * `ended` is unambiguous — the track is gone and nothing will bring it back
   * on its own. `mute`/`unmute` fire when the underlying source stops or
   * resumes *without* the track ending (a common OS-level response to
   * backgrounding), so they're left to the visibility check instead of
   * reacting here — reacquiring on every transient mute would tear down and
   * rebuild the mic far more often than the actual failures warrant.
   */
  private watchTrack(track: MediaStreamTrack): void {
    track.addEventListener('ended', () => void this.recoverTrack(), { once: true });
  }

  /**
   * Re-open the microphone and hand the new track to every existing peer via
   * `replaceTrack`, rather than tearing the connections down. A peer's audio
   * transceiver survives a track swap with no renegotiation needed.
   */
  private async recoverTrack(): Promise<void> {
    if (!this.stream || !this.selfId || this.recovering) return;
    this.recovering = true;
    try {
      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        // Best-effort. If the mic won't reopen there is nothing else to try;
        // the peer status readouts already show every connection as it is.
        return;
      }
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = !this.snapshot.muted;
      this.watchTrack(newTrack);

      const oldStream = this.stream;
      this.stream = newStream;
      this.localAnalyser = this.analyserFor(newStream);

      for (const peer of this.peers.values()) {
        const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (sender) void sender.replaceTrack(newTrack).catch(() => undefined);
      }

      oldStream.getTracks().forEach((t) => t.stop());
    } finally {
      this.recovering = false;
    }
  }

  /** Same role decision `syncPeers` uses, so a recreate can't disagree with a fresh connection. */
  private recreatePeer(id: string): void {
    if (!this.selfId) return;
    const weOffer = this.selfId < id;
    this.dropPeer(id);
    this.createPeer(id, weOffer);
  }

  private watchLiveness(): void {
    if (this.wakeLiveness) return;
    const check = (): void => {
      if (document.visibilityState !== 'visible') return;

      const track = this.stream?.getAudioTracks()[0];
      if (track && (track.readyState === 'ended' || track.muted)) void this.recoverTrack();

      for (const [id, peer] of this.peers) {
        if (peer.audio?.paused) void peer.audio.play().catch(() => undefined);
        const state = peer.pc.connectionState;
        const iceState = peer.pc.iceConnectionState;
        const healthy = state === 'connected' || iceState === 'connected' || iceState === 'completed';
        if (!healthy) this.recreatePeer(id);
      }
    };
    this.wakeLiveness = check;
    document.addEventListener('visibilitychange', check);
  }

  private unwatchLiveness(): void {
    if (!this.wakeLiveness) return;
    document.removeEventListener('visibilitychange', this.wakeLiveness);
    this.wakeLiveness = null;
  }

  /**
   * Keep the level-metering context awake.
   *
   * iOS suspends an `AudioContext` on backgrounding, on an incoming call, and
   * sometimes on nothing much at all — and a suspended context silently reports
   * zero level forever, so the speaking rings just stop. Nudging it on the next
   * gesture or foreground is the whole remedy.
   */
  private watchContext(): void {
    if (this.contextWatched) return;
    this.contextWatched = true;

    const wake = (): void => {
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

  /**
   * Close the microphone but stay in the mesh, still hearing everyone.
   *
   * The peers are left alone: the broadcast that follows makes both ends
   * re-evaluate the pair, dropping the ones that no longer carry anything and
   * rebuilding ours as receive-only.
   */
  stopMic(announce = true): void {
    // Starting the app with no room also performs a defensive full teardown.
    // Announcing an already-closed microphone there queued `voice:false`, which
    // the server correctly rejected as NOT_IN_ROOM and showed as a red toast.
    if (announce && this.stream) this.announce?.(false);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.localAnalyser = null;
    this.unwatchContext();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.emit({ active: false, muted: false });
  }

  /** Opt out of hearing the room as well. The only way to have no connections. */
  setDeaf(deaf: boolean): void {
    this.deaf = deaf;
    this.announceListening?.(!deaf);
    if (deaf) {
      this.stopMic();
      for (const id of [...this.peers.keys()]) this.dropPeer(id);
    }
    this.emit({ deaf });
  }

  /** Full teardown — leaving the room, or the socket going for good. */
  stop(): void {
    // Leaving removes the player record, so a flag announcement is redundant;
    // if it follows the leave frame it is also necessarily NOT_IN_ROOM.
    this.stopMic(false);
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.unwatchLiveness();

    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }

    this.selfId = null;
    this.iceReady = null;
    this.iceServers = FALLBACK_ICE_SERVERS;
    this.emit({ active: false, listening: false, muted: false, peers: {}, speaking: [] });
  }

  /** Drop all peers without closing the microphone. Used when socket reconnects. */
  clearPeers(): void {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
  }

  /**
   * Tell the room our microphone is open, again.
   *
   * Idempotent on the server (`Room.setVoice` returns early when unchanged), so
   * this is safe to call on every reconnect — which is the point, because a
   * rejoin after the disconnect grace expires creates a fresh player record with
   * the flag cleared.
   */
  reannounce(): void {
    if (this.stream) this.announce?.(true);
    if (this.deaf) this.announceListening?.(false);
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
   * drops them for anyone who left, and rebuilds when our SDP direction changed.
   */
  async syncPeers(playerIds: string[]): Promise<void> {
    // No longer gated on the microphone: a listener has no stream and still
    // belongs in the mesh. `selfId` is set by `prepare` as well as `start`.
    if (!this.selfId) return;
    const wanted = new Set(playerIds.filter((id) => id !== this.selfId));

    for (const [id, peer] of [...this.peers]) {
      if (!wanted.has(id)) {
        this.dropPeer(id);
        continue;
      }
      // A connection's direction is baked into its SDP, and only the designated
      // offerer may re-offer — so a pair whose roles changed cannot be adjusted,
      // it has to be rebuilt. Both ends learn of the change from the same
      // broadcast, so exactly one of them offers again.
      if (peer.weSend !== (this.stream !== null)) this.recreatePeer(id);
    }

    if (wanted.size === 0) return;
    await this.ensureIce();
    for (const id of wanted) {
      if (this.peers.has(id)) continue;
      this.createPeer(id, this.selfId < id);
    }
  }

  private createPeer(id: string, weOffer: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = {
      pc,
      audio: null,
      loudAt: 0,
      status: 'connecting',
      weOffer,
      weSend: this.stream !== null,
      offerPending: false,
      pending: [],
      restarted: false,
      statsInFlight: false,
    };
    this.peers.set(id, peer);
    this.publishPeers();

    if (this.stream) {
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    } else {
      // Listening without a microphone. A connection with no senders offers
      // zero m-lines, so the answerer would have nowhere to attach its track.
      pc.addTransceiver('audio', { direction: 'recvonly' });
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
    const peer = this.peers.get(id);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Set only once the offer is really out. Marking it earlier would make a
      // failed `createOffer` look like an outstanding negotiation forever.
      if (peer) peer.offerPending = true;
      this.send?.(id, { kind: 'offer', sdp: pc.localDescription?.toJSON() });
    } catch {
      if (peer) peer.offerPending = false;
      this.setPeerStatus(id, 'failed');
    }
  }

  private dropPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    // Cleared alongside `onconnectionstatechange` — without this, `checkState`
    // could still fire on a closed connection for a peer that no longer exists.
    peer.pc.oniceconnectionstatechange = null;
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
    if (!this.selfId || this.deaf) return;
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
        // Glare: an offer arriving while one of ours is still outstanding.
        //
        // The test is `offerPending`, not `weOffer`. `weOffer` is a *permanent
        // role* assigned at creation, so keying on it treated every incoming
        // offer as a collision for the life of the connection — including a
        // legitimate re-offer on a long-stable peer, which was then dropped in
        // silence.
        //
        // Polite/impolite is settled by the same id comparison that picked the
        // offerer, so the two can never disagree: the impolite side ignores the
        // colliding offer and its own will land; the polite side rolls its
        // offer back and answers.
        const glare = peer.offerPending || peer.pc.signalingState === 'have-local-offer';
        if (glare) {
          const polite = this.selfId > from;
          if (!polite) return;
          // Explicit, not assumed. Chrome and Safari both accept an implicit
          // rollback inside `setRemoteDescription`, but Firefox has historically
          // not, and a silent throw here means one player hears nobody.
          try {
            await peer.pc.setLocalDescription({ type: 'rollback' });
          } catch {
            // Already stable, or unsupported. `setRemoteDescription` below is
            // the thing that actually has to work.
          }
          peer.offerPending = false;
        }
        await peer.pc.setRemoteDescription(message.sdp);
        await this.flushCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send?.(from, { kind: 'answer', sdp: peer.pc.localDescription?.toJSON() });
      } else if (message.kind === 'answer' && message.sdp) {
        await peer.pc.setRemoteDescription(message.sdp);
        peer.offerPending = false;
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
    const attemptPlay = (): void => {
      // A peer dropped while a retry was armed must not keep re-arming — that
      // listener holds the closure, and with it the whole `RTCPeerConnection`.
      if (this.peers.get(id) !== peer) return;
      void peer.audio?.play().catch(() => {
        const retry = (): void => {
          window.removeEventListener('pointerdown', retry);
          window.removeEventListener('touchend', retry);
          window.removeEventListener('click', retry);
          attemptPlay();
        };
        // `touchend`/`click` as well as `pointerdown`: iOS grants media
        // activation on the former, never the latter.
        window.addEventListener('pointerdown', retry, { once: true });
        window.addEventListener('touchend', retry, { once: true });
        window.addEventListener('click', retry, { once: true });
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
        // Levels come from the receiver, never from a Web Audio node built on
        // the remote stream. Routing a remote WebRTC track through an
        // `AudioContext` silences the `<audio>` element playing it on WebKit,
        // which is why voice worked to a desktop and not between two phones.
        let level = 0;
        let sampled = false;
        for (const receiver of peer.pc.getReceivers()) {
          for (const source of receiver.getSynchronizationSources?.() ?? []) {
            if (source.audioLevel === undefined) continue;
            level = Math.max(level, source.audioLevel);
            sampled = true;
          }
        }

        if (sampled) {
          // Same hysteresis as the local path: `SPEAKING_ON` to light up,
          // `SPEAKING_OFF` plus the hang time to go out, so the ring does not
          // flicker on every gap between syllables.
          if (level > SPEAKING_ON) peer.loudAt = now;
          if (level > SPEAKING_OFF && now - peer.loudAt < SPEAKING_HANG_MS) speaking.push(id);
        } else {
          // Firefox and Safari do not fill in `audioLevel` here, so fall back to
          // `getStats`. It is async, so it updates `loudAt` for the *next* pass
          // rather than this one — and one flight at a time, because kicking off
          // a fresh promise per peer per 100 ms was ~70 a second in a full room.
          if (!peer.statsInFlight) {
            peer.statsInFlight = true;
            void peer.pc
              .getStats()
              .then((stats) => {
                let best = 0;
                stats.forEach((report) => {
                  const r = report as { type?: string; kind?: string; audioLevel?: number };
                  if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.audioLevel !== undefined) {
                    best = Math.max(best, r.audioLevel);
                  }
                });
                if (best > SPEAKING_ON) peer.loudAt = performance.now();
              })
              .catch(() => undefined)
              .finally(() => {
                peer.statsInFlight = false;
              });
          }
          if (now - peer.loudAt < SPEAKING_HANG_MS) speaking.push(id);
        }
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
    this.emit({ peers, listening: !this.stream && this.peers.size > 0 });
  }
}

export const voice = new Voice();
