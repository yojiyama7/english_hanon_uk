import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPinTime, isValidSentenceIndex, removePin, upsertPin } from './audio-pin.ts';

test('validates sentence indexes and decisecond pin times', () => {
	assert.equal(isValidSentenceIndex(0), true);
	assert.equal(isValidSentenceIndex(1.5), false);
	assert.equal(isValidSentenceIndex(-1), false);
	assert.equal(isValidPinTime(12.3), true);
	assert.equal(isValidPinTime(12.34), false);
});

test('creates and updates a pin by sentence index', () => {
	const created = upsertPin([], { sentenceIndex: 1, atSeconds: 3.2 });
	assert.deepEqual(upsertPin(created, { sentenceIndex: 1, atSeconds: 4.1 }), [
		{ sentenceIndex: 1, atSeconds: 4.1 }
	]);
});

test('allows different sentences at the same time and deletes by sentence index', () => {
	const pins = upsertPin([{ sentenceIndex: 2, atSeconds: 4.1 }], {
		sentenceIndex: 0,
		atSeconds: 4.1
	});
	assert.deepEqual(pins, [
		{ sentenceIndex: 0, atSeconds: 4.1 },
		{ sentenceIndex: 2, atSeconds: 4.1 }
	]);
	assert.deepEqual(removePin(pins, 0), [{ sentenceIndex: 2, atSeconds: 4.1 }]);
});
