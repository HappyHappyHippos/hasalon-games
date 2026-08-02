/**
 * Voice chat: a peer-to-peer mesh, signalled over the socket that already exists.
 *
 * No audio ever reaches the server. Each pair of players opens one
 * `RTCPeerConnection` and the media flows directly between them; the server only
 * forwards offers, answers and ICE candidates, and does not read those either.
 *
 * ## STUN only, and what that costs
 *
 * The ICE config below is public STUN and nothing else. That is enough for two
 * home routers to find each other, which is the common case, and it costs
 * nothing to run. It is **not** enough for a player behind carrier-grade NAT —
 * which is the norm on Israeli mobile networks, and this game does get played
 * phone-only. Those peers will fail to connect while everyone else is fine.
 *
 * So failure is per-peer and has to be *visible*: `peerStates` carries a status
 * for every other player and the UI reports it. "I can't hear Yoni" should be
 * diagnosable from the screen rather than a mystery. Adding a TURN relay later
 * is a change to `ICE_SERVERS` plus credentials — none of the mesh logic below
 * moves.
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
 * Public STUN. Two of them because the first occasionally rate-limits, and ICE
 * gathering is happy to use whichever answers.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

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
}

type Listener = (snapshot: VoiceSnapshot) => void;

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof RTCPeerConnection !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
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

    this.ctx = new AudioContext();
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
    this.announce?.(!muted);
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, audio: null, analyser: null, loudAt: 0, status: 'connecting' };
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
      this.attach(id, remote);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') this.setPeerStatus(id, 'connected');
      // `failed` is the STUN-only outcome behind a symmetric NAT, and it is the
      // one the UI has to say out loud rather than just going quiet.
      else if (state === 'failed' || state === 'closed') this.setPeerStatus(id, 'failed');
      else if (state === 'disconnected') this.setPeerStatus(id, 'connecting');
    };

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
        await peer.pc.setRemoteDescription(message.sdp);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send?.(from, { kind: 'answer', sdp: peer.pc.localDescription?.toJSON() });
      } else if (message.kind === 'answer' && message.sdp) {
        await peer.pc.setRemoteDescription(message.sdp);
      } else if (message.kind === 'ice' && message.candidate) {
        await peer.pc.addIceCandidate(message.candidate);
      }
    } catch {
      // A candidate arriving before the remote description is routine and
      // recoverable; a genuinely broken negotiation shows up as `failed` on the
      // connection state, which is where it gets reported.
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
    void peer.audio.play().catch(() => {
      const retry = (): void => {
        window.removeEventListener('pointerdown', retry);
        void peer.audio?.play().catch(() => undefined);
      };
      window.addEventListener('pointerdown', retry, { once: true });
    });

    peer.analyser = this.analyserFor(remote);
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
        if (!peer.analyser) continue;
        const level = rms(peer.analyser);
        if (level > SPEAKING_ON) peer.loudAt = now;
        if (level > SPEAKING_OFF && now - peer.loudAt < SPEAKING_HANG_MS) speaking.push(id);
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
