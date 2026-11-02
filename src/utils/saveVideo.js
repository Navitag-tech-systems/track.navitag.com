// Save a video file from a URL on every platform the app runs on.
//
//   PWA / browser on a phone : fetch -> File -> navigator.share({ files }), which
//                              is the share sheet with "Save Video" (Photos) on
//                              iPhone and the gallery/Files targets on Android.
//   desktop browser          : fetch -> object URL -> <a download> (Downloads).
//   native (Capacitor shell) : an object-URL download has nowhere to land in the
//                              WebView (see utils/positionsCsv.js), so the URL is
//                              opened in the system browser, which handles the
//                              attachment itself.
//
// navigator.share needs a fresh user gesture, and a multi-MB fetch outlives it,
// so fetching and saving are two steps: fetchVideo() runs on the Download tap,
// saveFile() on the Save tap that follows.
import { Capacitor } from '@capacitor/core';

export function isNative() {
  return Capacitor.isNativePlatform();
}

export function isPhone() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;   // iPadOS desktop UA
}

export function filenameFrom(disposition, fallback) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition || '');
  return m ? decodeURIComponent(m[1]) : fallback;
}

// GET `url` without credentials (medusa answers Access-Control-Allow-Origin: *)
// and return a File, reporting { loaded, total } as bytes arrive.
export async function fetchVideo(url, { fallbackName = 'dashcam.mp4', onProgress, signal } = {}) {
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (!res.ok) {
    const err = new Error(res.status === 404 ? 'This part of the video is not available to download.' : `Download failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  const total = Number(res.headers.get('Content-Length')) || 0;
  const name = filenameFrom(res.headers.get('Content-Disposition'), fallbackName);
  let blob;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    blob = new Blob(chunks, { type: 'video/mp4' });
  } else {
    blob = await res.blob();
    onProgress?.({ loaded: blob.size, total: blob.size });
  }
  return new File([blob], name, { type: 'video/mp4' });
}

export function canShareFiles(files) {
  try {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files }));
  } catch {
    return false;
  }
}

// Must run inside a user gesture. Returns 'shared' | 'downloaded' | 'cancelled'.
export async function saveFiles(files) {
  if (isPhone() && canShareFiles(files)) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (gesture expired) or a target failure: fall through.
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return 'downloaded';
}

export async function openInSystemBrowser(url) {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}
