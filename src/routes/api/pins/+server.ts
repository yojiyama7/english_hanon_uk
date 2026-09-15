import { dev } from '$app/environment';
import { audioCatalog, type AudioPin } from '$lib/audio-catalog';
import { isValidPinTime, isValidSentenceIndex, removePin, upsertPin } from '$lib/audio-pin';
import { error, json } from '@sveltejs/kit';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pinsPath = resolve(process.cwd(), 'src/lib/audio-pins.json');
const temporaryPinsPath = `${pinsPath}.tmp`;
const knownFilenames = new Set(
	audioCatalog.flatMap((unit) => unit.lessons.flatMap((lesson) => lesson.tracks.map((track) => track.filename)))
);

let writeQueue: Promise<void> = Promise.resolve();

async function readPins(): Promise<Record<string, AudioPin[]>> {
	return JSON.parse(await readFile(pinsPath, 'utf8')) as Record<string, AudioPin[]>;
}

export async function GET() {
	if (!dev) error(404, 'Not found');
	return json(await readPins());
}

export async function POST({ request, url }) {
	if (!dev) error(404, 'Not found');
	if (request.headers.get('origin') !== url.origin) error(403, 'Invalid origin');

	const body = (await request.json().catch(() => null)) as (Partial<AudioPin> & { filename?: string }) | null;
	const filename = body?.filename;
	const atSeconds = body?.atSeconds;
	const sentenceIndex = body?.sentenceIndex;

	if (!filename || !knownFilenames.has(filename)) error(400, 'Unknown audio filename');
	if (!isValidPinTime(atSeconds)) {
		error(400, 'Pin time must be a non-negative number with 0.1-second precision');
	}
	if (!isValidSentenceIndex(sentenceIndex)) error(400, 'Sentence index must be a non-negative integer');

	let savedPins: AudioPin[] = [];
	const operation = writeQueue.then(async () => {
		const allPins = await readPins();
		savedPins = upsertPin(allPins[filename] ?? [], { atSeconds, sentenceIndex });
		allPins[filename] = savedPins;
		const sortedPins = Object.fromEntries(Object.entries(allPins).sort(([a], [b]) => a.localeCompare(b)));
		await writeFile(temporaryPinsPath, `${JSON.stringify(sortedPins, null, '\t')}\n`, 'utf8');
		await rename(temporaryPinsPath, pinsPath);
	});
	writeQueue = operation.catch(() => undefined);
	await operation;

	return json({ pins: savedPins });
}

export async function DELETE({ request, url }) {
	if (!dev) error(404, 'Not found');
	if (request.headers.get('origin') !== url.origin) error(403, 'Invalid origin');

	const body = (await request.json().catch(() => null)) as
		| { filename?: string; sentenceIndex?: number }
		| null;
	const filename = body?.filename;
	const sentenceIndex = body?.sentenceIndex;

	if (!filename || !knownFilenames.has(filename)) error(400, 'Unknown audio filename');
	if (!isValidSentenceIndex(sentenceIndex)) error(400, 'Sentence index must be a non-negative integer');

	let savedPins: AudioPin[] = [];
	const operation = writeQueue.then(async () => {
		const allPins = await readPins();
		const pins = allPins[filename] ?? [];
		if (!pins.some((pin) => pin.sentenceIndex === sentenceIndex)) error(404, 'Pin not found');
		savedPins = removePin(pins, sentenceIndex);
		allPins[filename] = savedPins;
		const sortedPins = Object.fromEntries(Object.entries(allPins).sort(([a], [b]) => a.localeCompare(b)));
		await writeFile(temporaryPinsPath, `${JSON.stringify(sortedPins, null, '\t')}\n`, 'utf8');
		await rename(temporaryPinsPath, pinsPath);
	});
	writeQueue = operation.catch(() => undefined);
	await operation;

	return json({ pins: savedPins });
}
