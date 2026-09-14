const frameDurationSeconds = 0.01;
const minimumThresholdDb = -45;
const maximumThresholdDb = -25;
const noiseMarginDb = 12;
const requiredSilentFrames = 3;
const requiredSoundFrames = 5;

export type AudioEnvelope = {
	frames: Float32Array;
	frameDurationSeconds: number;
	threshold: number;
};

export type PinAdjustmentResult =
	| { ok: true; atSeconds: number; onsetSeconds: number }
	| { ok: false; reason: 'pin-in-sound' | 'no-onset' };

function amplitudeToDb(amplitude: number): number {
	return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}

function dbToAmplitude(db: number): number {
	return 10 ** (db / 20);
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

	const sortedFrames = Array.from(frames).sort((a, b) => a - b);
	const noiseFloor = sortedFrames[Math.floor((sortedFrames.length - 1) * 0.2)] ?? 0;
	const thresholdDb = Math.min(
		maximumThresholdDb,
		Math.max(minimumThresholdDb, amplitudeToDb(noiseFloor) + noiseMarginDb)
	);

	return { frames, frameDurationSeconds, threshold: dbToAmplitude(thresholdDb) };
}

export function adjustPinToNextOnset(envelope: AudioEnvelope, pinSeconds: number): PinAdjustmentResult {
	const startFrame = Math.max(0, Math.floor(pinSeconds / envelope.frameDurationSeconds));
	const silenceEnd = Math.min(startFrame + requiredSilentFrames, envelope.frames.length);
	for (let index = startFrame; index < silenceEnd; index += 1) {
		if (envelope.frames[index] >= envelope.threshold) return { ok: false, reason: 'pin-in-sound' };
	}
	if (silenceEnd - startFrame < requiredSilentFrames) return { ok: false, reason: 'no-onset' };

	let consecutiveSoundFrames = 0;
	for (let index = silenceEnd; index < envelope.frames.length; index += 1) {
		if (envelope.frames[index] >= envelope.threshold) {
			consecutiveSoundFrames += 1;
			if (consecutiveSoundFrames === requiredSoundFrames) {
				const onsetFrame = index - requiredSoundFrames + 1;
				const onsetSeconds = onsetFrame * envelope.frameDurationSeconds;
				const atSeconds = Math.round(Math.max(0, onsetSeconds - 0.4) * 10) / 10;
				return { ok: true, atSeconds, onsetSeconds };
			}
		} else {
			consecutiveSoundFrames = 0;
		}
	}

	return { ok: false, reason: 'no-onset' };
}
