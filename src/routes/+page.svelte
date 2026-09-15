<script lang="ts">
	import { onDestroy, onMount, type Component } from 'svelte';
	import { audioCatalog, type AudioKind, type AudioPin } from '$lib/audio-catalog';
	import {
		deleteLibrary,
		getLibraryManifest,
		importLibrary,
		readLibraryFiles,
		type ImportSource,
		type LocalLibraryManifest
	} from '$lib/local-library';
	import { lessonId, parseTranscript, type TranscriptSentence } from '$lib/transcript';
	import type { PlayableTrack } from '$lib/player-types';
	import {
		availableStorageBytes,
		formatBytes,
		hasStorageCapacity
	} from '$lib/storage-capacity';
	import {
		isAudioFilename,
		isTranscriptFilename,
		selectFallbackImportFiles
	} from '$lib/import-source';

	type Lesson = {
		title: string;
		unit: number;
		section: number;
		tracks: Partial<Record<AudioKind, PlayableTrack>>;
		transcript?: TranscriptSentence[];
	};

	type UnitGroup = {
		unit: number;
		lessons: Lesson[];
	};

	type PermissionCapableDirectoryHandle = FileSystemDirectoryHandle & {
		values: () => AsyncIterableIterator<FileSystemHandle>;
	};

	type CollectedImportFiles = {
		audioFiles: File[];
		transcriptFile?: File;
	};

	type ImportPreview = {
		audioCount: number;
		transcriptCount: number;
		transcriptLessonCount: number;
		unknownLessonIds: string[];
		totalBytes: number;
		availableBytes?: number;
		hasEnoughSpace: boolean;
		isReplacement: boolean;
	};

	let units = $state<UnitGroup[]>([]);
	let folderName = $state('');
	let phase = $state<
		'starting' | 'choose' | 'scanning' | 'review' | 'importing' | 'ready' | 'error'
	>('starting');
	let errorMessage = $state('');
	let fallbackInput: HTMLInputElement;
	let currentManifest = $state<LocalLibraryManifest | null>(null);
	let pendingImport = $state<ImportSource | null>(null);
	let importPreview = $state<ImportPreview | null>(null);
	let objectUrls: string[] = [];
	let selectedTrackKinds = $state<Record<string, 'slow' | 'natural'>>({});
	let transcriptOpenStates = $state<Record<string, boolean>>({});
	let lastUsedAudio: HTMLAudioElement | null = null;
	const isDevelopment = import.meta.env.DEV;
	let mode = $state<'view' | 'edit'>('view');
	let PinEditor = $state<Component<{
		track: PlayableTrack;
		sentences: TranscriptSentence[];
	}> | null>(null);
	const expectedAudioFilenames = audioCatalog.flatMap((group) =>
		group.lessons.flatMap((lesson) => lesson.tracks.map((track) => track.filename))
	);
	const knownLessonIds = new Set(
		audioCatalog.flatMap((group) =>
			group.lessons.map((lesson) => lessonId(lesson.unit, lesson.section))
		)
	);

	function releaseAudioUrls() {
		lastUsedAudio = null;
		transcriptOpenStates = {};
		for (const url of objectUrls) URL.revokeObjectURL(url);
		objectUrls = [];
	}

	function buildUnits(
		files: File[],
		transcripts: Record<string, TranscriptSentence[]> = {}
	): UnitGroup[] {
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
				transcript: transcripts[lessonId(lesson.unit, lesson.section)],
				tracks: Object.fromEntries(
					lesson.tracks.map((track) => {
						const url = URL.createObjectURL(filesByName.get(track.filename)!);
						objectUrls.push(url);
						return [
							track.kind,
							{
								url,
								filename: track.filename,
								pins: track.pins
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

	function rememberAudio(event: Event) {
		const audio = event.currentTarget;
		if (audio instanceof HTMLAudioElement) lastUsedAudio = audio;
	}

	function pauseOtherAudios(activeAudio: HTMLAudioElement) {
		for (const audio of document.querySelectorAll('audio')) {
			if (audio !== activeAudio && !audio.paused) audio.pause();
		}
	}

	function handleAudioPlay(event: Event) {
		const audio = event.currentTarget;
		if (!(audio instanceof HTMLAudioElement)) return;
		pauseOtherAudios(audio);
		lastUsedAudio = audio;
	}

	function finishSeeking(event: Event) {
		const audio = event.currentTarget;
		if (!(audio instanceof HTMLAudioElement)) return;
		lastUsedAudio = audio;
		audio.blur();
	}

	function toggleLastUsedAudio(event: KeyboardEvent) {
		if (event.code !== 'Space') return;
		if (isKeyboardControlTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat || !lastUsedAudio) return;

		if (lastUsedAudio.paused) {
			void lastUsedAudio.play().catch(() => undefined);
		} else {
			lastUsedAudio.pause();
		}
	}

	function preventSpaceDefault(event: KeyboardEvent) {
		if (event.code !== 'Space') return;
		if (isKeyboardControlTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
	}

	function isKeyboardControlTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement &&
				(target.isContentEditable || target.closest('button, audio, [role="button"]') !== null))
		);
	}

	function audioForTrack(track: PlayableTrack): HTMLAudioElement | null {
		for (const audio of document.querySelectorAll<HTMLAudioElement>('audio[data-filename]')) {
			if (audio.dataset.filename === track.filename) return audio;
		}
		return null;
	}

	function selectedTrack(lesson: Lesson): PlayableTrack | undefined {
		if (lesson.tracks.single) return lesson.tracks.single;
		return lesson.tracks[selectedTrackKinds[lessonId(lesson.unit, lesson.section)] ?? 'slow'];
	}

	function selectTrack(lesson: Lesson, kind: 'slow' | 'natural') {
		const key = lessonId(lesson.unit, lesson.section);
		selectedTrackKinds[key] = kind;
	}

	function pinFor(track: PlayableTrack, sentenceIndex: number): AudioPin | undefined {
		return track.pins.find((pin) => pin.sentenceIndex === sentenceIndex);
	}

	function isWithin(target: EventTarget | null, selector: string): boolean {
		return target instanceof Element && target.closest(selector) !== null;
	}

	function toggleTranscript(event: MouseEvent | KeyboardEvent, lesson: Lesson) {
		if (!lesson.transcript) return;
		if (event instanceof KeyboardEvent) {
			if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
		} else if (isWithin(event.target, 'audio, button, input, label, .transcript')) {
			return;
		}
		const key = lessonId(lesson.unit, lesson.section);
		transcriptOpenStates[key] = !transcriptOpenStates[key];
	}

	function activateSentence(
		event: MouseEvent | KeyboardEvent,
		track: PlayableTrack,
		pin: AudioPin
	) {
		if (event instanceof KeyboardEvent) {
			if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
		}
		void jumpToPin(track, pin);
	}

	async function jumpToPin(track: PlayableTrack, pin: AudioPin) {
		const audio = audioForTrack(track);
		if (!audio) return;
		pauseOtherAudios(audio);
		audio.currentTime = pin.atSeconds;
		await audio.play().catch(() => undefined);
	}

	async function selectMode(nextMode: 'view' | 'edit') {
		if (!isDevelopment || nextMode === 'view') {
			mode = 'view';
			return;
		}
		PinEditor ??= (await import('../dev/PinEditor.svelte')).default;
		mode = 'edit';
	}

	async function collectImportFiles(
		handle: PermissionCapableDirectoryHandle,
		includeTranscript = true
	): Promise<CollectedImportFiles> {
		const audioFiles: File[] = [];
		let transcriptFile: File | undefined;
		for await (const entry of handle.values()) {
			if (entry.kind === 'file' && isAudioFilename(entry.name)) {
				audioFiles.push(await (entry as FileSystemFileHandle).getFile());
			} else if (entry.kind === 'file' && includeTranscript && isTranscriptFilename(entry.name)) {
				transcriptFile = await (entry as FileSystemFileHandle).getFile();
			} else if (entry.kind === 'directory') {
				const nested = await collectImportFiles(entry as PermissionCapableDirectoryHandle, false);
				audioFiles.push(...nested.audioFiles);
			}
		}
		return { audioFiles, transcriptFile };
	}

	async function decodeUtf8(file: File): Promise<string> {
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
		} catch {
			throw new Error(`${file.name} をUTF-8テキストとして読み込めませんでした。`);
		}
	}

	async function prepareImport(source: CollectedImportFiles, selectedFolderName: string) {
		phase = 'scanning';
		errorMessage = '';
		try {
			const audioFilesByName = new Map<string, File>();
			for (const file of source.audioFiles) {
				if (audioFilesByName.has(file.name)) {
					throw new Error(`同名の音声ファイルが複数あります: ${file.name}`);
				}
				audioFilesByName.set(file.name, file);
			}
			const missingFiles = expectedAudioFilenames.filter((filename) => !audioFilesByName.has(filename));
			if (missingFiles.length) {
				throw new Error(
					`必要な音声ファイルが見つかりません: ${missingFiles[0]}${missingFiles.length > 1 ? `（ほか${missingFiles.length - 1}件）` : ''}`
				);
			}

			const transcriptFile = source.transcriptFile;
			const transcriptText = transcriptFile ? await decodeUtf8(transcriptFile) : undefined;
			const parsedTranscript = transcriptText
				? parseTranscript(transcriptText, knownLessonIds)
				: { transcripts: {}, unknownLessonIds: [] };
			const audioFiles = expectedAudioFilenames.map((filename) => audioFilesByName.get(filename)!);
			const totalBytes =
				audioFiles.reduce((total, file) => total + file.size, 0) + (transcriptFile?.size ?? 0);
			const estimate: StorageEstimate = await navigator.storage.estimate().catch(() => ({}));
			const availableBytes = availableStorageBytes(estimate);

			pendingImport = {
				folderName: selectedFolderName,
				audioFiles,
				transcriptFile
			};
			importPreview = {
				audioCount: audioFiles.length,
				transcriptCount: transcriptFile ? 1 : 0,
				transcriptLessonCount: Object.keys(parsedTranscript.transcripts).length,
				unknownLessonIds: parsedTranscript.unknownLessonIds,
				totalBytes,
				availableBytes,
				hasEnoughSpace: hasStorageCapacity(totalBytes, availableBytes),
				isReplacement: currentManifest !== null
			};
			folderName = selectedFolderName;
			phase = 'review';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'フォルダを読み込めませんでした。';
			phase = 'error';
		}
	}

	async function loadStoredLibrary(manifest: LocalLibraryManifest) {
		const stored = await readLibraryFiles(manifest);
		const transcripts = stored.transcriptText
			? parseTranscript(stored.transcriptText, knownLessonIds).transcripts
			: {};
		releaseAudioUrls();
		units = buildUnits(stored.audioFiles, transcripts);
		currentManifest = manifest;
		folderName = manifest.folderName;
		phase = 'ready';
	}

	async function confirmImport() {
		if (!pendingImport || !importPreview?.hasEnoughSpace) return;
		phase = 'importing';
		errorMessage = '';
		try {
			await navigator.storage.persist?.().catch(() => false);
			await loadStoredLibrary(await importLibrary(pendingImport));
			pendingImport = null;
			importPreview = null;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : '教材を端末に保存できませんでした。';
			phase = 'error';
		}
	}

	function cancelImport() {
		pendingImport = null;
		importPreview = null;
		phase = currentManifest ? 'ready' : 'choose';
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
			await prepareImport(await collectImportFiles(handle), handle.name);
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
		await prepareImport(
			selectFallbackImportFiles(files),
			files[0].webkitRelativePath.split('/')[0] || '選択したフォルダ'
		);
		input.value = '';
	}

	async function removeStoredLibrary() {
		if (!window.confirm('この端末に保存した音声と文字起こしを削除しますか？')) return;
		try {
			releaseAudioUrls();
			await deleteLibrary();
			units = [];
			currentManifest = null;
			folderName = '';
			phase = 'choose';
		} catch {
			errorMessage = '端末内の教材を削除できませんでした。';
			phase = 'error';
		}
	}

	onMount(async () => {
		try {
			if (!navigator.storage?.getDirectory) {
				throw new Error('このブラウザは端末内への教材保存に対応していません。');
			}
			const manifest = await getLibraryManifest();
			if (manifest) await loadStoredLibrary(manifest);
			else phase = 'choose';
		} catch {
			errorMessage = '保存済みの教材を読み込めませんでした。再度フォルダを選択してください。';
			currentManifest = null;
			phase = 'error';
		}
	});

	onDestroy(releaseAudioUrls);
</script>

<svelte:window
	onkeydowncapture={toggleLastUsedAudio}
	onkeyupcapture={preventSpaceDefault}
/>

{#snippet audioPlayer(label: string, track: PlayableTrack, ariaLabel: string)}
	<div class="player">
		<span>{label}</span>
		<audio
			controls
			preload="metadata"
			src={track.url}
			data-filename={track.filename}
			aria-label={ariaLabel}
			onseeking={rememberAudio}
			onseeked={finishSeeking}
			onpointerdown={rememberAudio}
			onplay={handleAudioPlay}
			onpause={rememberAudio}
		></audio>
	</div>
{/snippet}

<svelte:head>
	<title>English Hanon Audio</title>
	<meta name="description" content="English Hanonの音声と文字起こしを端末内で利用できるプレイヤー" />
</svelte:head>

<main>
	<header class="page-header">
		<div class="header-line">
			<p class="eyebrow">Audio practice</p>
			{#if phase === 'ready'}
				<div class="library-actions">
					{#if isDevelopment}
						<div class="mode-toggle" role="group" aria-label="表示モード">
							<button class:active={mode === 'view'} type="button" aria-pressed={mode === 'view'} onclick={() => selectMode('view')}>閲覧</button>
							<button class:active={mode === 'edit'} type="button" aria-pressed={mode === 'edit'} onclick={() => selectMode('edit')}>編集</button>
						</div>
					{/if}
					<span class="folder-name-inline">{folderName}</span>
					<button class="folder-button" type="button" onclick={chooseDirectory}>教材を更新</button>
					<button class="folder-button delete-library-button" type="button" onclick={removeStoredLibrary}
						>削除</button
					>
				</div>
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
						<span class="item-count">{group.lessons.length} sections</span>
						<span class="chevron" aria-hidden="true"></span>
					</summary>

					<div class="lessons">
						{#each group.lessons as lesson}
							{@const activeTrack = selectedTrack(lesson)}
							{@const transcriptKey = lessonId(lesson.unit, lesson.section)}
							<div class="lesson-row">
								<div
									class:single-track={group.unit === 0}
									class:has-transcript={lesson.transcript}
									class="lesson-overview"
									role="button"
									tabindex={lesson.transcript ? 0 : -1}
									aria-disabled={!lesson.transcript}
									aria-expanded={lesson.transcript ? Boolean(transcriptOpenStates[transcriptKey]) : undefined}
									onclick={(event) => toggleTranscript(event, lesson)}
									onkeydown={(event) => toggleTranscript(event, lesson)}
								>
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

								{#if lesson.transcript && transcriptOpenStates[transcriptKey]}
									<div class="transcript">
										<p class="transcript-label">文字起こし</p>
										{#if lesson.tracks.slow && lesson.tracks.natural}
											<div class="track-toggle" role="group" aria-label={`${lesson.title} 再生音源`}>
												<button
													type="button"
													class:active={(selectedTrackKinds[lessonId(lesson.unit, lesson.section)] ?? 'slow') === 'slow'}
													aria-pressed={(selectedTrackKinds[lessonId(lesson.unit, lesson.section)] ?? 'slow') === 'slow'}
													onclick={() => selectTrack(lesson, 'slow')}
												>Slow</button>
												<button
													type="button"
													class:active={selectedTrackKinds[lessonId(lesson.unit, lesson.section)] === 'natural'}
													aria-pressed={selectedTrackKinds[lessonId(lesson.unit, lesson.section)] === 'natural'}
													onclick={() => selectTrack(lesson, 'natural')}
												>Natural</button>
											</div>
										{/if}
										<div class="transcript-body">
											{#each lesson.transcript as sentence}
												{@const pin = activeTrack ? pinFor(activeTrack, sentence.index) : undefined}
												<div
													class:clickable={activeTrack && pin}
													class="transcript-sentence"
													style={`padding-left: ${sentence.depth * 22}px`}
													role="button"
													tabindex={activeTrack && pin ? 0 : -1}
													aria-disabled={!activeTrack || !pin}
													onclick={(event) => activeTrack && pin && activateSentence(event, activeTrack, pin)}
													onkeydown={(event) => activeTrack && pin && activateSentence(event, activeTrack, pin)}
												>
													<div class="sentence-line">
														<span class="sentence-bullet" aria-hidden="true">–</span>
														{#if activeTrack && pin}
															<span class="sentence-jump">
																<span class="sentence-time">{formatPinTime(pin.atSeconds)}</span>
																<span>{sentence.text}</span>
															</span>
														{:else}
															<span class="sentence-text">{sentence.text}</span>
														{/if}
													</div>
											</div>
										{/each}
									</div>
										{#if mode === 'edit' && PinEditor && activeTrack}
											<PinEditor track={activeTrack} sentences={lesson.transcript} />
										{/if}
									</div>
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
	accept="audio/mpeg,.mp3,text/plain,.txt"
	multiple
	webkitdirectory={true}
	bind:this={fallbackInput}
	onchange={loadFallbackFiles}
/>

{#if phase !== 'ready'}
	<div class="folder-dialog-backdrop">
		<div class="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-title">
			<p class="dialog-eyebrow">Local library</p>
			{#if phase === 'starting'}
				<h2 id="folder-title">保存済みの教材を確認中…</h2>
			{:else if phase === 'scanning'}
				<h2 id="folder-title">教材を確認しています…</h2>
				<p class="dialog-copy">まだ端末内へのコピーは開始していません。</p>
			{:else if phase === 'review' && importPreview}
				<h2 id="folder-title">端末に保存しますか？</h2>
				<p class="folder-name">{folderName}</p>
				<dl class="storage-summary">
					<div><dt>音声</dt><dd>{importPreview.audioCount}ファイル</dd></div>
					<div><dt>文字起こし</dt><dd>{importPreview.transcriptCount ? `${importPreview.transcriptLessonCount}レッスン` : 'なし'}</dd></div>
					<div class="storage-total"><dt>今回保存する容量</dt><dd>{formatBytes(importPreview.totalBytes)}</dd></div>
					<div><dt>ブラウザの利用可能容量</dt><dd>{formatBytes(importPreview.availableBytes)}</dd></div>
				</dl>
				<p class="dialog-copy">
					音声と文字起こしはこの端末のブラウザ内だけに保存され、外部には送信されません。
					{#if importPreview.isReplacement} 更新中は新旧データが一時的に共存するため、上記容量が追加で必要です。{/if}
				</p>
				{#if importPreview.unknownLessonIds.length}
					<p class="warning-message">
						カタログにない見出しは無視されます: {importPreview.unknownLessonIds.join(', ')}
					</p>
				{/if}
				{#if !importPreview.hasEnoughSpace}
					<p class="error-message">利用可能容量が不足しているため保存できません。</p>
				{:else if importPreview.availableBytes === undefined}
					<p class="warning-message">利用可能容量を取得できませんでした。保存中に容量不足となる場合があります。</p>
				{/if}
				<div class="dialog-actions">
					<button class="primary-action" type="button" disabled={!importPreview.hasEnoughSpace} onclick={confirmImport}
						>{importPreview.isReplacement ? '更新する' : '取り込む'}</button
					>
					<button class="secondary-action" type="button" onclick={cancelImport}>キャンセル</button>
				</div>
			{:else if phase === 'importing'}
				<h2 id="folder-title">端末に保存しています…</h2>
				<p class="dialog-copy">この画面を閉じずにお待ちください。</p>
			{:else}
				<h2 id="folder-title">教材フォルダを選択してください</h2>
				<p class="dialog-copy">MP3と、フォルダ直下の transcript.txt を選択できます。文字起こしの見出しは「[Unit 0.1]」形式です。容量を確認したあと、許可した場合だけ端末内に保存します。</p>
				{#if errorMessage}<p class="error-message">{errorMessage}</p>{/if}
				<div class="dialog-actions">
					<button class="primary-action" type="button" onclick={chooseDirectory}>フォルダを選択</button>
					{#if currentManifest}
						<button class="secondary-action" type="button" onclick={() => (phase = 'ready')}>戻る</button>
					{/if}
				</div>
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

	.library-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		min-width: 0;
	}

	.mode-toggle {
		display: flex;
		border: 1px solid #aaa;
		border-radius: 999px;
		overflow: hidden;
	}

	.mode-toggle button {
		padding: 5px 10px;
		border: 0;
		background: #fff;
		color: #555;
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
	}

	.mode-toggle button + button {
		border-left: 1px solid #aaa;
	}

	.mode-toggle button.active {
		background: #111;
		color: #fff;
	}

	.folder-name-inline {
		max-width: min(32vw, 280px);
		overflow: hidden;
		color: #555;
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.folder-button {
		padding: 6px 0;
		border: 0;
		background: transparent;
		color: #555;
		font: inherit;
		font-size: 0.78rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.folder-button:hover {
		color: #111;
		text-decoration: underline;
	}

	.delete-library-button {
		color: #9d2222;
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

	.unit > summary {
		display: grid;
		grid-template-columns: 1fr auto 18px;
		align-items: center;
		gap: 24px;
		min-height: 78px;
		padding: 0 4px;
		cursor: pointer;
		list-style: none;
	}

	.unit > summary::-webkit-details-marker {
		display: none;
	}

	.unit > summary:focus-visible {
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
		padding: 22px 4px;
		border-bottom: 1px solid #e5e5e5;
	}

	.lesson-overview {
		display: grid;
		grid-template-columns: 78px minmax(0, 1fr) minmax(0, 1fr);
		gap: 28px;
		align-items: center;
	}

	.lesson-row:last-child {
		border-bottom: 0;
	}

	.lesson-overview.single-track {
		grid-template-columns: 78px minmax(0, 1fr);
	}

	.lesson-overview.has-transcript {
		cursor: pointer;
	}

	.lesson-overview.has-transcript:focus-visible {
		outline: 2px solid #2864dc;
		outline-offset: -2px;
	}

	.lesson-overview.has-transcript audio {
		cursor: auto;
	}

	.transcript {
		margin-top: 22px;
		margin-left: 106px;
		border-top: 1px solid #e5e5e5;
	}

	.transcript-label {
		margin: 0;
		padding: 10px 0 2px;
		color: #444;
		font-size: 0.78rem;
		font-weight: 650;
	}

	.transcript-body {
		max-width: 920px;
		padding: 14px 0 4px;
		color: #222;
		font-size: 0.92rem;
		line-height: 1.6;
	}

	.track-toggle {
		display: inline-flex;
		margin-top: 12px;
		border: 1px solid #aaa;
		border-radius: 999px;
		overflow: hidden;
	}

	.track-toggle button {
		min-width: 76px;
		padding: 6px 14px;
		border: 0;
		background: #fff;
		color: #555;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 650;
		cursor: pointer;
	}

	.track-toggle button + button {
		border-left: 1px solid #aaa;
	}

	.track-toggle button.active {
		background: #111;
		color: #fff;
	}

	.transcript-sentence {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		column-gap: 16px;
		padding-top: 8px;
		padding-bottom: 8px;
		border-top: 1px solid #ededed;
	}

	.transcript-sentence.clickable {
		cursor: pointer;
	}

	.transcript-sentence.clickable:hover .sentence-jump > span:last-child {
		text-decoration: underline;
	}

	.transcript-sentence.clickable:focus-visible {
		border-radius: 2px;
		outline: 2px solid #2864dc;
		outline-offset: 2px;
	}

	.sentence-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}

	.sentence-bullet {
		flex: 0 0 auto;
		color: #888;
	}

	.sentence-text {
		min-width: 0;
	}

	.sentence-jump {
		display: inline-flex;
		align-items: baseline;
		gap: 9px;
		min-width: 0;
		color: #174ea6;
	}

	.sentence-time {
		flex: 0 0 auto;
		color: #666;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
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
	.error-message,
	.warning-message {
		margin: 18px 0 0;
		color: #555;
		font-size: 0.88rem;
		line-height: 1.7;
	}

	.error-message {
		color: #a12618;
	}

	.warning-message {
		color: #765500;
	}

	.storage-summary {
		margin: 24px 0 0;
		border-top: 1px solid #ccc;
	}

	.storage-summary div {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		padding: 10px 0;
		border-bottom: 1px solid #ddd;
	}

	.storage-summary dt,
	.storage-summary dd {
		margin: 0;
		font-size: 0.82rem;
	}

	.storage-summary dd {
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.storage-summary .storage-total {
		font-weight: 700;
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

	.primary-action:disabled {
		border-color: #aaa;
		background: #aaa;
		cursor: not-allowed;
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

		.unit > summary {
			min-height: 68px;
			gap: 14px;
		}

		.lesson-overview,
		.lesson-overview.single-track {
			grid-template-columns: 1fr;
			gap: 16px;
		}

		.lesson-row {
			padding: 22px 4px 26px;
		}

		.transcript {
			margin-left: 0;
		}

		.transcript-sentence {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 7px;
		}

		.player {
			grid-template-columns: 1fr;
			gap: 7px;
		}

		.player span {
			padding-left: 2px;
		}

	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
