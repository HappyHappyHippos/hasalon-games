import { OP_CLEAR, OP_FILL } from '@mg/shared/skribbl';

/**
 * The drawer paints ordinary strokes optimistically and must not paint their
 * server echo a second time. Sheet-wide operations are different: clear,
 * undo's clear-plus-replay, and fill are authoritative server responses and
 * must be applied by the drawer as well as every guesser.
 */
export function shouldApplyInkEcho(ops: readonly number[], isDrawer: boolean): boolean {
  if (!isDrawer) return ops.length > 0;
  return ops.includes(OP_CLEAR) || ops.includes(OP_FILL);
}
