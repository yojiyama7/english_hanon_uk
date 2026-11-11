import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSectionParam } from './section-param.ts';

test('parses unit and section numbers from the URL value', () => {
	assert.deepEqual(parseSectionParam('10-7'), { unit: 10, section: 7 });
	assert.deepEqual(parseSectionParam(' Unit 0-2 '), { unit: 0, section: 2 });
});

test('rejects missing or malformed values', () => {
	for (const value of [null, '', '10', '10-', '-7', '10-7-1', 'abc', '10.7']) {
		assert.equal(parseSectionParam(value), null);
	}
});
