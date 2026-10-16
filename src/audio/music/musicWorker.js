// Renders CD tracks off the main thread.
import { renderTrack } from './arrange.js';

self.onmessage = (e) => {
  const { id, album, track } = e.data;
  try {
    const { L, R, sr } = renderTrack(album, track);
    self.postMessage({ id, album, track, L, R, sr }, [L.buffer, R.buffer]);
  } catch (err) {
    self.postMessage({ id, album, track, error: String(err && err.stack ? err.stack : err) });
  }
};
