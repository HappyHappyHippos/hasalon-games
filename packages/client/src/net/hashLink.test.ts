import { describe, expect, it } from 'vitest';
import { ROOM_CODE_LENGTH, generateRoomCode } from '@mg/shared';
import { readHashCode } from './hashLink';

/**
 * `readHashCode` decides whether a shared invite link joins a room, and it is
 * the one place that used to spell out what a room code looks like instead of
 * asking `roomTypes.ts`. That shape has already changed once — codes were 24
 * letters plus 8 digits before they became four digits — and the next change
 * would break every link anyone had shared, silently: `App.tsx` reads this on
 * mount, gets null, and shows the home screen with nothing to explain why.
 *
 * So these assert against the shared definition rather than against "4 digits".
 */
describe('readHashCode', () => {
  it('accepts whatever the room code generator actually produces', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(readHashCode(`#/room/${code}`)).toBe(code);
    }
  });

  it('rejects a code of the wrong length, whatever the length happens to be', () => {
    const short = '1'.repeat(ROOM_CODE_LENGTH - 1);
    const long = '1'.repeat(ROOM_CODE_LENGTH + 1);
    expect(readHashCode(`#/room/${short}`)).toBeNull();
    expect(readHashCode(`#/room/${long}`)).toBeNull();
  });

  it('rejects anything that is not a room link', () => {
    expect(readHashCode('')).toBeNull();
    expect(readHashCode('#/')).toBeNull();
    expect(readHashCode('#/room/')).toBeNull();
    expect(readHashCode('#/rooms/1234')).toBeNull();
    expect(readHashCode('#/room/1234/extra')).toBeNull();
    // Outside the alphabet, whatever the alphabet is.
    expect(readHashCode('#/room/' + 'zz!/'.slice(0, ROOM_CODE_LENGTH))).toBeNull();
  });
});
