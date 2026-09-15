import assert from 'node:assert/strict';
import test from 'node:test';
import {
	adjustPinToNextOnset,
	createAudioEnvelope,
	findAdjacentPinPosition,
	findStandardPinPositions
} from './audio-onset.ts';

const sampleRate = 1000;

function samplesWithSound(ranges: Array<[startSeconds: number, endSeconds: number]>, durationSeconds = 2) {
	const samples = new Float32Array(durationSeconds * sampleRate).fill(0.001);
	for (const [startSeconds, endSeconds] of ranges) {
		for (let index = startSeconds * sampleRate; index < endSeconds * sampleRate; index += 1) samples[index] = 0.1;
	}
	return samples;
}

test('adjusts a silent pin to 0.4 seconds before the next onset', () => {
	const envelope = createAudioEnvelope([samplesWithSound([[0.8, 1.2]])], sampleRate);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0.2), { ok: true, atSeconds: 0.4, onsetSeconds: 0.8 });
});

test('ignores a sound shorter than 50 milliseconds', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[0.4, 0.43], [1, 1.4]])],
		sampleRate
	);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0.2), { ok: true, atSeconds: 0.6, onsetSeconds: 1 });
});

test('rejects a pin that is already inside sound', () => {
	const envelope = createAudioEnvelope([samplesWithSound([[0.4, 1]])], sampleRate);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0.6), { ok: false, reason: 'pin-in-sound' });
});

test('reports when no later onset exists', () => {
	const envelope = createAudioEnvelope([samplesWithSound([])], sampleRate);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0.2), { ok: false, reason: 'no-onset' });
});

test('requires a full 0.4 seconds of silence before an onset', () => {
	const envelope = createAudioEnvelope([samplesWithSound([[0.2, 0.8]])], sampleRate);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0), { ok: false, reason: 'no-onset' });
	assert.deepEqual(findStandardPinPositions(envelope), []);
});

test('lists onsets preceded by at least 0.4 seconds of silence as standard positions', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[0.5, 0.7], [1.1, 1.3], [1.7, 1.9]])],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.1, 0.7, 1.3]);
});

test('rejects onsets when the preceding 0.4 seconds contains sound', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[0.2, 0.23], [0.5, 0.7], [1, 1.2], [1.7, 1.9]], 2.1)],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [1.3]);
});

test('selects strict previous and next standard positions', () => {
	const positions = [0.4, 1.2, 2];
	assert.equal(findAdjacentPinPosition(positions, 1.2, 'previous'), 0.4);
	assert.equal(findAdjacentPinPosition(positions, 1.2, 'next'), 2);
	assert.equal(findAdjacentPinPosition(positions, 0.8, 'previous'), 0.4);
	assert.equal(findAdjacentPinPosition(positions, 0.8, 'next'), 1.2);
});

test('reports no adjacent position at either edge or in an empty list', () => {
	const positions = [0.4, 1.2];
	assert.equal(findAdjacentPinPosition(positions, 0.4, 'previous'), undefined);
	assert.equal(findAdjacentPinPosition(positions, 1.2, 'next'), undefined);
	assert.equal(findAdjacentPinPosition(positions, 0.1, 'previous'), undefined);
	assert.equal(findAdjacentPinPosition(positions, 2, 'next'), undefined);
	assert.equal(findAdjacentPinPosition(positions, 0.1, 'next'), 0.4);
	assert.equal(findAdjacentPinPosition(positions, 2, 'previous'), 1.2);
	assert.equal(findAdjacentPinPosition([], 0.8, 'previous'), undefined);
	assert.equal(findAdjacentPinPosition([], 0.8, 'next'), undefined);
});
