import pinData from './audio-pins.json';

export type AudioKind = 'single' | 'slow' | 'natural';

export type AudioPin = {
	/** Position in seconds, specified to one decimal place (for example, 12.3). */
	atSeconds: number;
	/** Zero-based position of the matching sentence within a lesson transcript. */
	sentenceIndex: number;
};

export type AudioTrackMetadata = {
	title: string;
	unit: number;
	section: number;
	kind: AudioKind;
	filename: string;
	pins: AudioPin[];
};

export type AudioLessonMetadata = {
	title: string;
	unit: number;
	section: number;
	tracks: AudioTrackMetadata[];
};

export type AudioUnitMetadata = {
	unit: number;
	lessons: AudioLessonMetadata[];
};

// Pin data belongs to the site, not to the audio files.
const pinsByFilename = pinData as Record<string, AudioPin[]>;

// This catalog intentionally contains metadata only. Audio files remain on the user's device.
const sectionCounts = [15, 9, 6, 8, 5, 6, 9, 11, 4, 6, 7, 6, 8, 7, 6, 5, 6, 3, 3, 4];

function createCatalog(): AudioUnitMetadata[] {
	let fileNumber = 1;

	return sectionCounts.map((sectionCount, unit) => ({
		unit,
		lessons: Array.from({ length: sectionCount }, (_, index) => {
			const section = index + 1;
			const title = `Unit ${unit}.${section}`;
			const kinds: AudioKind[] = unit === 0 ? ['single'] : ['slow', 'natural'];
			const tracks = kinds.map((kind) => {
				const suffix = kind === 'single' ? '' : `_${kind}`;
				const filename = `${String(fileNumber).padStart(3, '0')}_RP_Unit ${unit}.${section}${suffix}.mp3`;
				fileNumber += 1;

				return { title, unit, section, kind, filename, pins: pinsByFilename[filename] ?? [] };
			});

			return { title, unit, section, tracks };
		})
	}));
}

export const audioCatalog = createCatalog();
