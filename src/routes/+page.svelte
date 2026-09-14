<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { audioCatalog, type AudioKind, type AudioPin } from '$lib/audio-catalog';
	import {
		adjustPinToNextOnset,
		createAudioEnvelope,
		type AudioEnvelope,
		type PinAdjustmentResult
	} from '$lib/audio-onset';

	type PlayableTrack = {
		url: string;
		filename: string;
		pins: AudioPin[];
	};

	type Lesson = {
		title: string;
		unit: number;
		section: number;
		tracks: Partial<Record<AudioKind, PlayableTrack>>;
	};

	type UnitGroup = {
		unit: number;
		lessons: Lesson[];
	};

	const databaseName = 'english-hanon-audio';
	const storeName = 'settings';
	const directoryKey = 'audio-directory';

	type PermissionCapableDirectoryHandle = FileSystemDirectoryHandle & {
		queryPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
		requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
		values: () => AsyncIterableIterator<FileSystemHandle>;
	};

	let units = $state<UnitGroup[]>([]);
	let directoryHandle = $state<PermissionCapableDirectoryHandle | null>(null);
	let folderName = $state('');
	let phase = $state<'starting' | 'choose' | 'confirm' | 'loading' | 'ready' | 'error'>('starting');
	let errorMessage = $state('');
	let fallbackInput: HTMLInputElement;
	let objectUrls: string[] = [];
	let developmentPins = $state<Record<string, AudioPin[]>>({});
	let pinDrafts = $state<Record<string, string>>({});
	let pinSaveStates = $state<Record<string, 'idle' | 'saving' | 'error'>>({});
	let pinErrors = $state<Record<string, string>>({});
	let pinTimeSaveVersions: Record<string, number> = {};
	let playbackTimes = $state<Record<string, { current: number; duration: number }>>({});
	let lastUsedAudio: HTMLAudioElement | null = null;
	let adjustmentStates = $state<
		Record<string, { busy: boolean; message: string; hasError: boolean }>
	>({});
	const audioEnvelopeCache = new Map<string, Promise<AudioEnvelope>>();
	const isDevelopment = import.meta.env.DEV;

	function openDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(storeName)) {
					request.result.createObjectStore(storeName);
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async function getSavedDirectory(): Promise<PermissionCapableDirectoryHandle | null> {
		const database = await openDatabase();
		return new Promise((resolve, reject) => {
			const request = database.transaction(storeName).objectStore(storeName).get(directoryKey);
			request.onsuccess = () => {
				database.close();
				resolve((request.result as PermissionCapableDirectoryHandle | undefined) ?? null);
			};
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
		});
	}

	async function saveDirectory(handle: PermissionCapableDirectoryHandle): Promise<void> {
		const database = await openDatabase();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(storeName, 'readwrite');
			transaction.objectStore(storeName).put(handle, directoryKey);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	}

	function releaseAudioUrls() {
		lastUsedAudio = null;
		for (const url of objectUrls) URL.revokeObjectURL(url);
		objectUrls = [];
		audioEnvelopeCache.clear();
	}

	function buildUnits(files: File[]): UnitGroup[] {
		const filesByName = new Map<string, File>();
		for (const file of files) {
			if (filesByName.has(file.name)) {
				throw new Error(`同名の音声ファイルが複数あります: ${file.name}`);
			}
			filesByName.set(file.name, file);
		}

		const missingFiles = audioCatalog.flatMap((group) =>
			group.lessons.flatMap((lesson) =>
				lesson.tracks.filter((track) => !filesByName.has(track.filename)).map((track) => track.filename)
			)
		);
		if (missingFiles.length > 0) {
			const remainder = missingFiles.length - 1;
			throw new Error(
				`必要な音声ファイルが見つかりません: ${missingFiles[0]}${remainder > 0 ? `（ほか${remainder}件）` : ''}`
			);
		}

		return audioCatalog.map((group) => ({
			unit: group.unit,
			lessons: group.lessons.map((lesson) => ({
				title: lesson.title,
				unit: lesson.unit,
				section: lesson.section,
				tracks: Object.fromEntries(
					lesson.tracks.map((track) => {
						const url = URL.createObjectURL(filesByName.get(track.filename)!);
						objectUrls.push(url);
						return [
							track.kind,
							{
								url,
								filename: track.filename,
								pins: developmentPins[track.filename] ?? track.pins
							}
						];
					})
				) as Lesson['tracks']
			}))
		}));
	}

	function formatPinTime(atSeconds: number): string {
		const deciseconds = Math.round(atSeconds * 10);
		const minutes = Math.floor(deciseconds / 600);
		const seconds = Math.floor(deciseconds / 10) % 60;
		const tenths = deciseconds % 10;
		return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
	}

	function formatPlaybackTime(secondsValue: number | undefined): string {
		if (secondsValue === undefined || !Number.isFinite(secondsValue)) return '--:--.-';
		return formatPinTime(Math.max(0, secondsValue));
	}

	function updatePlaybackTime(event: Event, filename: string) {
		const audio = event.currentTarget;
		if (!(audio instanceof HTMLAudioElement)) return;
		playbackTimes[filename] = {
			current: audio.currentTime,
			duration: audio.duration
		};
	}

	function rememberAudio(event: Event) {
		const audio = event.currentTarget;
		if (audio instanceof HTMLAudioElement) lastUsedAudio = audio;
	}

	function toggleLastUsedAudio(event: KeyboardEvent) {
		if (event.code !== 'Space') return;
		event.preventDefault();
		if (event.repeat || !lastUsedAudio) return;

		if (lastUsedAudio.paused) {
			void lastUsedAudio.play().catch(() => undefined);
		} else {
			lastUsedAudio.pause();
		}
	}

	async function jumpToPin(event: MouseEvent, pin: AudioPin) {
		const player = (event.currentTarget as HTMLElement).closest('.player');
		const audio = player?.querySelector('audio');
		if (!audio) return;
		audio.currentTime = pin.atSeconds;
		await audio.play().catch(() => undefined);
	}

	async function addPin(event: SubmitEvent, track: PlayableTrack) {
		event.preventDefault();
		const audio = (event.currentTarget as HTMLElement).closest('.player')?.querySelector('audio');
		const label = pinDrafts[track.filename]?.trim();
		if (!audio || !label) return;

		const atSeconds = Math.round(audio.currentTime * 10) / 10;
		pinSaveStates[track.filename] = 'saving';
		pinErrors[track.filename] = '';
		try {
			const response = await fetch('/api/pins', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ filename: track.filename, atSeconds, label })
			});
			if (!response.ok) throw new Error(await response.text());
			const result = (await response.json()) as { pins: AudioPin[] };
			track.pins = result.pins;
			developmentPins[track.filename] = result.pins;
			pinDrafts[track.filename] = '';
			pinSaveStates[track.filename] = 'idle';
		} catch {
			pinSaveStates[track.filename] = 'error';
			pinErrors[track.filename] = 'ピンを保存できませんでした。';
		}
	}

	async function savePinTime(track: PlayableTrack, pin: AudioPin, atSeconds: number) {
		const previousAtSeconds = pin.atSeconds;
		const saveVersion = (pinTimeSaveVersions[track.filename] ?? 0) + 1;
		pinTimeSaveVersions[track.filename] = saveVersion;
		pin.atSeconds = atSeconds;
		track.pins.sort((a, b) => a.atSeconds - b.atSeconds);
		try {
			const response = await fetch('/api/pins', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					filename: track.filename,
					previousAtSeconds,
					atSeconds,
					label: pin.label
				})
			});
			if (!response.ok) throw new Error(await response.text());
			const result = (await response.json()) as { pins: AudioPin[] };
			if (pinTimeSaveVersions[track.filename] !== saveVersion) return;
			const matchesCurrentPins =
				result.pins.length === track.pins.length &&
				result.pins.every(
					(savedPin, index) =>
						savedPin.atSeconds === track.pins[index].atSeconds && savedPin.label === track.pins[index].label
				);
			if (!matchesCurrentPins) track.pins = result.pins;
			developmentPins[track.filename] = result.pins;
		} catch {
			if (pinTimeSaveVersions[track.filename] !== saveVersion) return;
			pin.atSeconds = previousAtSeconds;
			track.pins.sort((a, b) => a.atSeconds - b.atSeconds);
			throw new Error('Pin time could not be saved.');
		}
	}

	async function updatePinTime(event: Event, track: PlayableTrack, pin: AudioPin) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement) || !input.validity.valid) return;

		const atSeconds = Math.round(input.valueAsNumber * 10) / 10;
		if (atSeconds === pin.atSeconds) return;
		pinErrors[track.filename] = '';
		try {
			await savePinTime(track, pin, atSeconds);
		} catch {
			pinErrors[track.filename] = 'ピンの秒数を変更できませんでした。';
		}
	}

	async function getAudioEnvelope(track: PlayableTrack): Promise<AudioEnvelope> {
		const cachedEnvelope = audioEnvelopeCache.get(track.filename);
		if (cachedEnvelope) return cachedEnvelope;

		const envelopePromise = (async () => {
			const response = await fetch(track.url);
			if (!response.ok) throw new Error('Audio could not be read.');
			const context = new AudioContext();
			try {
				const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
				const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
					audioBuffer.getChannelData(index)
				);
				return createAudioEnvelope(channels, audioBuffer.sampleRate);
			} finally {
				await context.close();
			}
		})();
		audioEnvelopeCache.set(track.filename, envelopePromise);
		try {
			return await envelopePromise;
		} catch (error) {
			audioEnvelopeCache.delete(track.filename);
			throw error;
		}
	}

	function adjustmentFailureMessage(pin: AudioPin, result: PinAdjustmentResult): string {
		return result.ok
			? ''
			: result.reason === 'pin-in-sound'
				? `${pin.label}: ピン位置ですでに音が出ています。`
				: `${pin.label}: 次の音を検出できませんでした。`;
	}

	function adjustmentCollision(track: PlayableTrack, pin: AudioPin, atSeconds: number): boolean {
		return track.pins.some((otherPin) => otherPin !== pin && otherPin.atSeconds === atSeconds);
	}

	async function adjustSinglePin(track: PlayableTrack, pin: AudioPin) {
		if (adjustmentStates[track.filename]?.busy) return;
		adjustmentStates[track.filename] = { busy: true, message: '音声を解析中…', hasError: false };
		try {
			const result = adjustPinToNextOnset(await getAudioEnvelope(track), pin.atSeconds);
			if (!result.ok) {
				adjustmentStates[track.filename] = {
					busy: false,
					message: adjustmentFailureMessage(pin, result),
					hasError: true
				};
				return;
			}
			if (adjustmentCollision(track, pin, result.atSeconds)) {
				adjustmentStates[track.filename] = {
					busy: false,
					message: `${pin.label}: 調整先に別のピンがあります。`,
					hasError: true
				};
				return;
			}
			if (result.atSeconds !== pin.atSeconds) await savePinTime(track, pin, result.atSeconds);
			adjustmentStates[track.filename] = {
				busy: false,
				message: `${pin.label}: ${formatPinTime(result.atSeconds)}に調整しました。`,
				hasError: false
			};
		} catch {
			adjustmentStates[track.filename] = {
				busy: false,
				message: `${pin.label}: 音声の解析または保存に失敗しました。`,
				hasError: true
			};
		}
	}

	async function adjustAllPins(track: PlayableTrack) {
		if (adjustmentStates[track.filename]?.busy) return;
		adjustmentStates[track.filename] = { busy: true, message: '音声を解析中…', hasError: false };
		let adjustedCount = 0;
		const failures: string[] = [];
		try {
			const envelope = await getAudioEnvelope(track);
			for (const pin of [...track.pins]) {
				const result = adjustPinToNextOnset(envelope, pin.atSeconds);
				if (!result.ok) {
					failures.push(adjustmentFailureMessage(pin, result));
					continue;
				}
				if (adjustmentCollision(track, pin, result.atSeconds)) {
					failures.push(`${pin.label}: 調整先に別のピンがあります。`);
					continue;
				}
				try {
					if (result.atSeconds !== pin.atSeconds) await savePinTime(track, pin, result.atSeconds);
					adjustedCount += 1;
				} catch {
					failures.push(`${pin.label}: 保存に失敗しました。`);
				}
			}
			adjustmentStates[track.filename] = {
				busy: false,
				message: `${adjustedCount}件を調整しました。${failures.length ? ` ${failures.join(' ')}` : ''}`,
				hasError: failures.length > 0
			};
		} catch {
			adjustmentStates[track.filename] = {
				busy: false,
				message: '音声を解析できませんでした。',
				hasError: true
			};
		}
	}

	async function loadDevelopmentPins() {
		if (!isDevelopment) return;
		const response = await fetch('/api/pins');
		if (response.ok) developmentPins = (await response.json()) as Record<string, AudioPin[]>;
	}

	async function collectAudioFiles(handle: PermissionCapableDirectoryHandle): Promise<File[]> {
		const files: File[] = [];
		for await (const entry of handle.values()) {
			if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
				files.push(await (entry as FileSystemFileHandle).getFile());
			} else if (entry.kind === 'directory') {
				files.push(...(await collectAudioFiles(entry as PermissionCapableDirectoryHandle)));
			}
		}
		return files;
	}

	async function loadDirectory(handle: PermissionCapableDirectoryHandle) {
		phase = 'loading';
		errorMessage = '';
		try {
			let permission = await handle.queryPermission({ mode: 'read' });
			if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'read' });
			if (permission !== 'granted') {
				phase = 'confirm';
				errorMessage = 'フォルダの読み取り許可が必要です。';
				return;
			}
			releaseAudioUrls();
			units = buildUnits(await collectAudioFiles(handle));
			directoryHandle = handle;
			folderName = handle.name;
			phase = 'ready';
		} catch (error) {
			releaseAudioUrls();
			units = [];
			errorMessage = error instanceof Error ? error.message : 'フォルダを読み込めませんでした。';
			phase = 'error';
		}
	}

	async function chooseDirectory() {
		errorMessage = '';
		const picker = (window as Window & {
			showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
		}).showDirectoryPicker;

		if (!picker) {
			fallbackInput.click();
			return;
		}

		try {
			const handle = (await picker.call(window, { mode: 'read' })) as PermissionCapableDirectoryHandle;
			await loadDirectory(handle);
			if (phase === 'ready') await saveDirectory(handle).catch(() => undefined);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			errorMessage = 'フォルダを選択できませんでした。もう一度お試しください。';
			phase = 'error';
		}
	}

	async function loadFallbackFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (!files.length) return;
		folderName = files[0].webkitRelativePath.split('/')[0] || '選択したフォルダ';
		phase = 'loading';
		try {
			releaseAudioUrls();
			units = buildUnits(files);
			phase = 'ready';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'フォルダを読み込めませんでした。';
			phase = 'error';
		}
		input.value = '';
	}

	onMount(async () => {
		await loadDevelopmentPins().catch(() => undefined);
		if (!('showDirectoryPicker' in window)) {
			phase = 'choose';
			return;
		}
		try {
			directoryHandle = await getSavedDirectory();
			if (directoryHandle) {
				folderName = directoryHandle.name;
				phase = 'confirm';
			} else {
				phase = 'choose';
			}
		} catch {
			phase = 'choose';
		}
	});

	onDestroy(releaseAudioUrls);
