import type { AudioPin } from '$lib/audio-catalog';

export type PlayableTrack = {
	url: string;
	filename: string;
	pins: AudioPin[];
};
