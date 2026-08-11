import type { TelephonePrivateCatchUp } from '@mg/shared/telephone';
let pending: number[] | null = null;
export function receiveTelephoneCatchUp(value: TelephonePrivateCatchUp | null): void { pending = value?.task === 'drawing' ? [...value.draftInk] : null; }
export function takeTelephoneDraftInk(): number[] | null { const value = pending; pending = null; return value; }
export function resetTelephoneDraftInk(): void { pending = null; }
