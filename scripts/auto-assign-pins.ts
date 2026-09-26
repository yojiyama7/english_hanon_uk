import { execFile, spawn } from 'node:child_process';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { assignMissingPins } from '../src/lib/automatic-pin-assignment.ts';
import { createAudioEnvelope, findStandardPinPositions } from '../src/lib/audio-onset.ts';
import type { AudioPin } from '../src/lib/audio-catalog.ts';
import { lessonId, parseTranscript } from '../src/lib/transcript.ts';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const audioDirectory = resolve(root, 'english_hanon_mp3');
const transcriptPath = resolve(audioDirectory, 'transcript.txt');
const pinsPath = resolve(root, 'src/lib/audio-pins.json');
const temporaryPinsPath = `${pinsPath}.tmp`;
const trackKinds = ['slow', 'natural'] as const;
type TrackKind = (typeof trackKinds)[number];

type AudioStreamInfo = { sampleRate: number; channels: number };
type Failure = { lesson: string; filename: string; reason: string };

// These two short prompts have valid onsets, but MP3 pre-echo leaves more than 10% of their
// one-second lead windows above the weak-sound threshold. Their positions still use the same
// onset-minus-0.4-seconds, rounded-down rule as every detected standard position.
const additionalStandardPositions: Record<string, number[]> = {
	'099_RP_Unit 6.8_natural.mp3': [72.3, 74]
};

function usageError(message: string): never {
	throw new Error(`${message}\nUsage: npm run pins:auto-assign-{slow|natural} -- [--write]`);
}

function parseArguments(arguments_: string[]): { kind: TrackKind; write: boolean } {
	const kind = arguments_[0];
	if (!trackKinds.includes(kind as TrackKind)) usageError(`Unknown track kind: ${kind ?? '(none)'}`);
	const unknown = arguments_.slice(1).filter((argument) => argument !== '--write');
	if (unknown.length) usageError(`Unknown option: ${unknown[0]}`);
	return { kind: kind as TrackKind, write: arguments_.includes('--write') };
}

async function audioStreamInfo(path: string): Promise<AudioStreamInfo> {
	const { stdout } = await execFileAsync('ffprobe', [
		'-v', 'error',
		'-select_streams', 'a:0',
		'-show_entries', 'stream=sample_rate,channels',
		'-of', 'json',
		path
	]);
	const parsed = JSON.parse(stdout) as {
		streams?: Array<{ sample_rate?: string; channels?: number }>;
	};
	const stream = parsed.streams?.[0];
	const sampleRate = Number(stream?.sample_rate);
	const channels = stream?.channels;
	if (
		!Number.isInteger(sampleRate) ||
		sampleRate <= 0 ||
		!Number.isInteger(channels) ||
		channels! <= 0
	) {
		throw new Error('音声ストリーム情報を取得できませんでした。');
	}
	return { sampleRate, channels: channels! };
}

async function decodeChannels(path: string, channelCount: number): Promise<Float32Array[]> {
	const child = spawn('ffmpeg', [
		'-v', 'error',
		'-i', path,
		'-map', '0:a:0',
		'-f', 'f32le',
		'-acodec', 'pcm_f32le',
		'pipe:1'
	], { stdio: ['ignore', 'pipe', 'pipe'] });
	const outputChunks: Buffer[] = [];
	const errorChunks: Buffer[] = [];
	child.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk));
	child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));
	const exitCode = await new Promise<number | null>((resolveExit, reject) => {
		child.on('error', reject);
		child.on('close', resolveExit);
	});
	if (exitCode !== 0) {
		throw new Error(Buffer.concat(errorChunks).toString('utf8').trim() || `ffmpeg exited with ${exitCode}`);
	}

	const decoded = Buffer.concat(outputChunks);
	if (decoded.byteLength % (Float32Array.BYTES_PER_ELEMENT * channelCount) !== 0) {
		throw new Error('デコード結果のサンプル数が不正です。');
	}
	const interleaved = new Float32Array(
		decoded.buffer,
		decoded.byteOffset,
		decoded.byteLength / Float32Array.BYTES_PER_ELEMENT
	);
	const sampleCount = interleaved.length / channelCount;
	const channels = Array.from({ length: channelCount }, () => new Float32Array(sampleCount));
	for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
			channels[channelIndex][sampleIndex] = interleaved[sampleIndex * channelCount + channelIndex];
		}
	}
	return channels;
}

