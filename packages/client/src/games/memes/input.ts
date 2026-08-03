import type { MemeBoxPosition, MemesVote } from '@mg/shared/memes';
import { socket } from '../../net/socket';

export const FLUSH_MS = 400;

export interface DraftSender {
  update(a: string, b?: string, positions?: readonly MemeBoxPosition[]): void;
  flush(): void;
  destroy(): void;
}

export function createDraftSender(): DraftSender {
  let latest: [string, string?, MemeBoxPosition[]?] = ['', undefined, undefined];
  let timer: number | null = null;
  const send = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    socket.sendInput({ k: 'draft', a: latest[0], b: latest[1], p: latest[2] });
  };
  return {
    update(a, b, positions) {
      latest = [a, b, positions?.map((position) => ({ ...position }))];
      if (timer === null) timer = window.setTimeout(send, FLUSH_MS);
    },
    flush: send,
    destroy() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    },
  };
}

export function sendSubmit(a: string, b?: string, positions?: readonly MemeBoxPosition[]): void {
  socket.sendInputReliable({ k: 'submit', a, b, p: positions });
}

export function sendVote(v: MemesVote): void {
  socket.sendInputReliable({ k: 'vote', v });
}

export function sendReact(r: number): void {
  socket.sendInput({ k: 'react', r });
}
