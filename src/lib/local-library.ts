export const databaseName = 'english-hanon-audio';
export const storeName = 'settings';
export const libraryKey = 'local-library';
export const legacyDirectoryKey = 'audio-directory';

const importsDirectoryName = 'imports';
const audioDirectoryName = 'audio';
const transcriptFilename = 'transcript.txt';

export type LocalLibraryManifest = {
	version: 1;
	importId: string;
	folderName: string;
	importedAt: string;
	audioFilenames: string[];
	transcriptSourceFilename?: string;
	storedBytes: number;
};

export type ImportSource = {
	folderName: string;
	audioFiles: File[];
	transcriptFile?: File;
};

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

async function getSetting<T>(key: string): Promise<T | null> {
	const database = await openDatabase();
	return new Promise((resolve, reject) => {
		const request = database.transaction(storeName).objectStore(storeName).get(key);
		request.onsuccess = () => {
			database.close();
			resolve((request.result as T | undefined) ?? null);
		};
		request.onerror = () => {
			database.close();
			reject(request.error);
		};
	});
}

async function putSetting(key: string, value: unknown): Promise<void> {
	const database = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(storeName, 'readwrite');
		transaction.objectStore(storeName).put(value, key);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
}

async function deleteSetting(key: string): Promise<void> {
	const database = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(storeName, 'readwrite');
		transaction.objectStore(storeName).delete(key);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
}

async function getImportsDirectory(create = false): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(importsDirectoryName, { create });
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, file: Blob) {
	const handle = await directory.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	try {
		await file.stream().pipeTo(writable);
	} catch (error) {
		await writable.abort().catch(() => undefined);
		throw error;
	}
}

export async function getLibraryManifest(): Promise<LocalLibraryManifest | null> {
	const manifest = await getSetting<LocalLibraryManifest>(libraryKey);
	return manifest?.version === 1 ? manifest : null;
}

export async function importLibrary(source: ImportSource): Promise<LocalLibraryManifest> {
	const previousManifest = await getLibraryManifest();
	const importId = `${Date.now()}-${crypto.randomUUID()}`;
	const importsDirectory = await getImportsDirectory(true);
	const importDirectory = await importsDirectory.getDirectoryHandle(importId, { create: true });

	try {
		const audioDirectory = await importDirectory.getDirectoryHandle(audioDirectoryName, {
			create: true
		});
		for (const file of source.audioFiles) await writeFile(audioDirectory, file.name, file);
		if (source.transcriptFile) {
			await writeFile(importDirectory, transcriptFilename, source.transcriptFile);
		}

		const manifest: LocalLibraryManifest = {
			version: 1,
			importId,
			folderName: source.folderName,
			importedAt: new Date().toISOString(),
			audioFilenames: source.audioFiles.map((file) => file.name),
			transcriptSourceFilename: source.transcriptFile?.name,
			storedBytes:
				source.audioFiles.reduce((total, file) => total + file.size, 0) +
				(source.transcriptFile?.size ?? 0)
		};
		await putSetting(libraryKey, manifest);
		await deleteSetting(legacyDirectoryKey).catch(() => undefined);

		if (previousManifest && previousManifest.importId !== importId) {
			await importsDirectory
				.removeEntry(previousManifest.importId, { recursive: true })
				.catch(() => undefined);
		}
		return manifest;
	} catch (error) {
		await importsDirectory.removeEntry(importId, { recursive: true }).catch(() => undefined);
		throw error;
	}
}

export async function readLibraryFiles(
	manifest: LocalLibraryManifest
): Promise<{ audioFiles: File[]; transcriptText?: string }> {
	const importsDirectory = await getImportsDirectory();
	const importDirectory = await importsDirectory.getDirectoryHandle(manifest.importId);
	const audioDirectory = await importDirectory.getDirectoryHandle(audioDirectoryName);
	const audioFiles = await Promise.all(
		manifest.audioFilenames.map(async (filename) =>
			(await audioDirectory.getFileHandle(filename)).getFile()
		)
	);
	let transcriptText: string | undefined;
	if (manifest.transcriptSourceFilename) {
		const fileHandle = await importDirectory.getFileHandle(transcriptFilename);
		transcriptText = await (await fileHandle.getFile()).text();
	}
	return { audioFiles, transcriptText };
}

export async function deleteLibrary(): Promise<void> {
	const manifest = await getLibraryManifest();
	if (manifest) {
		const importsDirectory = await getImportsDirectory().catch(() => null);
		await importsDirectory?.removeEntry(manifest.importId, { recursive: true }).catch(() => undefined);
	}
	await deleteSetting(libraryKey);
}
