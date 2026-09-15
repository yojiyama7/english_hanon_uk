import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const outputDirectory = '.svelte-kit/output';
const forbiddenMarkers = [
	'/api/pins',
	'PinEditor',
	'development-pin-api',
	'現在位置を保存',
	'音に合わせる'
];

async function filesWithin(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = join(directory, entry.name);
				return entry.isDirectory() ? filesWithin(path) : [path];
			})
		)
	).flat();
}

const files = await filesWithin(outputDirectory);
const editorFiles = files.filter((path) => /PinEditor|api[/\\]pins/i.test(path));
const markerHits = [];

for (const path of files) {
	const contents = await readFile(path).catch(() => null);
	if (!contents) continue;
	const text = contents.toString('utf8');
	for (const marker of forbiddenMarkers) {
		if (text.includes(marker)) markerHits.push(`${path}: ${marker}`);
	}
}

if (editorFiles.length || markerHits.length) {
	throw new Error(
		`Production output contains development editor code:\n${[...editorFiles, ...markerHits].join('\n')}`
	);
}

console.log('Production output contains no editor UI or pin API code.');
