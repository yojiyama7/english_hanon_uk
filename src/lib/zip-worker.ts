import { unzipSync } from 'fflate';
import { archiveAudioName } from './import-source';

self.onmessage = (event: MessageEvent<{ input: Uint8Array; expectedFilenames: string[] }>) => {
	try {
		const expected = new Set(event.data.expectedFilenames);
		const entries = unzipSync(event.data.input, {
			filter: (entry) => archiveAudioName(entry.name, expected) !== null
		});
		self.postMessage({ entries });
	} catch (error) {
		self.postMessage({ error: error instanceof Error ? error.message : 'ZIPの解凍に失敗しました。' });
	}
};
