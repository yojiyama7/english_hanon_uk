export type TranscriptParseResult = {
	transcripts: Record<string, string>;
	unknownLessonIds: string[];
};

const headingPattern = /^\[Unit\s+(\d+)\.(\d+)\]\s*$/;

export function lessonId(unit: number, section: number): string {
	return `Unit ${unit}.${section}`;
}

export function parseTranscript(
	text: string,
	knownLessonIds: ReadonlySet<string>
): TranscriptParseResult {
	const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	const transcripts: Record<string, string> = {};
	const unknownLessonIds: string[] = [];
	let currentLessonId: string | null = null;
	let currentLines: string[] = [];

	const saveCurrent = () => {
		if (!currentLessonId) return;
		const body = currentLines.join('\n').trim();
		if (!body) throw new Error(`${currentLessonId} の本文が空です。`);
		if (knownLessonIds.has(currentLessonId)) {
			transcripts[currentLessonId] = body;
		} else {
			unknownLessonIds.push(currentLessonId);
		}
	};

	for (const [index, line] of normalizedText.split('\n').entries()) {
		const heading = line.match(headingPattern);
		if (heading) {
			saveCurrent();
			const nextLessonId = lessonId(Number(heading[1]), Number(heading[2]));
			if (nextLessonId in transcripts || unknownLessonIds.includes(nextLessonId)) {
				throw new Error(`${nextLessonId} が重複しています。`);
			}
			currentLessonId = nextLessonId;
			currentLines = [];
			continue;
		}

		if (!currentLessonId) {
			if (line.trim()) throw new Error(`${index + 1}行目の本文より前にUnit見出しが必要です。`);
			continue;
		}
		currentLines.push(line);
	}

	saveCurrent();
	if (!currentLessonId) throw new Error('「[Unit 0.1]」形式の見出しが見つかりません。');

	return { transcripts, unknownLessonIds };
}
