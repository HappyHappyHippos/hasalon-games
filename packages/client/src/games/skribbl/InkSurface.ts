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
import { IDENTITY_VIEW, frameView, type StageView } from '../../game/canvasView';
import type { InkRect } from './inkBounds';

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
  private framed = false;

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

  /**
   * Look at part of the sheet instead of all of it.
   *
   * Two callers, wanting the same thing for different reasons: the drawing
   * board zooms in so a finger can place detail it could not otherwise hit, and
   * a preview frames the ink so a finished drawing is not mostly white space.
   * Both are pure view state — nothing here changes what was drawn.
   */
  setView(view: StageView): void {
    this.stage.view = view;
  }

  /**
   * Frame a rectangle of the sheet; `null` goes back to the whole thing.
   *
   * Framing also drops the sheet border, since the edge being shown is a crop
   * and not the edge of the paper.
   */
  frame(rect: InkRect | null): void {
    this.framed = rect !== null;
    this.stage.view = rect ? frameView(rect, CANVAS_WIDTH, CANVAS_HEIGHT) : IDENTITY_VIEW;
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
        const hasX = i + 3 < ops.length && typeof ops[i + 2] === 'number' && typeof ops[i + 3] === 'number';
        const x = hasX ? ops[i + 2]! : Math.floor(CANVAS_WIDTH / 2);
        const y = hasX ? ops[i + 3]! : Math.floor(CANVAS_HEIGHT / 2);
        this.floodFill(color, x, y);
        i += hasX ? 4 : 2;
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
    // Scaled with the view so it stays a hairline when zoomed in, and skipped
    // entirely for a framed preview, where the visible edge is a crop rather
    // than the edge of the paper.
    if (this.framed) return;
    ctx.strokeStyle = 'rgba(20, 17, 15, 0.18)';
    ctx.lineWidth = 2 / this.stage.view.zoom;
    ctx.strokeRect(1, 1, CANVAS_WIDTH - 2, CANVAS_HEIGHT - 2);
  }

  /**
   * Scanline flood fill starting at (startX, startY) with hex color.
   */
  private floodFill(hexColor: string, startX: number, startY: number): void {
    const width = CANVAS_WIDTH;
    const height = CANVAS_HEIGHT;

    const x = Math.max(0, Math.min(width - 1, Math.round(startX)));
    const y = Math.max(0, Math.min(height - 1, Math.round(startY)));

    const imgData = this.ink.getImageData(0, 0, width, height);
    const data32 = new Uint32Array(imgData.data.buffer);

    const startIdx = y * width + x;
    const targetColor32 = data32[startIdx]!;

    const fillBuf = new ArrayBuffer(4);
    const fill8 = new Uint8ClampedArray(fillBuf);
    fill8[0] = parseInt(hexColor.slice(1, 3), 16) || 0;
    fill8[1] = parseInt(hexColor.slice(3, 5), 16) || 0;
    fill8[2] = parseInt(hexColor.slice(5, 7), 16) || 0;
    fill8[3] = 255;
    const fillColor32 = new Uint32Array(fillBuf)[0]!;

    if (targetColor32 === fillColor32) return;

    const stack: number[] = [x, y];

    while (stack.length > 0) {
      const cy = stack.pop()!;
      let cx = stack.pop()!;

      let idx = cy * width + cx;
      while (cx >= 0 && data32[idx] === targetColor32) {
        cx--;
        idx--;
      }
      cx++;
      idx++;

      let spanAbove = false;
      let spanBelow = false;

      while (cx < width && data32[idx] === targetColor32) {
        data32[idx] = fillColor32;

        if (cy > 0) {
          const aboveIdx = idx - width;
          const matchAbove = data32[aboveIdx] === targetColor32;
          if (!spanAbove && matchAbove) {
            stack.push(cx, cy - 1);
            spanAbove = true;
          } else if (spanAbove && !matchAbove) {
            spanAbove = false;
          }
        }

        if (cy < height - 1) {
          const belowIdx = idx + width;
          const matchBelow = data32[belowIdx] === targetColor32;
          if (!spanBelow && matchBelow) {
            stack.push(cx, cy + 1);
            spanBelow = true;
          } else if (spanBelow && !matchBelow) {
            spanBelow = false;
          }
        }

        cx++;
        idx++;
      }
    }

    this.ink.putImageData(imgData, 0, 0);
  }
}
