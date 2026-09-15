const frameDurationSeconds = 0.01;
const minimumThresholdDb = -45;
const maximumThresholdDb = -25;
const noiseMarginDb = 12;
const minimumWeakThresholdDb = -75;
const weakNoiseMarginDb = 6;
const requiredSilentFrames = 3;
const requiredSoundFrames = 5;
const requiredLeadSilenceSeconds = 0.4;
const weakOnsetLookbackSeconds = 0.25;

export type AudioEnvelope = {
	frames: Float32Array;
	frameDurationSeconds: number;
	threshold: number;
};

export type PinAdjustmentResult =
	| { ok: true; atSeconds: number; onsetSeconds: number }
	| { ok: false; reason: 'pin-in-sound' | 'no-onset' };

export type PinPositionDirection = 'previous' | 'next';

const weakThresholdCache = new WeakMap<AudioEnvelope, number>();

function amplitudeToDb(amplitude: number): number {
	return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

function dbToAmplitude(db: number): number {
	return 10 ** (db / 20);
}

function noiseFloorForFrames(frames: Float32Array): number {
	const sortedFrames = Array.from(frames).sort((a, b) => a - b);
	return sortedFrames[Math.floor((sortedFrames.length - 1) * 0.2)] ?? 0;
}

function calculateWeakThreshold(noiseFloor: number, strongThreshold: number): number {
	const weakThresholdDb = Math.min(
		amplitudeToDb(strongThreshold),
		Math.max(minimumWeakThresholdDb, amplitudeToDb(noiseFloor) + weakNoiseMarginDb)
	);
	return dbToAmplitude(weakThresholdDb);
}

function weakThresholdFor(envelope: AudioEnvelope): number {
	const cachedThreshold = weakThresholdCache.get(envelope);
	if (cachedThreshold !== undefined) return cachedThreshold;
	const threshold = calculateWeakThreshold(noiseFloorForFrames(envelope.frames), envelope.threshold);
	weakThresholdCache.set(envelope, threshold);
	return threshold;
}

export function createAudioEnvelope(channels: Float32Array[], sampleRate: number): AudioEnvelope {
	if (channels.length === 0 || sampleRate <= 0) throw new Error('Audio samples are required.');
	const sampleLength = Math.max(...channels.map((channel) => channel.length));
	const samplesPerFrame = Math.max(1, Math.round(sampleRate * frameDurationSeconds));
	const frames = new Float32Array(Math.ceil(sampleLength / samplesPerFrame));

	for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
		const start = frameIndex * samplesPerFrame;
		const end = Math.min(start + samplesPerFrame, sampleLength);
		let squareSum = 0;
		let sampleCount = 0;
		for (const channel of channels) {
			const channelEnd = Math.min(end, channel.length);
			for (let sampleIndex = start; sampleIndex < channelEnd; sampleIndex += 1) {
				const sample = channel[sampleIndex];
				squareSum += sample * sample;
				sampleCount += 1;
			}
		}
		frames[frameIndex] = sampleCount > 0 ? Math.sqrt(squareSum / sampleCount) : 0;
	}

	const noiseFloor = noiseFloorForFrames(frames);
	const thresholdDb = Math.min(
		maximumThresholdDb,
		Math.max(minimumThresholdDb, amplitudeToDb(noiseFloor) + noiseMarginDb)
	);

	const envelope = { frames, frameDurationSeconds, threshold: dbToAmplitude(thresholdDb) };
	weakThresholdCache.set(envelope, calculateWeakThreshold(noiseFloor, envelope.threshold));
	return envelope;
}

function findSustainedOnsetFrames(
	envelope: AudioEnvelope,
	threshold: number,
	startFrame = 0
): number[] {
	const onsetFrames: number[] = [];
	let consecutiveSoundFrames = 0;

	for (let index = startFrame; index < envelope.frames.length; index += 1) {
		if (envelope.frames[index] >= threshold) {
			consecutiveSoundFrames += 1;
			if (consecutiveSoundFrames === requiredSoundFrames) {
				onsetFrames.push(index - requiredSoundFrames + 1);
			}
		} else {
			consecutiveSoundFrames = 0;
		}
	}

	return onsetFrames;
}

