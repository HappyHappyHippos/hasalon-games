import type { MemesVote } from '@mg/shared/memes';
import { socket } from '../../net/socket';

export const FLUSH_MS = 400;

export interface DraftSender {
  update(a: string, b?: string): void;
  flush(): void;
  destroy(): void;
}

export function createDraftSender(): DraftSender {
  let latest: [string, string?] = ['', undefined];
  let timer: number | null = null;
  const send = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    socket.sendInput({ k: 'draft', a: latest[0], b: latest[1] });
  };
  return {
    update(a, b) {
      latest = [a, b];
      if (timer === null) timer = window.setTimeout(send, FLUSH_MS);
    },
    flush: send,
    destroy() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    },
  };
}

export function sendSubmit(a: string, b?: string): void {
  socket.sendInputReliable({ k: 'submit', a, b });
}

export function sendVote(v: MemesVote): void {
  socket.sendInputReliable({ k: 'vote', v });
}

export function sendReact(r: number): void {
  socket.sendInput({ k: 'react', r });
}
