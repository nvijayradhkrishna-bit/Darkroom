// Fast on-device fill for small objects/blemishes. Works inward from the edge of
// the mask, averaging the nearest known pixels ring by ring. Not generative AI.
export function dilate(mask, w, h, passes = 1) {
  let cur = mask;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cur[i]) continue;
      for (let dy = -1; dy <= 1 && !next[i]; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && cur[ny * w + nx]) { next[i] = 1; break; }
      }
    }
    cur = next;
  }
  return cur;
}

export function inpaint(data, w, h, mask) {
  const N = w * h, known = new Uint8Array(N), queued = new Uint8Array(N);
  let remaining = 0;
  for (let i = 0; i < N; i++) { if (mask[i]) remaining++; else known[i] = 1; }
  if (!remaining || remaining === N) return false;
  const NB = [[-1,-1,.7],[0,-1,1],[1,-1,.7],[-1,0,1],[1,0,1],[-1,1,.7],[0,1,1],[1,1,.7]];
  let frontier = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && known[ny * w + nx]) { frontier.push(i); queued[i] = 1; break; }
    }
  }
  while (frontier.length) {
    const out = new Float32Array(frontier.length * 4);
    for (let k = 0; k < frontier.length; k++) {
      const i = frontier[k], x = i % w, y = (i / w) | 0;
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (const [dx, dy, wt] of NB) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!known[ni]) continue;
        const p = ni * 4;
        r += data[p] * wt; g += data[p + 1] * wt; b += data[p + 2] * wt; a += data[p + 3] * wt; ws += wt;
      }
      out[k * 4] = r / ws; out[k * 4 + 1] = g / ws; out[k * 4 + 2] = b / ws; out[k * 4 + 3] = a / ws;
    }
    const next = [];
    for (let k = 0; k < frontier.length; k++) {
      const i = frontier[k], p = i * 4;
      data[p] = out[k * 4]; data[p + 1] = out[k * 4 + 1]; data[p + 2] = out[k * 4 + 2]; data[p + 3] = out[k * 4 + 3];
      known[i] = 1;
    }
    for (const i of frontier) {
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] && !known[ni] && !queued[ni]) { queued[ni] = 1; next.push(ni); }
      }
    }
    frontier = next;
  }
  return true;
}
