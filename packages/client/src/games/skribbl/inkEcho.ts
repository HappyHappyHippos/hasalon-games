import { OP_BEGIN, OP_CLEAR, OP_FILL, OP_TO } from '@mg/shared/skribbl';

/**
 * The drawer paints ordinary strokes optimistically and must not paint their
 * server echo a second time. Sheet-wide operations are different: clear,
 * undo's clear-plus-replay, and fill are authoritative server responses and
 * must be applied by the drawer as well as every guesser.
 *
 * The stream is flat — opcodes and their operands are the same kind of number —
 * so this has to *walk* it rather than search it. A plain `includes(OP_CLEAR)`
 * reads coordinates as if they were opcodes, and `OP_CLEAR` is 2: a stroke that
 * passes within a few units of the top-left corner would make the drawer
 * re-apply their whole batch and double-draw every stroke in it.
 */
export function shouldApplyInkEcho(ops: readonly number[], isDrawer: boolean): boolean {
  if (!isDrawer) return ops.length > 0;

  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op === OP_CLEAR || op === OP_FILL) return true;
    // Operand counts, so the next opcode is read at the right offset.
    if (op === OP_BEGIN) i += 5;
    else if (op === OP_TO) i += 3;
    // Unknown code: the stream is only self-describing as far as we know the
    // codes, so stop rather than misread the rest as opcodes.
    else return false;
  }
  return false;
}
