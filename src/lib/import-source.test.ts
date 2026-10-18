import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isAudioFilename,
	isTranscriptFilename,
	selectFallbackImportFiles
} from './import-source.ts';

test('recognizes MP3 files case-insensitively', () => {
	assert.equal(isAudioFilename('lesson.mp3'), true);
	assert.equal(isAudioFilename('lesson.MP3'), true);
	assert.equal(isAudioFilename('lesson.txt'), false);
});

test('recognizes only the exact transcript filename', () => {
	assert.equal(isTranscriptFilename('transcript.txt'), true);
	assert.equal(isTranscriptFilename('Transcript.txt'), false);
	assert.equal(isTranscriptFilename('text.txt'), false);
});

test('selects recursive audio and only a root-level transcript from fallback files', () => {
	const files = [
		{ name: 'root.mp3', webkitRelativePath: 'English Hanon/root.mp3' },
		{ name: 'nested.MP3', webkitRelativePath: 'English Hanon/audio/nested.MP3' },
		{ name: 'transcript.txt', webkitRelativePath: 'English Hanon/transcript.txt' },
		{ name: 'transcript.txt', webkitRelativePath: 'English Hanon/notes/transcript.txt' },
		{ name: 'text.txt', webkitRelativePath: 'English Hanon/text.txt' }
	];

	assert.deepEqual(selectFallbackImportFiles(files), {
		audioFiles: [files[0], files[1]],
		zipFiles: [],
		transcriptFile: files[2]
	});
});

test('allows an import without a transcript', () => {
	const files = [
		{ name: 'lesson.mp3', webkitRelativePath: 'English Hanon/lesson.mp3' },
		{ name: 'notes.txt', webkitRelativePath: 'English Hanon/notes.txt' }
	];

	assert.deepEqual(selectFallbackImportFiles(files), { audioFiles: [files[0]], zipFiles: [] });
});

test('selects ZIP files recursively and case-insensitively', () => {
	const files = [
		{ name: 'Unit 0-2.zip', webkitRelativePath: 'english_hanon_audio_zips/Unit 0-2.zip' },
		{ name: 'Unit 3-5.ZIP', webkitRelativePath: 'english_hanon_audio_zips/nested/Unit 3-5.ZIP' }
	];
	assert.deepEqual(selectFallbackImportFiles(files), { audioFiles: [], zipFiles: files });
});
