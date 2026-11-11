export const sectionParamName = 'section';

export type SectionRef = { unit: number; section: number };

/** Parses a URL section value such as "10.7" (an optional "Unit " prefix is accepted). */
export function parseSectionParam(value: string | null): SectionRef | null {
	const match = value?.trim().match(/^(?:unit\s*)?(\d+)\.(\d+)$/i);
	if (!match) return null;
	return { unit: Number(match[1]), section: Number(match[2]) };
}
