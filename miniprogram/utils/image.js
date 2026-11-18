// Picked photos → a JPEG/PNG small enough for the API (≤ 1.5 MB; same pixel budget as the site's compress()).
import { t } from "./i18n.js";

const call = (fn, opts) => new Promise((resolve, reject) => fn({ ...opts, success: resolve, fail: reject }));
const MAX_ASPECT = 3, PIXELS = 2_400_000, TARGET = 1_200_000;
const sizeOf = (path) => call(wx.getFileSystemManager().getFileInfo, { filePath: path }).then((r) => r.size);

/** Lets the runner pick up to n images (album or camera). Returns temp paths ([] when cancelled). */
export async function pick(n) {
  try {
    const r = await call(wx.chooseMedia, { count: n, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["original"] });
    return r.tempFiles.map((f) => f.tempFilePath);
  } catch { return []; }
}

/** → { path, mime, data: ArrayBuffer } ready to PUT/POST. Throws on very long screenshots (unreadable when shrunk). */
export async function prepare(src) {
  const info = await call(wx.getImageInfo, { src });
  const { width: w, height: h } = info;
  if (Math.max(w, h) / Math.min(w, h) > MAX_ASPECT) throw new Error(t("That image is too long to read. Crop it, or split it into up to 3 screenshots."));
  const scale = Math.min(1, Math.sqrt(PIXELS / (w * h)));
  let path = src;
  for (const quality of [82, 70, 55, 40]) {
    path = (await call(wx.compressImage, { src, quality, compressedWidth: Math.round(w * scale) })).tempFilePath;
    if ((await sizeOf(path)) <= TARGET) break;
  }
  const mime = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
  const data = (await call(wx.getFileSystemManager().readFile, { filePath: path })).data;
  return { path, mime, data };
}
