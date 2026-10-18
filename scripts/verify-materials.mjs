import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const forbidden = /\.(?:zip|mp3|wav|m4a|aac|flac|ogg|opus|wma|txt|srt|vtt)$/i;
const isMaterial = (path) =>
	(forbidden.test(path) && path !== 'static/robots.txt' && path !== 'build/robots.txt') ||
	/(?:^|\/)(?:english_hanon_mp3|english_hanon_audio_zips|local-materials)\//i.test(path);

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
	.split('\0').filter(Boolean);
const violations = tracked.filter(isMaterial);

async function inspect(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await inspect(path);
		else if (isMaterial(path)) violations.push(path);
	}
}

// static/ is copied into the published site, including ignored files.
await inspect('static');
if (process.argv.includes('--build')) await inspect('build');
if (violations.length) {
	throw new Error(`Local materials must not be tracked or published:\n${violations.join('\n')}`);
}
console.log('No local audio or transcript files are tracked or included in static assets.');
