import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustPinToNextOnset, createAudioEnvelope } from './audio-onset.ts';

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

test('clamps the adjusted time to zero', () => {
	const envelope = createAudioEnvelope([samplesWithSound([[0.2, 0.8]])], sampleRate);
	assert.deepEqual(adjustPinToNextOnset(envelope, 0), { ok: true, atSeconds: 0, onsetSeconds: 0.2 });
});
