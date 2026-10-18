import { unzipSync } from 'fflate';
import { archiveAudioName } from './import-source.ts';
export { archiveAudioName } from './import-source.ts';

async function unpack(input: Uint8Array<ArrayBuffer>, expectedFilenames: readonly string[]) {
	// Keep decompression off the browser UI thread. Node tests use the same decoder directly.
	if (typeof Worker === 'undefined') {
		const expected = new Set(expectedFilenames);
		return unzipSync(input, { filter: (entry) => archiveAudioName(entry.name, expected) !== null });
	}
	const worker = new Worker(new URL('./zip-worker.ts', import.meta.url), { type: 'module' });
	try {
		return await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
			worker.onmessage = (event) => {
				if (event.data.error) reject(new Error(event.data.error));
				else resolve(event.data.entries);
			};
			worker.onerror = () => reject(new Error('ZIPの解凍処理を実行できませんでした。'));
			worker.postMessage({ input, expectedFilenames }, [input.buffer]);
		});
	} finally {
		worker.terminate();
	}
}

export async function extractAudioZips(
	archives: readonly File[],
	expectedFilenames: readonly string[],
	onProgress: (message: string) => void = () => {}
): Promise<File[]> {
	const expected = new Set(expectedFilenames);
	const audioFiles = new Map<string, File>();
	for (const [index, archive] of archives.entries()) {
		onProgress(`ZIPを解凍しています（${index + 1}/${archives.length}）: ${archive.name}`);
		try {
			const input = new Uint8Array(await archive.arrayBuffer());
			const entries = await unpack(input, expectedFilenames);
			for (const [path, bytes] of Object.entries(entries)) {
				const name = archiveAudioName(path, expected)!;
				if (audioFiles.has(name)) throw new Error(`同名の音声ファイルが複数あります: ${name}`);
				audioFiles.set(name, new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' }));
			}
		} catch (error) {
			throw new Error(`${archive.name} を解凍できませんでした。${error instanceof Error ? error.message : ''}`);
		}
	}
	return [...audioFiles.values()];
}
