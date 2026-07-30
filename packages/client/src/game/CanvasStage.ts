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

    this.scale = Math.min(canvas.width / this.arenaWidth, canvas.height / this.arenaHeight);
    this.offsetX = (canvas.width - this.arenaWidth * this.scale) / 2;
    this.offsetY = (canvas.height - this.arenaHeight * this.scale) / 2;

    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
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
