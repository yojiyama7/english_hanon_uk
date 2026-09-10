<script lang="ts">
	type AudioKind = 'single' | 'slow' | 'natural';

	type Lesson = {
		unit: number;
		item: number;
		single?: string;
		slow?: string;
		natural?: string;
	};

	type UnitGroup = {
		unit: number;
		lessons: Lesson[];
	};

	const audioFiles = import.meta.glob('../../english_hanon_mp3/*.mp3', {
		eager: true,
		query: '?url',
		import: 'default'
	}) as Record<string, string>;

	const filenamePattern = /^\d+_RP_Unit (\d+)\.(\d+)(?:_(slow|natural))?\.mp3$/;
	const lessonMap = new Map<string, Lesson>();

	for (const [path, url] of Object.entries(audioFiles)) {
		const filename = path.split('/').at(-1) ?? '';
		const match = filename.match(filenamePattern);

		if (!match) {
			throw new Error(`Unexpected audio filename: ${filename}`);
		}

		const unit = Number(match[1]);
		const item = Number(match[2]);
		const kind = (match[3] ?? 'single') as AudioKind;
		const key = `${unit}.${item}`;
		const lesson = lessonMap.get(key) ?? { unit, item };

		if (lesson[kind]) {
			throw new Error(`Duplicate ${kind} audio for Unit ${key}`);
		}

		lesson[kind] = url;
		lessonMap.set(key, lesson);
	}

	for (const lesson of lessonMap.values()) {
		const isComplete =
			lesson.unit === 0
				? Boolean(lesson.single && !lesson.slow && !lesson.natural)
				: Boolean(!lesson.single && lesson.slow && lesson.natural);

		if (!isComplete) {
			throw new Error(`Incomplete audio set for Unit ${lesson.unit}.${lesson.item}`);
		}
	}

	const groupedUnits = new Map<number, Lesson[]>();

	for (const lesson of lessonMap.values()) {
		const lessons = groupedUnits.get(lesson.unit) ?? [];
		lessons.push(lesson);
		groupedUnits.set(lesson.unit, lessons);
	}

	const units: UnitGroup[] = Array.from(groupedUnits, ([unit, lessons]) => ({
		unit,
		lessons: lessons.sort((a, b) => a.item - b.item)
	})).sort((a, b) => a.unit - b.unit);
</script>

<svelte:head>
	<title>English Hanon Audio</title>
	<meta name="description" content="English HanonのUnit別Slow・Natural音声プレイヤー" />
</svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">Audio practice</p>
		<h1>English Hanon</h1>
		<p class="introduction">Select a unit and play the track you want to practise.</p>
	</header>

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
							<h2>{lesson.unit}.{lesson.item}</h2>

							{#if lesson.single}
								<div class="player single-player">
									<span>Audio</span>
									<audio
										controls
										preload="none"
										src={lesson.single}
										aria-label={`Unit ${lesson.unit}.${lesson.item} audio`}
									></audio>
								</div>
							{/if}

							{#if lesson.slow}
								<div class="player">
									<span>Slow</span>
									<audio
										controls
										preload="none"
										src={lesson.slow}
										aria-label={`Unit ${lesson.unit}.${lesson.item} slow audio`}
									></audio>
								</div>
							{/if}

							{#if lesson.natural}
								<div class="player">
									<span>Natural</span>
									<audio
										controls
										preload="none"
										src={lesson.natural}
										aria-label={`Unit ${lesson.unit}.${lesson.item} natural audio`}
									></audio>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</details>
		{/each}
	</section>
</main>

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

	.eyebrow {
		margin: 0 0 12px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
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

	audio {
		display: block;
		width: 100%;
		min-width: 0;
		height: 38px;
	}

	@media (max-width: 760px) {
		main {
			width: min(100% - 28px, 1120px);
			padding: 48px 0 72px;
		}

		.page-header {
			margin-bottom: 40px;
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
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
