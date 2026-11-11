// IndexedDB persistence. Everything (projects + imported media files) stays on this device.
const NAME = 'lyrics-video-studio', VERSION = 1;
let dbp;

function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' }).createIndex('projectId', 'projectId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function tx(store, mode = 'readonly') { return (await open()).transaction(store, mode).objectStore(store); }

export const listProjects = async () => (await wrap((await tx('projects')).getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getProject = async id => wrap((await tx('projects')).get(id));
export const putProject = async p => wrap((await tx('projects', 'readwrite')).put(p));
export const putMedia = async m => wrap((await tx('media', 'readwrite')).put(m));
export const deleteMedia = async id => wrap((await tx('media', 'readwrite')).delete(id));
export const listMedia = async projectId => wrap((await tx('media')).index('projectId').getAll(projectId));

export async function deleteProject(id) {
  for (const m of await listMedia(id)) await deleteMedia(m.id);
  await wrap((await tx('projects', 'readwrite')).delete(id));
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* optional */ }
}
