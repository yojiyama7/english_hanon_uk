import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const basePath = process.env.BASE_PATH ?? '';
if (basePath !== '' && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
	throw new Error('BASE_PATH must start with / and have no trailing slash.');
}

export default defineConfig(async ({ command }) => ({
	server: {
		fs: {
			allow: [searchForWorkspaceRoot(new URL('.', import.meta.url).pathname)]
		},
		// Pins are updated through the development editor without forcing a page reload.
		watch: { ignored: ['**/src/lib/audio-pins.json'] }
	},
	plugins: [
		...(command === 'serve' ? [(await import('./src/dev/pins-api.ts')).devPinsApi()] : []),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			paths: { base: basePath as '' | `/${string}` },
			adapter: adapter()
		})
	]
}));
