import assert from 'node:assert/strict';
import test from 'node:test';
import {
	availableStorageBytes,
	formatBytes,
	hasStorageCapacity
} from './storage-capacity.ts';

test('calculates browser storage remaining after current usage', () => {
	assert.equal(availableStorageBytes({ quota: 1_000, usage: 250 }), 750);
	assert.equal(availableStorageBytes({ quota: 100, usage: 150 }), 0);
	assert.equal(availableStorageBytes({}), undefined);
});

test('blocks a known capacity shortage but permits an unknown estimate', () => {
	assert.equal(hasStorageCapacity(500, 499), false);
	assert.equal(hasStorageCapacity(500, 500), true);
	assert.equal(hasStorageCapacity(500, undefined), true);
});

test('formats capacity using decimal storage units', () => {
	assert.equal(formatBytes(518_475_734), '518.5 MB');
	assert.equal(formatBytes(undefined), '取得できませんでした');
});
