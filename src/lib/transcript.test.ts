import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTranscript } from './transcript.ts';

const knownLessons = new Set(['Unit 0.1', 'Unit 0.2']);

test('parses transcript bullets as ordered sentences and preserves nesting', () => {
	assert.deepEqual(
		parseTranscript(
			'\uFEFF[Unit 0.2]\r\n- Second.\r\n  - Another sentence.\r\n[Unit 0.1]\r\n- First.',
			knownLessons
		),
		{
			transcripts: {
				'Unit 0.2': [
					{ index: 0, text: 'Second.', depth: 0 },
					{ index: 1, text: 'Another sentence.', depth: 1 }
				],
				'Unit 0.1': [{ index: 0, text: 'First.', depth: 0 }]
			},
			unknownLessonIds: []
		}
	);
});

test('reports unknown lessons without assigning them', () => {
	assert.deepEqual(parseTranscript('[Unit 9.9]\n- Unknown.', knownLessons), {
		transcripts: {},
		unknownLessonIds: ['Unit 9.9']
	});
});

test('rejects duplicate lessons', () => {
	assert.throws(
		() => parseTranscript('[Unit 0.1]\n- First.\n[Unit 0.1]\n- Again.', knownLessons),
		/重複/
	);
});

test('rejects content before the first heading', () => {
	assert.throws(() => parseTranscript('- Unlabelled.\n[Unit 0.1]\n- First.', knownLessons), /見出し/);
});

test('rejects non-bullet transcript content', () => {
	assert.throws(() => parseTranscript('[Unit 0.1]\nFirst.', knownLessons), /「- 」/);
});

test('rejects an empty transcript', () => {
	assert.throws(() => parseTranscript('', knownLessons), /見出し/);
});
