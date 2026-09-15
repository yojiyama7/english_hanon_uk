import type { Plugin } from 'vite';
import { audioCatalog, type AudioPin } from '../lib/audio-catalog.ts';
import { isValidPinTime, isValidSentenceIndex, removePin, upsertPin } from '../lib/audio-pin.ts';
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

async function readRequestBody(request: import('node:http').IncomingMessage): Promise<unknown> {
	let body = '';
	for await (const chunk of request) {
		body += chunk;
		if (body.length > 16_384) throw new Error('Request body is too large');
	}
	return JSON.parse(body);
}

function sendJson(response: import('node:http').ServerResponse, status: number, value: unknown) {
	response.statusCode = status;
	response.setHeader('content-type', 'application/json');
	response.end(JSON.stringify(value));
}

export function devPinsApi(): Plugin {
	return {
		name: 'development-pin-api',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use('/api/pins', async (request, response) => {
				try {
					if (request.method === 'GET') {
						sendJson(response, 200, await readPins());
						return;
					}

					if (request.method !== 'POST' && request.method !== 'DELETE') {
						response.statusCode = 405;
						response.end('Method not allowed');
						return;
					}

					const body = (await readRequestBody(request)) as
						| { filename?: string; sentenceIndex?: number; atSeconds?: number }
						| null;
					const filename = body?.filename;
					const sentenceIndex = body?.sentenceIndex;
					if (!filename || !knownFilenames.has(filename)) throw new Error('Unknown audio filename');
					if (!isValidSentenceIndex(sentenceIndex)) throw new Error('Invalid sentence index');
					if (request.method === 'POST' && !isValidPinTime(body?.atSeconds)) {
						throw new Error('Invalid pin time');
					}

					let savedPins: AudioPin[] = [];
					const operation = writeQueue.then(async () => {
						const allPins = await readPins();
						const pins = allPins[filename] ?? [];
						if (request.method === 'DELETE' && !pins.some((pin) => pin.sentenceIndex === sentenceIndex)) {
							throw new Error('Pin not found');
						}
						savedPins = request.method === 'POST'
							? upsertPin(pins, { sentenceIndex, atSeconds: body!.atSeconds! })
							: removePin(pins, sentenceIndex);
						allPins[filename] = savedPins;
						const sortedPins = Object.fromEntries(
							Object.entries(allPins).sort(([a], [b]) => a.localeCompare(b))
						);
						await writeFile(temporaryPinsPath, `${JSON.stringify(sortedPins, null, '\t')}\n`, 'utf8');
						await rename(temporaryPinsPath, pinsPath);
					});
					writeQueue = operation.catch(() => undefined);
					await operation;
					sendJson(response, 200, { pins: savedPins });
				} catch (error) {
					sendJson(response, 400, {
						error: error instanceof Error ? error.message : 'Pin operation failed'
					});
				}
			});
		}
	};
}
