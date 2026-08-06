import type { MemeBoxPosition, MemesVote } from '@mg/shared/memes';
import { socket } from '../../net/socket';

export const FLUSH_MS = 400;

export interface DraftSender {
  update(texts: readonly string[], positions?: readonly MemeBoxPosition[]): void;
  flush(): void;
  destroy(): void;
}

export function createDraftSender(): DraftSender {
  let latest: { texts: string[]; positions?: MemeBoxPosition[] } = { texts: [] };
  let timer: number | null = null;
  const send = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    socket.sendInput({ k: 'draft', texts: latest.texts, p: latest.positions });
  };
  return {
    update(texts, positions) {
      latest = {
        texts: [...texts],
        positions: positions?.map((position) => ({ ...position })),
      };
      if (timer === null) timer = window.setTimeout(send, FLUSH_MS);
    },
    flush: send,
    destroy() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    },
  };
}

export function sendSubmit(
  texts: readonly string[],
  positions?: readonly MemeBoxPosition[],
): void {
  socket.sendInputReliable({ k: 'submit', texts: [...texts], p: positions });
}

export function sendVote(v: MemesVote): void {
  socket.sendInputReliable({ k: 'vote', v });
}

export function sendReact(r: number): void {
  socket.sendInput({ k: 'react', r });
}

export function sendSkipMeme(): void {
  socket.sendInputReliable({ k: 'skipMeme' });
}

