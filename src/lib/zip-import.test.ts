import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { archiveAudioName, extractAudioZips } from './zip-import.ts';

const expected = ['001_RP_Unit 0.1.mp3', '002_RP_Unit 0.2.mp3'];
function archive(name: string, entries: Record<string, Uint8Array>) {
	return new File([new Uint8Array(zipSync(entries))], name);
}

test('extracts multiple archives, flattening nested audio and ignoring unrelated files', async () => {
	const progress: string[] = [];
	const files = await extractAudioZips([
		archive('unit0.zip', {
			[expected[0]]: strToU8('synthetic audio one'),
			'transcript.txt': strToU8('not imported from ZIP'),
			[`__MACOSX/${expected[1]}`]: strToU8('metadata')
		}),
		archive('unit1.zip', { [`audio/${expected[1]}`]: strToU8('synthetic audio two') })
	], expected, (message) => progress.push(message));
	assert.deepEqual(files.map((file) => file.name), expected);
	assert.equal(await files[0].text(), 'synthetic audio one');
	assert.equal(await files[1].text(), 'synthetic audio two');
	assert.equal(files[0].type, 'audio/mpeg');
	assert.equal(progress.length, 2);
});

test('rejects duplicate audio across archives', async () => {
	const entries = { [expected[0]]: strToU8('synthetic') };
	await assert.rejects(extractAudioZips([
		archive('first.zip', entries), archive('second.zip', entries)
	], expected), /同名の音声/);
});

test('reports a corrupt ZIP with its filename', async () => {
	await assert.rejects(extractAudioZips([
		new File(['invalid zip'], 'broken.zip')
	], expected), /broken.zip を解凍できませんでした/);
});

test('never accepts traversal paths, metadata or unknown audio', () => {
	const names = new Set(expected);
	assert.equal(archiveAudioName(`../${expected[0]}`, names), null);
	assert.equal(archiveAudioName(`/${expected[0]}`, names), null);
	assert.equal(archiveAudioName(`__MACOSX/${expected[0]}`, names), null);
	assert.equal(archiveAudioName('unknown.mp3', names), null);
});

test('normalizes the Unit underscore spelling used by the distributed ZIP', async () => {
	const canonical = '107_RP_Unit 7.3_natural.mp3';
	const files = await extractAudioZips([
		archive('unit7.zip', { '107_RP_Unit_7.3_natural.mp3': strToU8('synthetic audio') })
	], [canonical]);
	assert.equal(files[0].name, canonical);
});