function hasLeadSilence(envelope: AudioEnvelope, onsetFrame: number, threshold: number): boolean {
	const requiredLeadSilentFrames = Math.ceil(
		requiredLeadSilenceSeconds / envelope.frameDurationSeconds
	);
	const silenceStart = onsetFrame - requiredLeadSilentFrames;
	return (
		silenceStart >= 0 &&
		envelope.frames
			.subarray(silenceStart, onsetFrame)
			.every((frame) => frame < threshold)
	);
}

function findOnsetFrames(envelope: AudioEnvelope, startFrame = 0): number[] {
	const weakThreshold = weakThresholdFor(envelope);
	const weakOnsetLookbackFrames = Math.ceil(
		weakOnsetLookbackSeconds / envelope.frameDurationSeconds
	);
	const weakOnsetFrames = findSustainedOnsetFrames(envelope, weakThreshold, startFrame);
	const onsetFrames = findSustainedOnsetFrames(envelope, envelope.threshold, startFrame).flatMap(
		(strongOnsetFrame) => {
			const earliestWeakFrame = Math.max(startFrame, strongOnsetFrame - weakOnsetLookbackFrames);
			const weakOnsetFrame = weakOnsetFrames.find(
				(frame) =>
					frame >= earliestWeakFrame &&
					frame <= strongOnsetFrame &&
					hasLeadSilence(envelope, frame, weakThreshold)
			);
			if (weakOnsetFrame !== undefined) return [weakOnsetFrame];
			return hasLeadSilence(envelope, strongOnsetFrame, weakThreshold)
				? [strongOnsetFrame]
				: [];
		}
	);
	return [...new Set(onsetFrames)];
}

function pinPositionForOnset(envelope: AudioEnvelope, onsetFrame: number): number {
	const onsetSeconds = onsetFrame * envelope.frameDurationSeconds;
	return Math.floor((onsetSeconds - requiredLeadSilenceSeconds) * 10 + 1e-8) / 10;
}

export function findStandardPinPositions(envelope: AudioEnvelope): number[] {
	return [...new Set(findOnsetFrames(envelope).map((frame) => pinPositionForOnset(envelope, frame)))];
}

export function findAdjacentPinPosition(
	positions: number[],
	currentSeconds: number,
	direction: PinPositionDirection
): number | undefined {
	if (direction === 'previous') {
		for (let index = positions.length - 1; index >= 0; index -= 1) {
			if (positions[index] < currentSeconds) return positions[index];
		}
		return undefined;
	}
	return positions.find((position) => position > currentSeconds);
}

export function adjustPinToNextOnset(envelope: AudioEnvelope, pinSeconds: number): PinAdjustmentResult {
	const startFrame = Math.max(0, Math.floor(pinSeconds / envelope.frameDurationSeconds));
	const silenceEnd = Math.min(startFrame + requiredSilentFrames, envelope.frames.length);
	for (let index = startFrame; index < silenceEnd; index += 1) {
		if (envelope.frames[index] >= weakThresholdFor(envelope)) {
			return { ok: false, reason: 'pin-in-sound' };
		}
	}
	if (silenceEnd - startFrame < requiredSilentFrames) return { ok: false, reason: 'no-onset' };

	const onsetFrame = findOnsetFrames(envelope, silenceEnd)[0];
	if (onsetFrame !== undefined) {
		const onsetSeconds = onsetFrame * envelope.frameDurationSeconds;
		return { ok: true, atSeconds: pinPositionForOnset(envelope, onsetFrame), onsetSeconds };
	}

	return { ok: false, reason: 'no-onset' };
}