async function main() {
	const { kind, write } = parseArguments(process.argv.slice(2));
	const filenamePattern = new RegExp(`^\\d{3}_RP_Unit (\\d+)\\.(\\d+)_${kind}\\.mp3$`);
	const filenames = (await readdir(audioDirectory))
		.filter((filename) => filenamePattern.test(filename))
		.sort();
	if (filenames.length === 0) throw new Error(`${kind}音源が見つかりませんでした。`);

	const lessonsByFilename = new Map(
		filenames.map((filename) => {
			const match = filename.match(filenamePattern)!;
			return [filename, lessonId(Number(match[1]), Number(match[2]))] as const;
		})
	);
	const knownLessonIds = new Set(lessonsByFilename.values());
	const { transcripts, unknownLessonIds } = parseTranscript(
		await readFile(transcriptPath, 'utf8'),
		knownLessonIds
	);
	if (unknownLessonIds.length) {
		console.warn(`対象外の文字起こしを無視します: ${unknownLessonIds.join(', ')}`);
	}

	const allPins = JSON.parse(await readFile(pinsPath, 'utf8')) as Record<string, AudioPin[]>;
	const failures: Failure[] = [];
	let successfulSections = 0;
	let addedPins = 0;

	for (const [index, filename] of filenames.entries()) {
		const lesson = lessonsByFilename.get(filename)!;
		const sentences = transcripts[lesson];
		if (!sentences) {
			failures.push({ lesson, filename, reason: '文字起こしがありません。' });
			console.log(`[${index + 1}/${filenames.length}] ${lesson}: 失敗（文字起こしなし）`);
			continue;
		}

		try {
			const path = resolve(audioDirectory, filename);
			const info = await audioStreamInfo(path);
			const channels = await decodeChannels(path, info.channels);
			const standardPositions = [
				...new Set([
					...findStandardPinPositions(createAudioEnvelope(channels, info.sampleRate)),
					...(additionalStandardPositions[filename] ?? [])
				])
			].sort((a, b) => a - b);
			const result = assignMissingPins(sentences, standardPositions, allPins[filename] ?? []);
			if (!result.ok) {
				throw new Error(
					`文${result.sentenceIndex + 1}に必要な規定位置${result.requiredPositionIndex + 1}がありません（検出数: ${standardPositions.length}）。`
				);
			}
			allPins[filename] = result.pins;
			successfulSections += 1;
			addedPins += result.additions.length;
			console.log(`[${index + 1}/${filenames.length}] ${lesson}: +${result.additions.length}`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : '解析に失敗しました。';
			failures.push({ lesson, filename, reason });
			console.log(`[${index + 1}/${filenames.length}] ${lesson}: 失敗`);
		}
	}

	if (write) {
		const sortedPins = Object.fromEntries(
			Object.entries(allPins)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([filename, pins]) => [
					filename,
					[...pins].sort((a, b) => a.sentenceIndex - b.sentenceIndex)
				])
		);
		await writeFile(temporaryPinsPath, `${JSON.stringify(sortedPins, null, '\t')}\n`, 'utf8');
		await rename(temporaryPinsPath, pinsPath);
	}

	console.log('');
	console.log(
		`${write ? '保存' : 'ドライラン'}: 成功 ${successfulSections}/${filenames.length}セクション、追加 ${addedPins}ピン、失敗 ${failures.length}セクション`
	);
	for (const failure of failures) {
		console.error(`- ${failure.lesson} (${failure.filename}): ${failure.reason}`);
	}
	if (!write) console.log('保存するには --write を指定してください。');
	if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
