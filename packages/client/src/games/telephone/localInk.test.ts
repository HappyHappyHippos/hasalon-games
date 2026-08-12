import { describe, expect, it } from 'vitest';
import { OP_BEGIN, OP_CLEAR, OP_FILL, OP_TO } from '@mg/shared/skribbl';
import { LocalInkHistory } from './localInk';

describe('LocalInkHistory', () => {
  it('rebuilds the canvas one complete stroke at a time on undo', () => {
    const history = new LocalInkHistory();
    const first = [OP_BEGIN, 0, 1, 10, 20, OP_TO, 30, 40];
    const second = [OP_BEGIN, 2, 1, 50, 60, OP_TO, 70, 80];
    history.replace(first);
    history.append(second);
    expect(history.undo()).toEqual([OP_CLEAR, ...first]);
    expect(history.undo()).toEqual([OP_CLEAR]);
  });

  it('treats fills as undoable actions and clear resets all history', () => {
    const history = new LocalInkHistory();
    history.append([OP_FILL, 3, 100, 120]);
    expect(history.snapshot()).toEqual([OP_FILL, 3, 100, 120]);
    expect(history.clear()).toEqual([OP_CLEAR]);
    expect(history.undo()).toEqual([OP_CLEAR]);
  });
});
