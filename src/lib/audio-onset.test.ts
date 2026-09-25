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

function samplesWithLevels(
	ranges: Array<[startSeconds: number, endSeconds: number, amplitude: number]>,
	durationSeconds = 2
) {
	const samples = new Float32Array(durationSeconds * sampleRate).fill(0.00001);
	for (const [startSeconds, endSeconds, amplitude] of ranges) {
		for (let index = startSeconds * sampleRate; index < endSeconds * sampleRate; index += 1) {
			samples[index] = amplitude;
		}
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

test('uses zero for an onset with less than 0.4 seconds of silence at the start', () => {
	const envelope = createAudioEnvelope([samplesWithSound([[0.2, 0.8]])], sampleRate);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0), {
		ok: true,
		atSeconds: 0,
		onsetSeconds: 0.2
	});
	assert.deepEqual(findStandardPinPositions(envelope), [0]);
});

test('uses zero when sound begins at the start of the audio', () => {
	const envelope = createAudioEnvelope([samplesWithSound([[0, 0.8]])], sampleRate);
	assert.deepEqual(findStandardPinPositions(envelope), [0]);
});

test('lists onsets preceded by at least 1 second of silence as standard positions', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[1.1, 1.3], [2.4, 2.6], [3.7, 3.9]], 4.2)],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.7, 2, 3.3]);
});

test('allows brief sounds when at least 90 percent of the 1 second lead interval is silent', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[0.3, 0.33], [0.6, 0.63], [0.9, 0.93], [1.2, 1.5]])],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.8]);
});

test('rejects onsets when less than 90 percent of the 1 second lead interval is silent', () => {
	const envelope = createAudioEnvelope(
		[
			samplesWithSound(
				[
					[0.3, 0.33],
					[0.5, 0.53],
					[0.7, 0.73],
					[0.9, 0.93],
					[1.2, 1.5],
					[2.6, 2.9]
				],
				3.1
			)
		],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [2.2]);
});

test('uses a sustained weak onset shortly before confirmed sound', () => {
	const envelope = createAudioEnvelope(
		[samplesWithLevels([[0.83, 0.9, 0.0003], [0.98, 1.3, 0.1]])],
		sampleRate
	);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0.2), {
		ok: true,
		atSeconds: 0.4,
		onsetSeconds: 0.8300000000000001
	});
	assert.deepEqual(findStandardPinPositions(envelope), [0.4]);
});

test('uses a sustained weak onset 0.3 seconds before confirmed sound', () => {
	const envelope = createAudioEnvelope(
		[samplesWithLevels([[0.8, 0.9, 0.0003], [1.1, 1.4, 0.1]])],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.4]);
});

test('keeps the first standard position and suppresses later positions within one second', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[1.2, 1.26], [1.5, 1.8]])],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.8]);
});

test('allows another standard position exactly one second after the previous position', () => {
	const envelope = createAudioEnvelope(
		[samplesWithSound([[1.2, 1.26], [2.2, 2.5]], 2.7)],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.8, 1.8]);
});

test('does not create a position for weak sound without nearby confirmed sound', () => {
	const envelope = createAudioEnvelope(
		[samplesWithLevels([[0.05, 0.15, 0.0003], [1.2, 1.5, 0.1]])],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.8]);
});

test('rejects a weak onset without enough preceding silence', () => {
	const envelope = createAudioEnvelope(
		[
			samplesWithLevels([
				[0.5, 0.6, 0.0003],
				[0.75, 0.85, 0.0003],
				[0.9, 1.2, 0.1]
			])
		],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), []);
});

test('rounds a standard position down to preserve at least 0.4 seconds of silence', () => {
	const envelope = createAudioEnvelope(
		[samplesWithLevels([[0.86, 1.2, 0.1]])],
		sampleRate
	);
	assert.deepEqual(findStandardPinPositions(envelope), [0.4]);
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
