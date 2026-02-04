"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FrameManager, { type FrameItem } from "../components/FrameManager";
import BeautyControls from "../components/BeautyControls";
import QrPanel from "../components/QrPanel";
import { BeautyRenderer } from "../lib/beauty/BeautyRenderer";
import type { BeautyMode, FaceMask } from "../lib/beauty/types";

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
    } catch (e) {
      console.error(e);
      rendererRef.current = null;
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
  }, [facing]);

  async function startCamera(face: "user" | "environment") {
    stopCamera();
    setQrUrl(null);
    setResultUrl(null);
    setResultBlob(null);

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: face },
        width: { ideal: 3840 },
        height: { ideal: 2160 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;

    const track = stream.getVideoTracks()[0];
    trackRef.current = track;

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
    const mask = maskRef.current;

    if (!video || !renderer || !mask) return;

    function tick() {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
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
    try {
      const track = trackRef.current;
      const video = videoRef.current;
      const mask = maskRef.current;
      if (!track || !video || !mask) throw new Error("Camera not ready");

      // 1) 優先使用 ImageCapture.takePhoto（高解析 still）  citeturn5search2
      let imageBitmap: ImageBitmap;
      let inputW = 0, inputH = 0;
      let note = "";

      const ImageCaptureCtor = (window as any).ImageCapture as any;
      if (ImageCaptureCtor) {
        try {
          const ic = new ImageCaptureCtor(track);
          const blob: Blob = await ic.takePhoto();
          imageBitmap = await createImageBitmap(blob);
          inputW = imageBitmap.width;
          inputH = imageBitmap.height;
        } catch (e) {
          note = "takePhoto 失敗，改用截取影片畫面（可能較低解析）";
          // fallback: draw from video
          const c = document.createElement("canvas");
          c.width = video.videoWidth;
          c.height = video.videoHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(video, 0, 0);
          imageBitmap = await createImageBitmap(c);
          inputW = imageBitmap.width;
          inputH = imageBitmap.height;
        }
      } else {
        note = "此瀏覽器不支援 ImageCapture.takePhoto，改用截取影片畫面";
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        imageBitmap = await createImageBitmap(c);
        inputW = imageBitmap.width;
        inputH = imageBitmap.height;
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
            const r = anyLm.detect(imageBitmap);
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
          imageBitmap,
          { w: inputW, h: inputH },
          srcRectNorm,
          { mode, intensity01: intensity / 100 },
          mask
        );
      } else {
        // 無 WebGL → 降級為 2D 只做裁切輸出（仍可合成邊框）
        const ctx = exportCanvas.getContext("2d")!;
        drawCroppedTo2D(ctx, imageBitmap, crop, outW, outH);
      }

      // 6) 合成邊框（2D canvas 疊 PNG）
      const composite = document.createElement("canvas");
      composite.width = outW;
      composite.height = outH;
      const ctx2 = composite.getContext("2d")!;
      ctx2.imageSmoothingEnabled = true;
      try { (ctx2 as any).imageSmoothingQuality = "high"; } catch {}

      ctx2.drawImage(exportCanvas, 0, 0);

      if (selectedFrame) {
        const frameImg = await loadImage(selectedFrame.url);
        // 邊框縮放置中覆蓋到輸出大小
        ctx2.drawImage(frameImg, 0, 0, outW, outH);
      }

      // 7) 匯出 Blob（避免 toDataURL 再轉回 Blob；直接 toBlob） citeturn5search7
      const blob: Blob = await new Promise((resolve, reject) => {
        composite.toBlob(
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

          <div className="previewWrap">
            <canvas ref={previewCanvasRef} className="previewCanvas" />
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

          <video ref={videoRef} playsInline muted style={{ display: "none" }} />

          <div className="hr" />

          <BeautyControls mode={mode} intensity={intensity} onMode={setMode} onIntensity={setIntensity} />

          <div className="hr" />

          <div className="row">
            <button className="primary" onClick={startCountdown} disabled={busy || count !== null}>
              {busy ? "處理中…" : "拍照（固定倒數 3 秒）"}
            </button>
            <button onClick={() => { setResultUrl(null); setQrUrl(null); setResultBlob(null); }} disabled={busy}>
              重新拍照（清空結果）
            </button>
          </div>

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