</script>

<svelte:window onkeydowncapture={toggleLastUsedAudio} />

{#snippet audioPlayer(label: string, track: PlayableTrack, ariaLabel: string)}
	<div class="player">
		<span>{label}</span>
		<audio
			controls
			preload="metadata"
			src={track.url}
			aria-label={ariaLabel}
			onloadedmetadata={(event) => updatePlaybackTime(event, track.filename)}
			ondurationchange={(event) => updatePlaybackTime(event, track.filename)}
			ontimeupdate={(event) => updatePlaybackTime(event, track.filename)}
			onseeking={(event) => updatePlaybackTime(event, track.filename)}
			onpointerdown={rememberAudio}
			onplay={rememberAudio}
			onpause={rememberAudio}
		></audio>
		<output class="playback-time" aria-label={`${ariaLabel} playback time`}>
			{formatPlaybackTime(playbackTimes[track.filename]?.current ?? 0)} / {formatPlaybackTime(
				playbackTimes[track.filename]?.duration
			)}
		</output>
		{#if track.pins.length > 0}
			<div class="pins" aria-label={`${ariaLabel} markers`}>
				{#each track.pins as pin}
					<div class="pin-entry">
						<button class="pin-jump" type="button" onclick={(event) => jumpToPin(event, pin)}>
							<span class="pin-time">{formatPinTime(pin.atSeconds)}</span>
							{pin.label}
						</button>
						{#if isDevelopment}
							<div class="pin-time-editor">
								<label>
									<span class="visually-hidden">{pin.label}の秒数</span>
									<input
										type="number"
										min="0"
										step="0.1"
										value={pin.atSeconds}
										onchange={(event) => updatePinTime(event, track, pin)}
									/>
									<span class="seconds-unit">秒</span>
								</label>
								<button
									class="auto-adjust-pin"
									type="button"
									disabled={adjustmentStates[track.filename]?.busy}
									onclick={() => adjustSinglePin(track, pin)}
								>音に合わせる</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if isDevelopment}
			{#if track.pins.length > 0}
				<div class="track-adjustment">
					<button
						type="button"
						disabled={adjustmentStates[track.filename]?.busy}
						onclick={() => adjustAllPins(track)}
					>
						{adjustmentStates[track.filename]?.busy ? '解析中…' : 'すべてのピンを音に合わせる'}
					</button>
					{#if adjustmentStates[track.filename]?.message}
						<p
							class:adjustment-error={adjustmentStates[track.filename]?.hasError}
							aria-live="polite"
						>
							{adjustmentStates[track.filename].message}
						</p>
					{/if}
				</div>
			{/if}
			<form class="pin-editor" onsubmit={(event) => addPin(event, track)}>
				<input
					type="text"
					maxlength="100"
					placeholder="ピンのラベル"
					aria-label={`${ariaLabel} pin label`}
					bind:value={pinDrafts[track.filename]}
				/>
				<button
					type="submit"
					disabled={!pinDrafts[track.filename]?.trim() || pinSaveStates[track.filename] === 'saving'}
				>
					{pinSaveStates[track.filename] === 'saving' ? '保存中…' : '現在位置にピン'}
				</button>
				{#if pinErrors[track.filename]}
					<p class="pin-error" aria-live="polite">{pinErrors[track.filename]}</p>
				{/if}
			</form>
		{/if}
	</div>
{/snippet}

<svelte:head>
	<title>English Hanon Audio</title>
	<meta name="description" content="English HanonのUnit別Slow・Natural音声プレイヤー" />
</svelte:head>

<main>
	<header class="page-header">
		<div class="header-line">
			<p class="eyebrow">Audio practice</p>
			{#if phase === 'ready'}
				<button class="folder-button" type="button" onclick={chooseDirectory}>
					{folderName} · 変更
				</button>
			{/if}
		</div>
		<h1>English Hanon</h1>
		<p class="introduction">Select a unit and play the track you want to practise.</p>
	</header>

	{#if phase === 'ready'}
		<section class="unit-list" aria-label="English Hanon audio units">
			{#each units as group}
				<details class="unit">
					<summary>
						<span class="unit-name">Unit {group.unit}</span>
						<span class="item-count">{group.lessons.length} tracks</span>
						<span class="chevron" aria-hidden="true"></span>
					</summary>

					<div class="lessons">
						{#each group.lessons as lesson}
							<div class:single-track={group.unit === 0} class="lesson-row">
								<h2>{lesson.title}</h2>

								{#if lesson.tracks.single}
									{@render audioPlayer('Audio', lesson.tracks.single, `${lesson.title} audio`)}
								{/if}

								{#if lesson.tracks.slow}
									{@render audioPlayer('Slow', lesson.tracks.slow, `${lesson.title} slow audio`)}
								{/if}

								{#if lesson.tracks.natural}
									{@render audioPlayer('Natural', lesson.tracks.natural, `${lesson.title} natural audio`)}
								{/if}
							</div>
						{/each}
					</div>
				</details>
			{/each}
		</section>
	{/if}
</main>

<input
	class="fallback-input"
	type="file"
	accept="audio/mpeg,.mp3"
	multiple
	webkitdirectory={true}
	bind:this={fallbackInput}
	onchange={loadFallbackFiles}
/>

{#if phase !== 'ready'}
	<div class="folder-dialog-backdrop">
		<div class="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-title">
			<p class="dialog-eyebrow">Audio source</p>
			{#if phase === 'starting'}
				<h2 id="folder-title">保存したフォルダを確認中…</h2>
			{:else if phase === 'confirm'}
				<h2 id="folder-title">このフォルダでいいですか？</h2>
				<p class="folder-name">{folderName}</p>
				<p class="dialog-copy">前回選択したフォルダから音声を読み込みます。</p>
				{#if errorMessage}<p class="error-message">{errorMessage}</p>{/if}
				<div class="dialog-actions">
					<button class="primary-action" type="button" onclick={() => directoryHandle && loadDirectory(directoryHandle)}>このフォルダを使う</button>
					<button class="secondary-action" type="button" onclick={chooseDirectory}>別のフォルダを選ぶ</button>
				</div>
			{:else if phase === 'loading'}
				<h2 id="folder-title">音声を読み込んでいます…</h2>
				<p class="dialog-copy">フォルダ内のMP3ファイルを準備しています。</p>
			{:else}
				<h2 id="folder-title">音声フォルダを選択してください</h2>
				<p class="dialog-copy">MP3ファイルはブラウザ内でのみ読み込みます。外部には送信されません。</p>
				{#if errorMessage}<p class="error-message">{errorMessage}</p>{/if}
				<button class="primary-action" type="button" onclick={chooseDirectory}>フォルダを選択</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		color: #111;
		background: #fff;
	}

	:global(body) {
		margin: 0;
	}

	main {
		width: min(100% - 40px, 1120px);
		margin: 0 auto;
		padding: 72px 0 96px;
	}

	.page-header {
		margin-bottom: 56px;
	}

	.header-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 12px;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.folder-button {
		max-width: min(50vw, 360px);
		padding: 6px 0;
		overflow: hidden;
		border: 0;
		background: transparent;
		color: #555;
		font: inherit;
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.folder-button:hover {
		color: #111;
		text-decoration: underline;
	}

	h1 {
		margin: 0;
		font-size: clamp(2.7rem, 8vw, 5.5rem);
		font-weight: 500;
		letter-spacing: -0.065em;
		line-height: 0.95;
	}

	.introduction {
		max-width: 560px;
		margin: 24px 0 0;
		color: #555;
		font-size: 0.95rem;
		line-height: 1.6;
	}

	.unit-list {
		border-top: 1px solid #111;
	}

	.unit {
		border-bottom: 1px solid #111;
	}

	summary {
		display: grid;
		grid-template-columns: 1fr auto 18px;
		align-items: center;
		gap: 24px;
		min-height: 78px;
		padding: 0 4px;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:focus-visible {
		outline: 2px solid #111;
		outline-offset: -2px;
	}

	.unit-name {
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.025em;
	}

	.item-count {
		color: #666;
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.chevron {
		width: 10px;
		height: 10px;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: rotate(45deg) translate(-2px, -2px);
		transition: transform 160ms ease;
	}

	.unit[open] .chevron {
		transform: rotate(225deg) translate(-1px, -1px);
	}

	.lessons {
		border-top: 1px solid #d5d5d5;
	}

	.lesson-row {
		display: grid;
		grid-template-columns: 78px minmax(0, 1fr) minmax(0, 1fr);
		gap: 28px;
		align-items: center;
		padding: 22px 4px;
		border-bottom: 1px solid #e5e5e5;
	}

	.lesson-row:last-child {
		border-bottom: 0;
	}

	.lesson-row.single-track {
		grid-template-columns: 78px minmax(0, 1fr);
	}

	h2 {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.player {
		display: grid;
		grid-template-columns: 54px minmax(0, 1fr);
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.player span {
		color: #666;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.playback-time {
		grid-column: 2;
		margin-top: -7px;
		color: #555;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}

	.pins {
		display: flex;
		grid-column: 2;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pin-entry {
		display: flex;
		align-items: flex-start;
		flex-direction: column;
		gap: 5px;
	}

	.pins .pin-jump {
		padding: 6px 9px;
		border: 1px solid #c8c8c8;
		border-radius: 999px;
		background: #fff;
		color: #222;
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
	}

	.pins .pin-jump:hover {
		border-color: #111;
		background: #f5f5f5;
	}

	.pins .pin-time {
		margin-right: 5px;
		color: #666;
		font-size: inherit;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0;
		text-transform: none;
	}

	.pin-time-editor {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.pin-time-editor label {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.pin-time-editor input {
		width: 68px;
		height: 30px;
		padding: 0 5px;
		border: 1px solid #bbb;
		font: inherit;
		font-size: 0.74rem;
		font-variant-numeric: tabular-nums;
	}

	.pin-time-editor .seconds-unit {
		color: #666;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}

	.pin-time-editor .auto-adjust-pin,
	.track-adjustment button {
		min-height: 30px;
		padding: 0 8px;
		border: 1px solid #999;
		background: #fff;
		color: #222;
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.pin-time-editor .auto-adjust-pin:hover,
	.track-adjustment button:hover {
		border-color: #111;
	}

	.pin-time-editor .auto-adjust-pin:disabled,
	.track-adjustment button:disabled {
		color: #777;
		cursor: default;
	}

	.track-adjustment {
		display: flex;
		grid-column: 2;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}

	.track-adjustment p {
		margin: 0;
		color: #555;
		font-size: 0.72rem;
		line-height: 1.5;
	}

	.track-adjustment p.adjustment-error {
		color: #a12618;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.pin-editor {
		display: grid;
		grid-column: 2;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 6px;
	}

	.pin-editor input,
	.pin-editor button {
		min-height: 34px;
		border: 1px solid #bbb;
		background: #fff;
		font: inherit;
		font-size: 0.76rem;
	}

	.pin-editor input {
		min-width: 0;
		padding: 0 10px;
	}

	.pin-editor button {
		padding: 0 11px;
		border-color: #111;
		background: #111;
		color: #fff;
		font-weight: 650;
		cursor: pointer;
	}

	.pin-editor button:disabled {
		border-color: #aaa;
		background: #aaa;
		cursor: default;
	}

	.pin-error {
		grid-column: 1 / -1;
		margin: 0;
		color: #a12618;
		font-size: 0.72rem;
	}

	audio {
		display: block;
		width: 100%;
		min-width: 0;
		height: 38px;
	}

	.fallback-input {
		display: none;
	}

	.folder-dialog-backdrop {
		position: fixed;
		z-index: 10;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgb(255 255 255 / 88%);
		backdrop-filter: blur(8px);
	}

	.folder-dialog {
		width: min(100%, 520px);
		padding: 42px;
		border: 1px solid #111;
		background: #fff;
		box-shadow: 12px 12px 0 #111;
	}

	.dialog-eyebrow {
		margin: 0 0 18px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.folder-dialog h2 {
		margin: 0;
		font-size: clamp(1.6rem, 5vw, 2.25rem);
		font-weight: 550;
		letter-spacing: -0.04em;
		line-height: 1.2;
	}

	.folder-name {
		margin: 24px 0 0;
		padding: 14px 16px;
		overflow: hidden;
		border: 1px solid #bbb;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dialog-copy,
	.error-message {
		margin: 18px 0 0;
		color: #555;
		font-size: 0.88rem;
		line-height: 1.7;
	}

	.error-message {
		color: #a12618;
	}

	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 28px;
	}

	.primary-action,
	.secondary-action {
		min-height: 46px;
		padding: 0 18px;
		border: 1px solid #111;
		font: inherit;
		font-size: 0.84rem;
		font-weight: 650;
		cursor: pointer;
	}

	.primary-action {
		margin-top: 28px;
		background: #111;
		color: #fff;
	}

	.dialog-actions .primary-action {
		margin-top: 0;
	}

	.secondary-action {
		background: #fff;
		color: #111;
	}

	.primary-action:hover {
		background: #333;
	}

	.secondary-action:hover {
		background: #f2f2f2;
	}

	button:focus-visible {
		outline: 2px solid #2864dc;
		outline-offset: 3px;
	}

	@media (max-width: 760px) {
		main {
			width: min(100% - 28px, 1120px);
			padding: 48px 0 72px;
		}

		.page-header {
			margin-bottom: 40px;
		}

		.folder-dialog {
			padding: 30px 24px;
			box-shadow: 8px 8px 0 #111;
		}

		.dialog-actions {
			flex-direction: column;
		}

		summary {
			min-height: 68px;
			gap: 14px;
		}

		.lesson-row,
		.lesson-row.single-track {
			grid-template-columns: 1fr;
			gap: 16px;
			padding: 22px 4px 26px;
		}

		.player {
			grid-template-columns: 1fr;
			gap: 7px;
		}

		.player span {
			padding-left: 2px;
		}

		.playback-time,
		.pins,
		.track-adjustment,
		.pin-editor {
			grid-column: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
