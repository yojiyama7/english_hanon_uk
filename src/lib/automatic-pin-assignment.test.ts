import assert from 'node:assert/strict';
import test from 'node:test';
import { assignMissingPins, hasTrailingCue } from './automatic-pin-assignment.ts';
import type { TranscriptSentence } from './transcript.ts';

function sentences(texts: string[]): TranscriptSentence[] {
	return texts.map((text, index) => ({ index, text, depth: 0 }));
}

const positions = Array.from({ length: 20 }, (_, index) => index * 10);

test('starts at the standard position closest to zero', () => {
	const result = assignMissingPins(sentences(['First.']), [4.2, 0.1, 2.3], []);
	assert.deepEqual(result, {
		ok: true,
		pins: [{ sentenceIndex: 0, atSeconds: 0.1 }],
		additions: [{ sentenceIndex: 0, atSeconds: 0.1 }]
	});
});

test('alternates three and two standard positions based on the preceding sentence', () => {
	const result = assignMissingPins(
		sentences(['First. (question)', 'Second.', 'Third. (question)', 'Fourth.', 'Fifth.']),
		positions,
		[]
	);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.pins.map((pin) => pin.atSeconds), [0, 30, 50, 80, 100]);
});

test('advances three positions when every preceding sentence has a trailing cue', () => {
	const result = assignMissingPins(
		sentences(['First. (should)', 'Second. (You)', 'Third. (have to)', 'Fourth. (He)', 'Fifth.']),
		positions,
		[]
	);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.pins.map((pin) => pin.atSeconds), [0, 30, 60, 90, 120]);
});

test('only treats a parenthesized suffix as a trailing cue', () => {
	assert.equal(hasTrailingCue('First sentence. (question)'), true);
	assert.equal(hasTrailingCue('First sentence. (question)   '), true);
	assert.equal(hasTrailingCue('First (example) sentence.'), false);
	assert.equal(hasTrailingCue('First sentence.'), false);
});

test('preserves existing pins and only returns missing additions', () => {
	const existingPins = [
		{ sentenceIndex: 0, atSeconds: 1.2 },
		{ sentenceIndex: 2, atSeconds: 55.5 }
	];
	const result = assignMissingPins(
		sentences(['First. (question)', 'Second.', 'Third.']),
		positions,
		existingPins
	);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.additions, [{ sentenceIndex: 1, atSeconds: 30 }]);
	assert.deepEqual(result.pins, [
		{ sentenceIndex: 0, atSeconds: 1.2 },
		{ sentenceIndex: 1, atSeconds: 30 },
		{ sentenceIndex: 2, atSeconds: 55.5 }
	]);
});

test('returns no pins when the section does not have enough standard positions', () => {
	const result = assignMissingPins(
		sentences(['First. (question)', 'Second.', 'Third.']),
		[0, 10, 20, 30],
		[{ sentenceIndex: 0, atSeconds: 1.2 }]
	);
	assert.deepEqual(result, { ok: false, sentenceIndex: 2, requiredPositionIndex: 5 });
});
