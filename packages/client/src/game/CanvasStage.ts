import { IDENTITY_VIEW, type StageView } from './canvasView';

/**
 * Canvas plumbing shared by every game: device pixel ratio, resizing, and the
 * transform that letterboxes a fixed logical arena into whatever shape the
 * window happens to be. Games draw in arena units and ignore all of this.
 */
export class CanvasStage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  readonly arenaWidth: number;
  readonly arenaHeight: number;

  private observer: ResizeObserver | null = null;
  private dpr = 1;

  /**
   * How far in the stage is looking, and at what.
   *
   * The default is the identity view, which is the letterbox every game has
   * always had — `begin` computes exactly the same numbers at `zoom: 1` as it
   * did before this existed, so a game that never touches it cannot tell the
   * difference. Only the drawing board uses it, to zoom in for fine detail and
   * to crop a finished drawing to the ink in it.
   */
  view: StageView = IDENTITY_VIEW;

  /** Set by `begin`, so input handlers can map screen points back to the arena. */
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  constructor(canvas: HTMLCanvasElement, arenaWidth: number, arenaHeight: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
    this.arenaWidth = arenaWidth;
    this.arenaHeight = arenaHeight;
  }

  attach(): void {
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // Capping at 2 keeps very high-DPI phones from rendering four times the
    // pixels for no visible gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * this.dpr));
    const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /**
   * Clear, paint the letterbox bars, and leave the context transformed so that
   * (0,0)–(arenaWidth,arenaHeight) fills the visible arena.
   */
  begin(letterbox: string): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = letterbox;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const fit = Math.min(canvas.width / this.arenaWidth, canvas.height / this.arenaHeight);
    this.scale = fit * this.view.zoom;
    // Put the arena point the view is centred on in the middle of the canvas.
    // At the identity view that is the arena's own centre, which reduces to the
    // plain letterbox: `(canvas.width - arenaWidth * scale) / 2`.
    const centreX = this.arenaWidth / 2 + this.view.panX;
    const centreY = this.arenaHeight / 2 + this.view.panY;
    this.offsetX = canvas.width / 2 - centreX * this.scale;
    this.offsetY = canvas.height / 2 - centreY * this.scale;

    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
  }

  /**
   * Arena units per **CSS** pixel, for input that works in client coordinates.
   *
   * Not `scale`, which is per device pixel, and not `window.devicePixelRatio`
   * either: `resize` caps the ratio at 2, so on a 3x phone the two disagree and
   * anything converting a finger's travel into arena units with the raw ratio
   * moves half again too far.
   */
  get cssScale(): number {
    return this.scale / this.dpr;
  }

  /**
   * The world rectangle the letterbox is currently revealing, in arena units.
   *
   * At exactly the arena's aspect ratio this is the arena. At any other ratio
   * it is larger on one axis — the letterbox bars are world the player can
   * reach but the stage does not cover. Only meaningful after `begin`.
   */
  visibleRect(): { x0: number; y0: number; x1: number; y1: number } {
    const { canvas } = this;
    return {
      x0: -this.offsetX / this.scale,
      y0: -this.offsetY / this.scale,
      x1: (canvas.width - this.offsetX) / this.scale,
      y1: (canvas.height - this.offsetY) / this.scale,
    };
  }

  /** Screen coordinates (relative to the canvas) to arena units. */
  toArena(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * this.dpr;
    const py = (clientY - rect.top) * this.dpr;
    return {
      x: (px - this.offsetX) / this.scale,
      y: (py - this.offsetY) / this.scale,
    };
  }
}
