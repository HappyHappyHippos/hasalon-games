import type { TelephonePrivateCatchUp } from '@mg/shared/telephone';
let pending: number[] | null = null;
let receiver: ((ink: number[]) => void) | null = null;
export function receiveTelephoneCatchUp(value: TelephonePrivateCatchUp | null): void { const ink = value?.task === 'drawing' ? [...value.draftInk] : null; if (ink && receiver) receiver(ink); else pending = ink; }
export function connectTelephoneDraftInk(next: (ink: number[]) => void): () => void { receiver = next; if (pending) { next(pending); pending = null; } return () => { if (receiver === next) receiver = null; }; }
export function resetTelephoneDraftInk(): void { pending = null; receiver = null; }
