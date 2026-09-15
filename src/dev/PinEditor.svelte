<script lang="ts">
	import type { AudioPin } from '$lib/audio-catalog';
	import {
		adjustPinToNextOnset,
		createAudioEnvelope,
		findAdjacentPinPosition,
		findStandardPinPositions,
		type AudioEnvelope,
		type PinPositionDirection
	} from '$lib/audio-onset';
	import { upsertPin } from '$lib/audio-pin';
	import type { PlayableTrack } from '$lib/player-types';
	import type { TranscriptSentence } from '$lib/transcript';

	let { track, sentences }: { track: PlayableTrack; sentences: TranscriptSentence[] } = $props();
	let busy = $state(false);
	let message = $state('');
	let hasError = $state(false);
	let pinsLoadedFor = $state('');
	let standardPositions = $state<number[]>([]);
	let standardPositionsFor = $state('');
	let envelopePromise: Promise<AudioEnvelope> | null = null;
	let envelopeFor = '';

	function pinFor(sentenceIndex: number): AudioPin | undefined {
		return track.pins.find((pin) => pin.sentenceIndex === sentenceIndex);
	}

	function audioElement(): HTMLAudioElement | null {
		return document.querySelector(`audio[data-filename="${CSS.escape(track.filename)}"]`);
	}

	function formatTime(atSeconds: number): string {
		const deciseconds = Math.round(atSeconds * 10);
		return `${Math.floor(deciseconds / 600)}:${String(Math.floor(deciseconds / 10) % 60).padStart(2, '0')}.${deciseconds % 10}`;
	}

	async function loadPins() {
		const filename = track.filename;
		try {
			const response = await fetch('/api/pins');
			if (!response.ok) throw new Error();
			const allPins = (await response.json()) as Record<string, AudioPin[]>;
			if (track.filename === filename) track.pins = allPins[filename] ?? track.pins;
		} catch {
			message = '保存済みの編集データを読み込めませんでした。';
			hasError = true;
		} finally {
			pinsLoadedFor = filename;
		}
	}

	async function envelope(): Promise<AudioEnvelope> {
		if (envelopePromise && envelopeFor === track.url) return envelopePromise;
		envelopeFor = track.url;
		envelopePromise = (async () => {
			const response = await fetch(track.url);
			if (!response.ok) throw new Error();
			const context = new AudioContext();
			try {
				const buffer = await context.decodeAudioData(await response.arrayBuffer());
				const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
					buffer.getChannelData(index)
				);
				return createAudioEnvelope(channels, buffer.sampleRate);
			} finally {
				await context.close();
			}
		})();
		return envelopePromise;
	}

	async function loadStandardPositions() {
		if (standardPositionsFor === track.url) return;
		busy = true;
		message = '規定位置を解析中…';
		hasError = false;
		try {
			standardPositions = findStandardPinPositions(await envelope());
			standardPositionsFor = track.url;
			message = '';
		} catch {
			message = '規定位置を解析できませんでした。';
			hasError = true;
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (pinsLoadedFor !== track.filename) void loadPins();
		if (standardPositionsFor !== track.url) void loadStandardPositions();
	});

	async function savePin(sentenceIndex: number, atSeconds: number) {
		const previousPins = track.pins;
		track.pins = upsertPin(track.pins, { sentenceIndex, atSeconds });
		try {
			const response = await fetch('/api/pins', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ filename: track.filename, sentenceIndex, atSeconds })
			});
			if (!response.ok) throw new Error();
			track.pins = ((await response.json()) as { pins: AudioPin[] }).pins;
		} catch {
			track.pins = previousPins;
			throw new Error('保存できませんでした。');
		}
	}

	async function saveCurrentPosition(sentenceIndex: number) {
		const audio = audioElement();
		if (!audio) return;
		await run('現在位置を保存中…', async () => {
			const atSeconds = Math.round(audio.currentTime * 10) / 10;
			await savePin(sentenceIndex, atSeconds);
			return `文${sentenceIndex + 1}: ${formatTime(atSeconds)}に保存しました。`;
		});
	}

	async function updateTime(event: Event, sentenceIndex: number) {
		const input = event.currentTarget as HTMLInputElement;
		if (!input.value || !input.validity.valid) return;
		const atSeconds = Math.round(input.valueAsNumber * 10) / 10;
		await run('ピンを保存中…', async () => {
			await savePin(sentenceIndex, atSeconds);
			return `文${sentenceIndex + 1}: ${formatTime(atSeconds)}に保存しました。`;
		});
	}

	async function alignToSound(pin: AudioPin) {
		await run('音声を解析中…', async () => {
			const result = adjustPinToNextOnset(await envelope(), pin.atSeconds);
			if (!result.ok) {
				throw new Error(result.reason === 'pin-in-sound' ? 'ピン位置ですでに音が出ています。' : '次の音を検出できませんでした。');
			}
			await savePin(pin.sentenceIndex, result.atSeconds);
			return `文${pin.sentenceIndex + 1}: ${formatTime(result.atSeconds)}に調整しました。`;
		});
	}

	async function moveToStandard(pin: AudioPin, direction: PinPositionDirection) {
		const atSeconds = findAdjacentPinPosition(standardPositions, pin.atSeconds, direction);
		if (atSeconds === undefined) return;
		await run('ピンを保存中…', async () => {
			await savePin(pin.sentenceIndex, atSeconds);
			const audio = audioElement();
			if (audio) {
				audio.pause();
				audio.currentTime = atSeconds;
			}
			return `文${pin.sentenceIndex + 1}: ${formatTime(atSeconds)}へ移動しました。`;
		});
	}

	async function deletePin(sentence: TranscriptSentence) {
		if (!window.confirm(`「${sentence.text}」のピンを削除しますか？`)) return;
		await run('ピンを削除中…', async () => {
			const response = await fetch('/api/pins', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ filename: track.filename, sentenceIndex: sentence.index })
			});
			if (!response.ok) throw new Error();
			track.pins = ((await response.json()) as { pins: AudioPin[] }).pins;
			return `文${sentence.index + 1}: 削除しました。`;
		});
	}

	async function run(progress: string, operation: () => Promise<string>) {
		if (busy) return;
		busy = true;
		message = progress;
		hasError = false;
		try {
			message = await operation();
		} catch (error) {
			message = error instanceof Error ? error.message : '操作に失敗しました。';
			hasError = true;
		} finally {
			busy = false;
		}
	}
