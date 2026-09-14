import { dev } from '$app/environment';
import { audioCatalog, type AudioPin } from '$lib/audio-catalog';
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

	const body = (await request.json().catch(() => null)) as Partial<AudioPin> & { filename?: string } | null;
	const filename = body?.filename;
	const atSeconds = body?.atSeconds;
	const label = body?.label?.trim();

	if (!filename || !knownFilenames.has(filename)) error(400, 'Unknown audio filename');
	if (
		typeof atSeconds !== 'number' ||
		!Number.isFinite(atSeconds) ||
		atSeconds < 0 ||
		Math.abs(atSeconds * 10 - Math.round(atSeconds * 10)) > 1e-8
	) {
		error(400, 'Pin time must be a non-negative number with 0.1-second precision');
	}
	if (!label || label.length > 100) error(400, 'Label must contain 1 to 100 characters');

	let savedPins: AudioPin[] = [];
	const operation = writeQueue.then(async () => {
		const allPins = await readPins();
		savedPins = [...(allPins[filename] ?? []).filter((pin) => pin.atSeconds !== atSeconds), { atSeconds, label }].sort(
			(a, b) => a.atSeconds - b.atSeconds
		);
		allPins[filename] = savedPins;
		const sortedPins = Object.fromEntries(Object.entries(allPins).sort(([a], [b]) => a.localeCompare(b)));
		await writeFile(temporaryPinsPath, `${JSON.stringify(sortedPins, null, '\t')}\n`, 'utf8');
		await rename(temporaryPinsPath, pinsPath);
	});
	writeQueue = operation.catch(() => undefined);
	await operation;

	return json({ pins: savedPins });
}
