export const transcriptSourceFilename = 'transcript.txt';

export type ImportFileCandidate = {
	name: string;
	webkitRelativePath: string;
};

export function isAudioFilename(filename: string): boolean {
	return filename.toLowerCase().endsWith('.mp3');
}

export function isTranscriptFilename(filename: string): boolean {
	return filename === transcriptSourceFilename;
}

export function selectFallbackImportFiles<T extends ImportFileCandidate>(files: readonly T[]): {
	audioFiles: T[];
	transcriptFile?: T;
} {
	const audioFiles = files.filter((file) => isAudioFilename(file.name));
	const transcriptFile = files.find((file) => {
		if (!isTranscriptFilename(file.name)) return false;
		const pathSegments = file.webkitRelativePath.split('/').filter(Boolean);
		return pathSegments.length === 2;
	});

	return transcriptFile ? { audioFiles, transcriptFile } : { audioFiles };
}
