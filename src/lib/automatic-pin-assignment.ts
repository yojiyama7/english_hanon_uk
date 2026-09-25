import type { AudioPin } from './audio-catalog';
import type { TranscriptSentence } from './transcript';

export type AutomaticPinAssignmentResult =
	| { ok: true; pins: AudioPin[]; additions: AudioPin[] }
	| { ok: false; sentenceIndex: number; requiredPositionIndex: number };

const trailingCuePattern = /\([^()]+\)\s*$/;

export function hasTrailingCue(text: string): boolean {
	return trailingCuePattern.test(text);
}

export function assignMissingPins(
	sentences: readonly TranscriptSentence[],
	standardPositions: readonly number[],
	existingPins: readonly AudioPin[]
): AutomaticPinAssignmentResult {
	if (sentences.length === 0) return { ok: true, pins: [...existingPins], additions: [] };

	const positions = [...standardPositions].sort((a, b) => a - b);
	let positionIndex = positions.reduce(
		(closestIndex, position, index) =>
			Math.abs(position) < Math.abs(positions[closestIndex]) ? index : closestIndex,
		0
	);
	const targetPins: AudioPin[] = [];

	for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
		if (sentenceIndex > 0) {
			positionIndex += hasTrailingCue(sentences[sentenceIndex - 1].text) ? 3 : 2;
		}
		if (positions[positionIndex] === undefined) {
			return { ok: false, sentenceIndex, requiredPositionIndex: positionIndex };
		}
		targetPins.push({
			sentenceIndex: sentences[sentenceIndex].index,
			atSeconds: positions[positionIndex]
		});
	}

	const existingIndexes = new Set(existingPins.map((pin) => pin.sentenceIndex));
	const additions = targetPins.filter((pin) => !existingIndexes.has(pin.sentenceIndex));
	return {
		ok: true,
		pins: [...existingPins, ...additions].sort((a, b) => a.sentenceIndex - b.sentenceIndex),
		additions
	};
}
