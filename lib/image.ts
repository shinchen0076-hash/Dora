export type Rect = { sx: number; sy: number; sw: number; sh: number };

/** cover（置中裁切）：把來源以 cover 的方式對齊到目標比例，回傳要從來源裁切的矩形（source rect）。 */
export function computeCoverCrop(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const srcAR = srcW / srcH;
  const dstAR = dstW / dstH;

  if (srcAR > dstAR) {
    // 來源較寬 → 裁左右
    const newW = Math.round(srcH * dstAR);
    const sx = Math.round((srcW - newW) / 2);
    return { sx, sy: 0, sw: newW, sh: srcH };
  } else {
    // 來源較高 → 裁上下
    const newH = Math.round(srcW / dstAR);
    const sy = Math.round((srcH - newH) / 2);
    return { sx: 0, sy, sw: srcW, sh: newH };
  }
}

/** 若來源裁切後不足以支撐 2160×2880 真實細節，則自動降到「不放大」的最大 3:4 輸出尺寸。 */
export function chooseExportSizeNoUpscale(cropW: number, cropH: number, desiredW: number, desiredH: number) {
  const canFull = cropW >= desiredW && cropH >= desiredH;
  if (canFull) return { outW: desiredW, outH: desiredH, downgraded: false };

  // 以 cropH 為主（3:4）可容納的最大寬
  const wFromH = Math.floor((cropH * 3) / 4);
  const hFromW = Math.floor((cropW * 4) / 3);

  let outW: number;
  let outH: number;

  // 選擇在 crop 內面積最大的 3:4 尺寸（但不超過 desired）
  const cand1 = { w: Math.min(desiredW, cropW), h: Math.floor(Math.min(desiredW, cropW) * 4 / 3) };
  if (cand1.h > cropH) {
    cand1.h = Math.min(desiredH, cropH);
    cand1.w = Math.floor(cand1.h * 3 / 4);
  }
  const cand2 = { w: Math.min(desiredW, wFromH), h: Math.floor(Math.min(desiredW, wFromH) * 4 / 3) };
  const cand3 = { w: Math.floor(Math.min(desiredH, hFromW) * 3 / 4), h: Math.min(desiredH, hFromW) };

  const candidates = [cand1, cand2, cand3].filter(c => c.w > 0 && c.h > 0 && c.w <= cropW && c.h <= cropH);
  candidates.sort((a,b)=> (b.w*b.h)-(a.w*a.h));
  const best = candidates[0] ?? { w: Math.min(cropW, desiredW), h: Math.min(cropH, desiredH) };

  outW = best.w;
  outH = best.h;

  return { outW, outH, downgraded: true };
}

/** 將 ImageBitmap/Video 依指定 crop 繪製到 2D canvas（可用於 frame 合成）。 */
export function drawCroppedTo2D(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  crop: Rect,
  outW: number,
  outH: number
) {
  ctx.imageSmoothingEnabled = true;
  // 部分瀏覽器不支援 high，故以 try-catch
  try { (ctx as any).imageSmoothingQuality = "high"; } catch {}
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);
}
