export type TranscriptSentence = {
	index: number;
	text: string;
	depth: number;
};

export type TranscriptParseResult = {
	transcripts: Record<string, TranscriptSentence[]>;
	unknownLessonIds: string[];
};

const headingPattern = /^\[Unit\s+(\d+)\.(\d+)\]\s*$/;
const sentencePattern = /^(\s*)-\s+(.+?)\s*$/;

export function lessonId(unit: number, section: number): string {
	return `Unit ${unit}.${section}`;
}

export function parseTranscript(
	text: string,
	knownLessonIds: ReadonlySet<string>
): TranscriptParseResult {
	const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	const transcripts: Record<string, TranscriptSentence[]> = {};
	const unknownLessonIds: string[] = [];
	let currentLessonId: string | null = null;
	let currentLines: string[] = [];

	const saveCurrent = () => {
		if (!currentLessonId) return;
		const bodyLines = currentLines.filter((line) => line.trim());
		if (!bodyLines.length) throw new Error(`${currentLessonId} の本文が空です。`);
		const sentences = bodyLines.map((line, index) => {
			const sentence = line.match(sentencePattern);
			if (!sentence) throw new Error(`${currentLessonId} の本文は「- 」で始まる行にしてください。`);
			const indentWidth = sentence[1].replace(/\t/g, '  ').length;
			return { index, text: sentence[2], depth: Math.floor(indentWidth / 2) };
		});
		if (knownLessonIds.has(currentLessonId)) {
			transcripts[currentLessonId] = sentences;
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
