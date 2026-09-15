import type { AudioPin } from './audio-catalog';

export function isValidPinTime(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= 0 &&
		Math.abs(value * 10 - Math.round(value * 10)) <= 1e-8
	);
}

export function isValidSentenceIndex(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function upsertPin(pins: AudioPin[], pin: AudioPin): AudioPin[] {
	return [...pins.filter((candidate) => candidate.sentenceIndex !== pin.sentenceIndex), pin].sort(
		(a, b) => a.sentenceIndex - b.sentenceIndex
	);
}

export function removePin(pins: AudioPin[], sentenceIndex: number): AudioPin[] {
	return pins.filter((pin) => pin.sentenceIndex !== sentenceIndex);
}
