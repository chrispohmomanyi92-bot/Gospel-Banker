// Offline videos: keep a copy of a video (and its thumbnail) in the browser's
// Cache Storage so it can be watched later without internet.
const CACHE = 'gb-offline-videos';
const KEY = 'gb_downloads';

export const offlineSupported = () => 'caches' in window;

export function listDownloads() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
const saveList = (list) => localStorage.setItem(KEY, JSON.stringify(list));
export const isDownloaded = (id) => listDownloads().some((d) => d.id === Number(id));

const inProgress = new Map();
export const downloading = (id) => inProgress.get(Number(id));

// Download a video. onProgress receives a number from 0 to 1 (or null when the size is unknown).
export async function downloadVideo(v, onProgress = () => {}) {
  const id = Number(v.id);
  if (inProgress.has(id)) return inProgress.get(id);
  const job = (async () => {
    navigator.storage?.persist?.().catch(() => {});
    const res = await fetch(v.src);
    if (!res.ok) throw new Error('Could not download this video.');
    const total = Number(res.headers.get('content-length')) || v.size || 0;
    const type = res.headers.get('content-type') || v.mime || 'video/mp4';
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(total ? Math.min(got / total, 1) : null);
    }
    const blob = new Blob(chunks, { type });
    const cache = await caches.open(CACHE);
    await cache.put(v.src, new Response(blob, { headers: { 'content-type': type, 'content-length': String(blob.size) } }));
    if (v.thumb_url) {
      const t = await fetch(v.thumb_url).catch(() => null);
      if (t?.ok) await cache.put(v.thumb_url, t);
    }
    const list = listDownloads().filter((d) => d.id !== id);
    list.unshift({
      id, title: v.title, channel_name: v.channel_name, category_label: v.category_label, src: v.src, thumb_url: v.thumb_url || null,
      duration: v.duration || 0, size: blob.size, saved_at: new Date().toISOString(),
    });
    saveList(list);
  })();
  inProgress.set(id, job);
  try { await job; } finally { inProgress.delete(id); }
}

export async function removeDownload(id) {
  id = Number(id);
  const d = listDownloads().find((x) => x.id === id);
  saveList(listDownloads().filter((x) => x.id !== id));
  if (!d || !offlineSupported()) return;
  const cache = await caches.open(CACHE);
  await cache.delete(d.src);
  if (d.thumb_url) await cache.delete(d.thumb_url);
}

// A local (blob:) address for a saved file, or null if it is not saved.
export async function offlineUrl(src) {
  if (!src || !offlineSupported()) return null;
  const r = await (await caches.open(CACHE)).match(src);
  return r ? URL.createObjectURL(await r.blob()) : null;
}

export const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
