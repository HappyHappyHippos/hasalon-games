import {
  BRUSH_SIZES,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  INK_COLORS,
  OP_BEGIN,
  OP_CLEAR,
  OP_FILL,
  OP_TO,
} from '@mg/shared/skribbl';
import { CanvasStage } from '../../game/CanvasStage';

/**
 * The drawing, and the canvas it lives on.
 *
 * Two surfaces, and the split is the whole design:
 *
 * - an **offscreen** canvas that accumulates ink and is never cleared, and
 * - the visible one, which `CanvasStage.begin()` wipes every single frame.
 *
 * Ink has to survive that wipe, and it cannot be replayed from the snapshot
 * feed either — `SnapshotFeed` keeps one second of history and drops everything
 * older (`HISTORY_MS`), so a drawing two seconds old would simply be gone. So
 * ops are applied to the offscreen surface as they arrive and the visible
 * canvas is a `drawImage` of it. Achtung makes exactly this bargain with its
 * baked trail.
 *
 * Nothing here interpolates or renders in the past. Ink is discrete and
 * permanent: the right moment to draw a stroke is the moment it arrives.
 */
export class InkSurface {
  private stage: CanvasStage;
  private buffer: HTMLCanvasElement;
  private ink: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;

  /** Where the stroke in progress last was, in canvas units. */
  private penX = 0;
  private penY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new CanvasStage(canvas, CANVAS_WIDTH, CANVAS_HEIGHT);

    this.buffer = document.createElement('canvas');
    this.buffer.width = CANVAS_WIDTH;
    this.buffer.height = CANVAS_HEIGHT;
    const ctx = this.buffer.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the ink buffer');
    this.ink = ctx;
    this.ink.lineCap = 'round';
    this.ink.lineJoin = 'round';
    this.clear();
  }

  get canvasStage(): CanvasStage {
    return this.stage;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stage.attach();
    const frame = (): void => {
      if (!this.running) return;
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stage.detach();
  }

  clear(): void {
    this.ink.fillStyle = '#ffffff';
    this.ink.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  /**
   * Apply a run of ops from a snapshot, or from our own hand.
   *
   * The local drawer applies their own strokes here immediately rather than
   * waiting for them to come back off the wire — a round trip of latency
   * between moving a finger and seeing a line is the difference between a
   * drawing tool and a fax machine.
   */
  apply(ops: readonly number[]): void {
    let i = 0;
    while (i < ops.length) {
      const op = ops[i]!;
      if (op === OP_CLEAR) {
        this.clear();
        i += 1;
      } else if (op === OP_FILL) {
        const color = INK_COLORS[ops[i + 1]!] ?? INK_COLORS[0]!;
        this.ink.fillStyle = color;
        this.ink.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        i += 2;
      } else if (op === OP_BEGIN) {
        const color = INK_COLORS[ops[i + 1]!] ?? INK_COLORS[0]!;
        const size = BRUSH_SIZES[ops[i + 2]!] ?? BRUSH_SIZES[1]!;
        this.penX = ops[i + 3]!;
        this.penY = ops[i + 4]!;
        this.ink.strokeStyle = color;
        this.ink.fillStyle = color;
        this.ink.lineWidth = size;
        // A dot, so a tap leaves a mark rather than nothing at all.
        this.ink.beginPath();
        this.ink.arc(this.penX, this.penY, size / 2, 0, Math.PI * 2);
        this.ink.fill();
        i += 5;
      } else if (op === OP_TO) {
        const x = ops[i + 1]!;
        const y = ops[i + 2]!;
        this.ink.beginPath();
        this.ink.moveTo(this.penX, this.penY);
        this.ink.lineTo(x, y);
        this.ink.stroke();
        this.penX = x;
        this.penY = y;
        i += 3;
      } else {
        // Unknown op: the stream is self-describing only as far as we know the
        // codes, so the safe move is to stop rather than misread the rest.
        return;
      }
    }
  }

  /** Screen coordinates to canvas units, for the drawing input. */
  toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    return this.stage.toArena(clientX, clientY);
  }

  private draw(): void {
    // The paper colour is the letterbox too, so the drawing area and the space
    // around it read as one sheet rather than a picture pinned to a wall.
    this.stage.begin('#fffdf7');
    const ctx = this.stage.ctx;
    ctx.drawImage(this.buffer, 0, 0);

    // A hairline border, so the edge of the drawable area is obvious — on a
    // white-on-white surface it is otherwise invisible until you run off it.
    ctx.strokeStyle = 'rgba(20, 17, 15, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CANVAS_WIDTH - 2, CANVAS_HEIGHT - 2);
  }
}