</script>

<section class="pin-editor" aria-label={`${track.filename} のピン編集`}>
	<div class="editor-heading">
		<strong>ピン編集</strong>
		<span class:error={hasError} aria-live="polite">{message}</span>
	</div>
	{#each sentences as sentence}
		{@const pin = pinFor(sentence.index)}
		<div class="editor-row">
			<span class="sentence-number">文{sentence.index + 1}</span>
			<button type="button" disabled={busy} onclick={() => saveCurrentPosition(sentence.index)}>
				{pin ? '現在位置で更新' : '現在位置を保存'}
			</button>
			<label>
				<span class="visually-hidden">{sentence.text}の秒数</span>
				<input type="number" min="0" step="0.1" placeholder="秒" value={pin?.atSeconds ?? ''} disabled={busy} onchange={(event) => updateTime(event, sentence.index)} />
				<span>秒</span>
			</label>
			{#if pin}
				<button type="button" disabled={busy} onclick={() => alignToSound(pin)}>音に合わせる</button>
				<button type="button" disabled={busy || findAdjacentPinPosition(standardPositions, pin.atSeconds, 'previous') === undefined} onclick={() => moveToStandard(pin, 'previous')}>前の規定位置</button>
				<button type="button" disabled={busy || findAdjacentPinPosition(standardPositions, pin.atSeconds, 'next') === undefined} onclick={() => moveToStandard(pin, 'next')}>次の規定位置</button>
				<button class="delete" type="button" disabled={busy} onclick={() => deletePin(sentence)}>削除</button>
			{/if}
		</div>
	{/each}
</section>

<style>
	.pin-editor { margin-top: 20px; padding: 16px; border: 1px solid #cfcfcf; background: #fafafa; }
	.editor-heading { display: flex; align-items: baseline; gap: 16px; margin-bottom: 12px; }
	.editor-heading span { color: #555; font-size: .78rem; }
	.editor-heading .error, .delete { color: #a32121; }
	.editor-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 0; border-top: 1px solid #e2e2e2; }
	.sentence-number { width: 42px; color: #666; font-size: .76rem; }
	button, input { border: 1px solid #bbb; border-radius: 3px; background: #fff; font: inherit; font-size: .76rem; }
	button { padding: 6px 9px; cursor: pointer; }
	button:disabled { cursor: not-allowed; opacity: .45; }
	label { display: inline-flex; align-items: center; gap: 4px; color: #555; font-size: .76rem; }
	input { width: 76px; padding: 6px; }
	.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
