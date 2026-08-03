import { describe, expect, it } from 'vitest';
import { meshMembers, meshPair, type MeshPlayer, type VoiceFlags } from './voiceMesh';

const speaker: VoiceFlags = { voice: true, listening: true };
const listener: VoiceFlags = { voice: false, listening: true };
const deaf: VoiceFlags = { voice: false, listening: false };
const inconsistent: VoiceFlags = { voice: true, listening: false };

describe('meshPair', () => {
  it('is symmetric across every flag combination', () => {
    const flags = [speaker, listener, deaf, inconsistent];
    for (const a of flags) {
      for (const b of flags) expect(meshPair(a, b)).toBe(meshPair(b, a));
    }
  });

  it.each([
    ['speaker/listener', speaker, listener, true],
    ['speaker/speaker', speaker, speaker, true],
    ['listener/listener', listener, listener, true],
    ['speaker/deaf', speaker, deaf, false],
    ['deaf/deaf', deaf, deaf, false],
  ] as const)('%s is %s', (_label, a, b, expected) => {
    expect(meshPair(a, b)).toBe(expected);
  });
});
describe('meshMembers', () => {
  const room: MeshPlayer[] = [
    { id: 'h', ...speaker },
    { id: 'g', ...listener },
    { id: 'f', ...deaf },
    { id: 'e', ...speaker },
    { id: 'd', ...listener },
    { id: 'c', ...deaf },
    { id: 'b', ...speaker },
    { id: 'a', ...listener },
  ];

  it('gives both endpoints identical adjacency for a mixed eight-player room', () => {
    for (const x of room) {
      for (const y of room) {
        expect(meshMembers(x.id, room).includes(y.id)).toBe(
          meshMembers(y.id, room).includes(x.id),
        );
      }
    }
  });

  it('excludes self even when an identical player would mesh', () => {
    expect(meshMembers('h', room)).not.toContain('h');
  });

  it('returns empty before self appears in the broadcast', () => {
    expect(meshMembers('missing', room)).toEqual([]);
  });

  it('sorts output so room reorder does not change the membership key', () => {
    expect(meshMembers('h', room).join(',')).toBe(meshMembers('h', [...room].reverse()).join(','));
  });

  it('keeps a deaf player out even in a room full of speakers', () => {
    const speakers = room.map((player) => ({ ...player, ...speaker }));
    const deafSelf = { ...speakers[0]!, ...deaf };
    expect(meshMembers(deafSelf.id, [deafSelf, ...speakers.slice(1)])).toEqual([]);
  });

  it('pre-connects a quiet room so enabling a microphone needs no renegotiation', () => {
    const quiet = room.map((player) => ({ ...player, ...listener }));
    expect(meshMembers('h', quiet)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
});
