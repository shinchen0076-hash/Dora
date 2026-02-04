import type { FaceMask } from "./types";

type LM = { x: number; y: number; z?: number };

// 以 landmarks 生成低解析 mask（R: 臉部、G: 眼周提亮）
export function buildFaceMask(
  mask: FaceMask,
  landmarks: LM[] | null,
  opts?: { eyeBoost?: boolean }
) {
  const c = mask.canvas;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const W = c.width;
  const H = c.height;

  // 清空
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, W, H);

  if (!landmarks || landmarks.length < 10) {
    // fallback：整張視作臉部（但 eyes = 0）
    ctx.fillStyle = "rgb(255,0,0)";
    ctx.fillRect(0, 0, W, H);
    mask.ready = true;
    return;
  }

  // Face oval：用一組常見的 face-oval 索引近似（MediaPipe 478 點）
  // 這裡選用一個「足夠」的輪廓點集合；若未來索引改變，仍會 fallback。
  const ovalIdx = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const pts = ovalIdx
    .map(i => landmarks[i])
    .filter(Boolean)
    .map(p => ({ x: p.x * W, y: p.y * H }));

  if (pts.length < 6) {
    ctx.fillStyle = "rgb(255,0,0)";
    ctx.fillRect(0, 0, W, H);
    mask.ready = true;
    return;
  }

  // 臉部 mask（R channel）
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.fill();
  ctx.restore();

  // 眼周（G channel）— 以左右眼中心畫 soft circle
  if (opts?.eyeBoost !== false) {
    // 左右眼中心近似索引（iris/eye）
    const leftEye = landmarks[468] ?? landmarks[159] ?? landmarks[33];
    const rightEye = landmarks[473] ?? landmarks[386] ?? landmarks[263];
    if (leftEye && rightEye) {
      const r = Math.max(W, H) * 0.06;
      paintSoftCircle(ctx, leftEye.x * W, leftEye.y * H, r, "rgb(0,255,0)");
      paintSoftCircle(ctx, rightEye.x * W, rightEye.y * H, r, "rgb(0,255,0)");
    }
  }

  mask.ready = true;
}

function paintSoftCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgb(0,0,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
