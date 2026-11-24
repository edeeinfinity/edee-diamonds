// Edee Infinity: swap a render's plain white background for the brand navy gradient, in the browser.
// The jewellery pixels are kept as rendered; only background (and its anti-aliased edge) changes.
// window.edeeDark(url, size) -> Promise<Blob|null>  (null when the background is not plain white)
(function () {
  function grad(w, h) {
    const c1 = [30, 40, 50], c2 = [10, 13, 17], out = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = Math.hypot((x - w / 2) / (w / 2), (y - h * 0.45) / (h / 2)) / 1.2; if (r > 1) r = 1;
      const i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) out[i + k] = c1[k] * (1 - r) + c2[k] * r;
    }
    return out;
  }
  function dilate(mask, w, h, r) { // square max filter, separable
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (mask[y * w + x]) last = x; tmp[y * w + x] = x - last <= r ? 1 : 0; }
      last = 1e9; for (let x = w - 1; x >= 0; x--) { if (mask[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; } }
    for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; out[y * w + x] = y - last <= r ? 1 : 0; }
      last = 1e9; for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; } }
    return out;
  }
  window.edeeDark = async function (url, size) {
    size = size || 1200;
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
    const id = cx.getImageData(0, 0, w, h), d = id.data, n = w * h;
    const mn = new Uint8Array(n);
    for (let i = 0; i < n; i++) mn[i] = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    // plain white background check: corners
    const corners = [0, w - 1, (h - 1) * w, n - 1, Math.floor(w / 2), (h - 1) * w + Math.floor(w / 2)];
    if (corners.some(i => mn[i] < 245)) return null;
    const white = new Uint8Array(n); for (let i = 0; i < n; i++) white[i] = mn[i] >= 247 ? 1 : 0;
    // label white components; background = touching the border or large enclosed areas
    const lab = new Int32Array(n), stack = new Int32Array(n), bg = new Uint8Array(n);
    const minArea = 4000 * (w * h) / (1800 * 1800);
    let cur = 0;
    for (let p = 0; p < n; p++) {
      if (!white[p] || lab[p]) continue;
      cur++; let sp = 0, area = 0, border = false; stack[sp++] = p; lab[p] = cur; const members = [];
      while (sp) { const q = stack[--sp]; members.push(q); area++; const x = q % w, y = (q / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        if (x > 0 && white[q - 1] && !lab[q - 1]) { lab[q - 1] = cur; stack[sp++] = q - 1; }
        if (x < w - 1 && white[q + 1] && !lab[q + 1]) { lab[q + 1] = cur; stack[sp++] = q + 1; }
        if (y > 0 && white[q - w] && !lab[q - w]) { lab[q - w] = cur; stack[sp++] = q - w; }
        if (y < h - 1 && white[q + w] && !lab[q + w]) { lab[q + w] = cur; stack[sp++] = q + w; } }
      if (border || area > minArea) for (const q of members) bg[q] = 1;
    }
    const edge = dilate(bg, w, h, Math.max(2, Math.round(3 * w / 1800)));
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = edge[i] ? Math.min(1, (255 - mn[i]) / 60) : 1;
    // light blur of alpha (3x3 binomial)
    const b = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x;
      b[i] = (4 * a[i] + 2 * (a[i - 1] + a[i + 1] + a[i - w] + a[i + w]) + a[i - w - 1] + a[i - w + 1] + a[i + w - 1] + a[i + w + 1]) / 16; }
    const N = grad(w, h);
    for (let i = 0; i < n; i++) { const t = 1 - (b[i] || a[i]);
      for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.max(0, Math.min(255, d[i * 4 + k] - t * (255 - N[i * 3 + k]))); }
    cx.putImageData(id, 0, 0);
    return cv.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  };
})();
