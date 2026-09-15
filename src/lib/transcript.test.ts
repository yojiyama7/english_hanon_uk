import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTranscript } from './transcript.ts';

const knownLessons = new Set(['Unit 0.1', 'Unit 0.2']);

test('parses explicitly labelled lessons and preserves paragraphs', () => {
	assert.deepEqual(
		parseTranscript(
			'\uFEFF[Unit 0.2]\r\nSecond.\r\n\r\nAnother paragraph.\r\n[Unit 0.1]\r\nFirst.',
			knownLessons
		),
		{
			transcripts: {
				'Unit 0.2': 'Second.\n\nAnother paragraph.',
				'Unit 0.1': 'First.'
			},
			unknownLessonIds: []
		}
	);
});

test('reports unknown lessons without assigning them', () => {
	assert.deepEqual(parseTranscript('[Unit 9.9]\nUnknown.', knownLessons), {
		transcripts: {},
		unknownLessonIds: ['Unit 9.9']
	});
});

test('rejects duplicate lessons', () => {
	assert.throws(
		() => parseTranscript('[Unit 0.1]\nFirst.\n[Unit 0.1]\nAgain.', knownLessons),
		/重複/
	);
});

test('rejects content before the first heading', () => {
	assert.throws(() => parseTranscript('Unlabelled.\n[Unit 0.1]\nFirst.', knownLessons), /見出し/);
});

test('rejects an empty transcript', () => {
	assert.throws(() => parseTranscript('', knownLessons), /見出し/);
});
