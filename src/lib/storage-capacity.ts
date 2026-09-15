export type StorageEstimateLike = {
	quota?: number;
	usage?: number;
};

export function availableStorageBytes(estimate: StorageEstimateLike): number | undefined {
	return estimate.quota === undefined
		? undefined
		: Math.max(0, estimate.quota - (estimate.usage ?? 0));
}

export function hasStorageCapacity(totalBytes: number, availableBytes: number | undefined): boolean {
	return availableBytes === undefined || availableBytes >= totalBytes;
}

export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return '取得できませんでした';
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
	if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
