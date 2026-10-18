export const transcriptSourceFilename = 'transcript.txt';

// Archive paths are never used as filesystem paths. Only catalog filenames are saved.
export function archiveAudioName(path: string, expected: ReadonlySet<string>): string | null {
	const parts = path.split('/');
	if (parts.some((part) => part === '..' || part === '__MACOSX') || path.startsWith('/')) return null;
	const name = parts.at(-1) ?? '';
	// The distributed ZIP spells track 107 as Unit_7.3 instead of Unit 7.3.
	const canonicalName = name.replace('_RP_Unit_', '_RP_Unit ');
	return expected.has(canonicalName) ? canonicalName : null;
}

export type ImportFileCandidate = {
	name: string;
	webkitRelativePath: string;
};

export function isAudioFilename(filename: string): boolean {
	return filename.toLowerCase().endsWith('.mp3');
}

export function isZipFilename(filename: string): boolean {
	return filename.toLowerCase().endsWith('.zip');
}

export function isTranscriptFilename(filename: string): boolean {
	return filename === transcriptSourceFilename;
}

export function selectFallbackImportFiles<T extends ImportFileCandidate>(files: readonly T[]): {
	audioFiles: T[];
	zipFiles: T[];
	transcriptFile?: T;
} {
	const audioFiles = files.filter((file) => isAudioFilename(file.name));
	const zipFiles = files.filter((file) => isZipFilename(file.name));
	const transcriptFile = files.find((file) => {
		if (!isTranscriptFilename(file.name)) return false;
		const pathSegments = file.webkitRelativePath.split('/').filter(Boolean);
		return pathSegments.length === 2;
	});

	return transcriptFile ? { audioFiles, zipFiles, transcriptFile } : { audioFiles, zipFiles };
}
