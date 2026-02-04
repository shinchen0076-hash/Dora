"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FrameManager, { type FrameItem } from "../components/FrameManager";
import BeautyControls from "../components/BeautyControls";
import QrPanel from "../components/QrPanel";
import { BeautyRenderer } from "../lib/beauty/BeautyRenderer";
import type { BeautyMode, FaceMask } from "../lib/beauty/types";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";

import { buildFaceMask } from "@/lib/beauty/mask";
import { computeCoverCrop, chooseExportSizeNoUpscale, drawCroppedTo2D } from "@/lib/image";

const DESIRED_W = 2160;
const DESIRED_H = 2880;

// MediaPipe model / wasm（可自行改成本機檔案以提高穩定性）
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type CamInfo = {
  trackW: number;
  trackH: number;
  videoW: number;
  videoH: number;
  facing: "user" | "environment";
  canTakePhoto: boolean;
};

type CaptureMeta = {
  inputW: number;
  inputH: number;
  exportW: number;
  exportH: number;
  downgraded: boolean;
  note?: string;
};

type CaptureSource = CanvasImageSource;
type ResOption = { label: string; w: number; h: number };

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);

  const [mode, setMode] = useState<BeautyMode>("smooth");
  const [intensity, setIntensity] = useState<number>(55);

  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camInfo, setCamInfo] = useState<CamInfo | null>(null);

  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"webgl" | "video">("webgl");
  const [camError, setCamError] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [hiRes, setHiRes] = useState(true);
  const [resOptions, setResOptions] = useState<ResOption[]>([]);
  const [selectedRes, setSelectedRes] = useState<string>("auto");

  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [capMeta, setCapMeta] = useState<CaptureMeta | null>(null);

  const rendererRef = useRef<BeautyRenderer | null>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<FaceMask | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  // MediaPipe
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const [landmarkerReady, setLandmarkerReady] = useState(false);
  const lastLmRef = useRef<any>(null);
  const lastLmTsRef = useRef<number>(0);

  const selectedFrame = useMemo(() => frames.find(f => f.id === selectedFrameId) ?? null, [frames, selectedFrameId]);

  function ensureMask(): FaceMask {
    let mask = maskRef.current;
    if (!mask) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 256;
      mask = { canvas: c, ready: false };
      maskRef.current = mask;
    }
    return mask;
  }

  async function blobToImageSource(blob: Blob): Promise<CaptureSource> {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(blob);
      } catch {
        // fallback below
      }
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function getSourceSize(src: CaptureSource) {
    if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
    if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
    if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height };
    if (src instanceof ImageBitmap) return { w: src.width, h: src.height };
    return { w: 0, h: 0 };
  }

  // init mask canvas
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    maskRef.current = { canvas: c, ready: false };
  }, []);

  // init preview renderer
  useEffect(() => {
    const c = previewCanvasRef.current;
    if (!c) return;
    try {
      rendererRef.current = new BeautyRenderer(c, 720, 960);
      setPreviewMode("webgl");
      setWebglError(null);
    } catch (e) {
      console.error(e);
      rendererRef.current = null;
      setPreviewMode("video");
      const msg = e instanceof Error ? e.message : String(e);
      setWebglError(msg);
    }
    return () => { rendererRef.current = null; };
  }, []);

  // load MediaPipe FaceLandmarker (可失敗：需降級)
  useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      const mp = await import("@mediapipe/tasks-vision"); // ✅ 動態載入，避免 SSR 崩

      const vision = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
      const lm = await mp.FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1
      });

      if (cancelled) return;
      landmarkerRef.current = lm as any;
      setLandmarkerReady(true);
    } catch (err) {
      console.warn("FaceLandmarker 載入失敗，將採降級（無臉部 mask）", err);
      setLandmarkerReady(false);
    }
  })();

  return () => { cancelled = true; };
}, []);


  // camera start
  useEffect(() => {
    startCamera(facing);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, hiRes, selectedRes]);

  async function startCamera(face: "user" | "environment") {
    stopCamera();
    setCamError(null);
    setQrUrl(null);
    setResultUrl(null);
    setResultBlob(null);

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: face },
        width: { ideal: hiRes ? 3840 : 1920 },
        height: { ideal: hiRes ? 2160 : 1080 },
        frameRate: { ideal: 30 },
        aspectRatio: { ideal: 3 / 4 }
      },
      audio: false
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCamError(msg);
      throw e;
    }
    streamRef.current = stream;

    const track = stream.getVideoTracks()[0];
    trackRef.current = track;
    try {
      const caps = (track as MediaStreamTrack).getCapabilities?.();
      if (caps && (caps.width || caps.height)) {
        const maxW = typeof caps.width === "object" ? caps.width.max : undefined;
        const maxH = typeof caps.height === "object" ? caps.height.max : undefined;
        const maxFps = typeof caps.frameRate === "object" ? caps.frameRate.max : undefined;
        const candidates: Array<[number, number]> = [
          [maxW ?? 0, maxH ?? 0],
          [2560, 1920],
          [1920, 1440],
          [1600, 1200],
          [1280, 960],
          [1280, 720],
          [960, 720]
        ];
        const uniq = new Map<string, ResOption>();
        for (const [w, h] of candidates) {
          if (!w || !h) continue;
          if (maxW && w > maxW) continue;
          if (maxH && h > maxH) continue;
          const key = `${w}x${h}`;
          uniq.set(key, { label: `${w}×${h}`, w, h });
        }
        const opts = Array.from(uniq.values());
        setResOptions(opts);
        if (selectedRes === "auto" && opts[0]) {
          setSelectedRes(`${opts[0].w}x${opts[0].h}`);
        }
        const picked = selectedRes !== "auto"
          ? opts.find(o => `${o.w}x${o.h}` === selectedRes)
          : undefined;
        await track.applyConstraints({
          advanced: [{
            width: picked?.w ?? (hiRes ? (maxW ?? undefined) : undefined),
            height: picked?.h ?? (hiRes ? (maxH ?? undefined) : undefined),
            aspectRatio: 3 / 4,
            frameRate: maxFps ?? undefined
          }]
        });
      }
    } catch (e) {
      console.warn("applyConstraints failed", e);
    }

    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play();

    // 等 metadata
    await new Promise<void>((r) => {
      if (video.readyState >= 2) return r();
      video.onloadedmetadata = () => r();
    });

    const s = track.getSettings();
    const canTakePhoto = typeof (window as any).ImageCapture !== "undefined";

    setCamInfo({
      trackW: Number((s as any).width ?? 0),
      trackH: Number((s as any).height ?? 0),
      videoW: video.videoWidth,
      videoH: video.videoHeight,
      facing: face,
      canTakePhoto
    });

    if (!rendererRef.current) {
      setPreviewMode("video");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    trackRef.current = null;
  }

  // preview render loop
  useEffect(() => {
    let raf = 0;
    const video = videoRef.current;
    const renderer = rendererRef.current;

    if (!video || !renderer) return;

    function tick() {
      const mask = maskRef.current;
      if (video && renderer && mask && video.videoWidth > 0 && video.videoHeight > 0) {
        // 每 5 幀做一次 landmarker（降低負擔）
        const now = performance.now();
        if (landmarkerRef.current && landmarkerReady && now - lastLmTsRef.current > 80) {
          try {
            const res = landmarkerRef.current.detectForVideo(video, now);
            lastLmRef.current = res;
            lastLmTsRef.current = now;
          } catch {
            // ignore
          }
        }

        const lm = (lastLmRef.current as any)?.faceLandmarks?.[0] ?? null;
        buildFaceMask(mask, lm as any, { eyeBoost: true });

        const crop = computeCoverCrop(video.videoWidth, video.videoHeight, 3, 4);
        // normalized source rect for shader
        const srcRectNorm = {
          x: crop.sx / video.videoWidth,
          y: crop.sy / video.videoHeight,
          w: crop.sw / video.videoWidth,
          h: crop.sh / video.videoHeight
        };

        renderer.render(
          video,
          { w: video.videoWidth, h: video.videoHeight },
          srcRectNorm,
          { mode, intensity01: intensity / 100 },
          mask
        );
      }
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, intensity, landmarkerReady]);

  async function startCountdown() {
    if (busy) return;
    setCaptureError(null);
    setQrUrl(null);
    setResultUrl(null);
    setResultBlob(null);

    setCount(3);
    let t = 3;

    const timer = setInterval(async () => {
      t -= 1;
      if (t <= 0) {
        clearInterval(timer);
        setCount(0);
        await doCapture();
        setCount(null);
      } else {
        setCount(t);
      }
    }, 1000);

    // cancel handler stored on window for simplicity
    (window as any).__cancelCountdown = () => { clearInterval(timer); setCount(null); };
  }

  async function doCapture() {
    setBusy(true);
    setCaptureError(null);
    try {
      const track = trackRef.current;
      const video = videoRef.current;
      if (!track || !video) throw new Error("Camera not ready");
      const mask = ensureMask();

      // 1) 優先使用 ImageCapture.takePhoto（高解析 still）  citeturn5search2
      let source: CaptureSource;
      let inputW = 0, inputH = 0;
      let note = "";

      const ImageCaptureCtor = (window as any).ImageCapture as any;
      if (ImageCaptureCtor) {
        try {
          const ic = new ImageCaptureCtor(track);
          const blob: Blob = await ic.takePhoto();
          source = await blobToImageSource(blob);
          const size = getSourceSize(source);
          inputW = size.w;
          inputH = size.h;
        } catch (e) {
          note = "takePhoto 失敗，改用截取影片畫面（可能較低解析）";
          // fallback: draw from video
          const c = document.createElement("canvas");
          c.width = video.videoWidth;
          c.height = video.videoHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(video, 0, 0);
          source = c;
          inputW = c.width;
          inputH = c.height;
        }
      } else {
        note = "此瀏覽器不支援 ImageCapture.takePhoto，改用截取影片畫面";
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        source = c;
        inputW = c.width;
        inputH = c.height;
      }

      // 2) 3:4 置中裁切（預覽與輸出一致）
      const crop = computeCoverCrop(inputW, inputH, 3, 4);

      // 3) 畫質優先：禁止低解析硬放大 → 若 crop 不足 2160×2880，則自動降級輸出尺寸
      const { outW, outH, downgraded } = chooseExportSizeNoUpscale(crop.sw, crop.sh, DESIRED_W, DESIRED_H);
      const finalNote =
        note +
        (downgraded
          ? "｜此裝置/模式目前無法提供足夠原始解析度支撐 2160×2880 真實細節，已自動將輸出降到接近輸入解析度（仍為 3:4）。"
          : "");

      setCapMeta({ inputW, inputH, exportW: outW, exportH: outH, downgraded, note: finalNote });

      // 4) 取得 landmarks（優先用 still 重新偵測，使輸出更一致）
      let lmPts: any = null;
      if (landmarkerRef.current && landmarkerReady) {
        try {
          // runningMode=VIDEO 仍可用 detect() 做單張（API 支援 image mode 才能 detect）；此處用降級策略：
          // 若 detect 不可用 → 退回最後一幀 landmarks
          // （詳見 FaceLandmarker API：detect / detectForVideo） citeturn7view0
          const anyLm: any = landmarkerRef.current as any;
          if (typeof anyLm.detect === "function") {
            const r = anyLm.detect(source as any);
            lmPts = r?.faceLandmarks?.[0] ?? null;
          } else {
            lmPts = (lastLmRef.current as any)?.faceLandmarks?.[0] ?? null;
          }
        } catch {
          lmPts = (lastLmRef.current as any)?.faceLandmarks?.[0] ?? null;
        }
      }

      // 5) export 用 WebGL renderer（與預覽同 shader）
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = outW;
      exportCanvas.height = outH;
      exportCanvasRef.current = exportCanvas;

      let exportRenderer: BeautyRenderer | null = null;
      try {
        exportRenderer = new BeautyRenderer(exportCanvas, outW, outH);
      } catch {
        exportRenderer = null;
      }

      // mask canvas 仍用 256×256，但 landmarks 是 normalized；不需知道 outW/outH
      buildFaceMask(mask, lmPts as any, { eyeBoost: true });

      const srcRectNorm = {
        x: crop.sx / inputW,
        y: crop.sy / inputH,
        w: crop.sw / inputW,
        h: crop.sh / inputH
      };

      if (exportRenderer) {
        exportRenderer.render(
          source as TexImageSource,
          { w: inputW, h: inputH },
          srcRectNorm,
          { mode, intensity01: intensity / 100 },
          mask
        );
      } else {
        // 無 WebGL → 降級為 2D 只做裁切輸出（仍可合成邊框）
        const ctx = exportCanvas.getContext("2d")!;
        drawCroppedTo2D(ctx, source, crop, outW, outH);
      }

      // 6) 合成邊框（2D canvas 疊 PNG）
      let finalCanvas: HTMLCanvasElement = exportCanvas;
      if (selectedFrame) {
        const composite = document.createElement("canvas");
        composite.width = outW;
        composite.height = outH;
        const ctx2 = composite.getContext("2d");
        if (ctx2) {
          ctx2.imageSmoothingEnabled = true;
          try { (ctx2 as any).imageSmoothingQuality = "high"; } catch {}
          ctx2.drawImage(exportCanvas, 0, 0);
          const frameImg = await loadImage(selectedFrame.url);
          // 邊框縮放置中覆蓋到輸出大小
          ctx2.drawImage(frameImg, 0, 0, outW, outH);
          finalCanvas = composite;
        } else {
          console.warn("2D canvas context unavailable; skip frame composite");
        }
      }

      // 7) 匯出 Blob（避免 toDataURL 再轉回 Blob；直接 toBlob） citeturn5search7
      const blob: Blob = await new Promise((resolve, reject) => {
        finalCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.95
        );
      });

      setResultBlob(blob);
      const obj = URL.createObjectURL(blob);
      setResultUrl(obj);

      // 8) 上傳 → 回 token + url → 產 QR
      const fd = new FormData();
      fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      fd.append("meta", JSON.stringify({ inputW, inputH, exportW: outW, exportH: outH }));

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const json = await res.json();
      setQrUrl(json.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      setCaptureError(msg);
    } finally {
      setBusy(false);
    }
  }

  function cancelCountdown() {
    const fn = (window as any).__cancelCountdown;
    if (typeof fn === "function") fn();
  }

  function toggleFacing() {
    setFacing((p) => (p === "user" ? "environment" : "user"));
  }

  async function downloadLocal() {
    if (!resultBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(resultBlob);
    a.download = "photobooth.jpg";
    a.click();
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>線上拍貼（TypeScript / Next.js）</h1>
        <div className="row">
          {landmarkerReady ? (
            <span className="badge ok">FaceLandmarker：已啟用（臉部 mask）</span>
          ) : (
            <span className="badge warn">FaceLandmarker：未啟用（降級模式）</span>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>A. 邊框（Frame）上傳與選擇</h2>
          <FrameManager
            frames={frames}
            selectedId={selectedFrameId}
            onChange={(next) => setFrames(next)}
            onSelect={(id) => setSelectedFrameId(id)}
          />
        </div>

        <div className="card">
          <h2>B. 相機預覽（3:4 取景） + D. 美顏</h2>

          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div className="row">
              <span className="badge">鏡頭：{camInfo?.facing ?? facing}</span>
              <span className="badge">輸入（track settings）：{camInfo?.trackW ?? 0}×{camInfo?.trackH ?? 0}</span>
              <span className="badge">輸入（video）：{camInfo?.videoW ?? 0}×{camInfo?.videoH ?? 0}</span>
              <span className="badge ok">目標輸出：{DESIRED_W}×{DESIRED_H}（3:4）</span>
            </div>
            <button onClick={toggleFacing}>切換前/後鏡頭</button>
          </div>
          <div className="row">
            <span className="badge">預覽模式：{previewMode === "webgl" ? "WebGL（美顏）" : "Video（無美顏）"}</span>
            <button onClick={() => setHiRes(v => !v)}>
              {hiRes ? "高解析度：開" : "高解析度：關"}
            </button>
          </div>

          {previewMode === "video" ? (
            <div className="muted" style={{ color: "#f59e0b" }}>
              美顏需要 WebGL2。若看不到美顏效果，請確認 Chrome 已開啟硬體加速（設定 → 系統 → 使用硬體加速）。
              {webglError ? <div>WebGL 錯誤：{webglError}</div> : null}
            </div>
          ) : null}
          {camError ? (
            <div className="muted" style={{ color: "#f59e0b" }}>
              鏡頭啟動失敗：{camError}
            </div>
          ) : null}
          <div className="row">
            <span className="badge">Preview: {previewMode === "webgl" ? "WebGL (beauty)" : "Video (no beauty)"}</span>
            <button onClick={() => setHiRes(v => !v)}>
              {hiRes ? "Hi-Res: On" : "Hi-Res: Off"}
            </button>
            <select
              value={selectedRes}
              onChange={(e) => setSelectedRes(e.target.value)}
              style={{ background: "#1a2040", color: "white", borderRadius: 8, padding: "6px 8px", border: "1px solid #2a3352" }}
            >
              <option value="auto">Resolution: Auto</option>
              {resOptions.map(o => (
                <option key={o.label} value={`${o.w}x${o.h}`}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="previewWrap">
            <video
              ref={videoRef}
              className={"previewVideo" + (previewMode === "video" ? " show" : "")}
              playsInline
              muted
            />
            <canvas ref={previewCanvasRef} className={"previewCanvas" + (previewMode === "webgl" ? " show" : "")} />
            {selectedFrame ? (
              <img className="frameOverlay" src={selectedFrame.url} alt="frame" />
            ) : null}
            <div className="frameOverlayGuide" />
            {count !== null && (
              <div className="countdownOverlay">
                <div className="countNum">{count}</div>
                <div className="countSub">倒數中…仍維持即時預覽與美顏</div>
                <div style={{ marginTop: 10 }}>
                  <button className="danger" onClick={cancelCountdown}>取消</button>
                </div>
              </div>
            )}
          </div>

          <div className="hr" />

          <BeautyControls mode={mode} intensity={intensity} onMode={setMode} onIntensity={setIntensity} />

          <div className="hr" />

          <div className="row">
            <button className="primary" onClick={startCountdown} disabled={busy || count !== null}>
              {busy ? "處理中…" : "拍照（固定倒數 3 秒）"}
            </button>
            <button onClick={doCapture} disabled={busy || count !== null}>
              立即拍照
            </button>
            <button onClick={() => { setResultUrl(null); setQrUrl(null); setResultBlob(null); }} disabled={busy}>
              重新拍照（清空結果）
            </button>
          </div>
          {captureError ? (
            <div className="muted" style={{ color: "#f59e0b" }}>
              拍照失敗：{captureError}
            </div>
          ) : null}

          {capMeta && (
            <div className="muted" style={{ marginTop: 8 }}>
              <div>輸入解析度：{capMeta.inputW}×{capMeta.inputH}｜輸出解析度：{capMeta.exportW}×{capMeta.exportH}</div>
              {capMeta.note ? <div style={{ color: capMeta.downgraded ? "#f59e0b" : "#aab1d6" }}>{capMeta.note}</div> : null}
            </div>
          )}

          {resultUrl && (
            <>
              <div className="hr" />
              <h2>E. 合成結果</h2>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <img className="result" src={resultUrl} alt="result" />
                <div className="col">
                  <div className="muted">合成完成（照片 + 邊框）。</div>
                  <div className="row">
                    <button onClick={downloadLocal}>下載本機</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {qrUrl && (
            <>
              <div className="hr" />
              <h2>F. QR Code（掃描進下載頁）</h2>
              <QrPanel url={qrUrl} />
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>工程注意事項（你一定要看）</h2>
        <div className="muted">
          1) 相機 API 需要 Secure Context（HTTPS 或 localhost）。citeturn5search0
          <br />
          2) 解析度資訊來自 MediaStreamTrack.getSettings() 與 video.videoWidth/videoHeight。citeturn5search1
          <br />
          3) 拍照優先使用 ImageCapture.takePhoto 取得較高解析 still；不支援時才退回截取影片畫面。citeturn5search2
        </div>
      </div>
    </div>
  );
}

async function loadImage(url: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
  return img;
}
