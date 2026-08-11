import { OP_BEGIN, OP_CLEAR, OP_FILL, OP_TO } from '@mg/shared/skribbl';

/** Local mirror used only for immediate Telephone undo/clear feedback. */
export class LocalInkHistory {
  private ops: number[] = [];
  private starts: number[] = [];

  replace(ops: readonly number[]): void {
    this.ops = [...ops];
    this.starts = scanStarts(this.ops);
  }

  append(ops: readonly number[]): void {
    const offset = this.ops.length;
    this.ops.push(...ops);
    for (const start of scanStarts(ops)) this.starts.push(offset + start);
  }

  undo(): number[] {
    const start = this.starts.pop();
    if (start !== undefined) this.ops.length = start;
    return [OP_CLEAR, ...this.ops];
  }

  clear(): number[] {
    this.ops = [];
    this.starts = [];
    return [OP_CLEAR];
  }

  snapshot(): number[] {
    return [...this.ops];
  }
}

function scanStarts(ops: readonly number[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index < ops.length;) {
    const op = ops[index];
    if (op === OP_BEGIN) {
      starts.push(index);
      index += 5;
    } else if (op === OP_FILL) {
      starts.push(index);
      index += 4;
    } else if (op === OP_TO) {
      index += 3;
    } else if (op === OP_CLEAR) {
      starts.length = 0;
      index += 1;
    } else {
      break;
    }
  }
  return starts;
}
