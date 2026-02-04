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
const USE_FACE_LANDMARKS = false;
// MediaPipe model / wasm嚗?芾??寞??祆?瑼?隞交?擃帘摰改?
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
  if (!USE_FACE_LANDMARKS) {
    setLandmarkerReady(false);
    return;
  }
const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    maskRef.current = { canvas: c, ready: false };
  }, []);

  // init preview renderer
  useEffect(() => {
  if (!USE_FACE_LANDMARKS) {
    setLandmarkerReady(false);
    return;
  }
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

  // load MediaPipe FaceLandmarker (?臬仃?????)
  useEffect(() => {
  if (!USE_FACE_LANDMARKS) {
    setLandmarkerReady(false);
    return;
  }
let cancelled = false;

  (async () => {
    try {
      const mp = await import("@mediapipe/tasks-vision"); // ????頛嚗??SSR 撏?
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
      console.warn("FaceLandmarker 頛憭望?嚗??⊿?蝝??∟???mask嚗?, err);
      setLandmarkerReady(false);
    }
  })();

  return () => { cancelled = true; };
}, []);


  // camera start
  useEffect(() => {
  if (!USE_FACE_LANDMARKS) {
    setLandmarkerReady(false);
    return;
  }
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
          uniq.set(key, { label: `${w}?${h}`, w, h });
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

    // 蝑?metadata
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
  if (!USE_FACE_LANDMARKS) {
    setLandmarkerReady(false);
    return;
  }
let raf = 0;
    const video = videoRef.current;
    const renderer = rendererRef.current;

    if (!video || !renderer) return;

    function tick() {
      const mask = maskRef.current;
      if (video && renderer && mask && video.videoWidth > 0 && video.videoHeight > 0) {
        // 瘥?5 撟??甈?landmarker嚗?雿???
        const now = performance.now();
        if (USE_FACE_LANDMARKS && landmarkerRef.current && landmarkerReady && now - lastLmTsRef.current > 80) {
          try {
            const res = landmarkerRef.current.detectForVideo(video, now);
            lastLmRef.current = res;
            lastLmTsRef.current = now;
          } catch {
            // ignore
          }
        }

        const lm = USE_FACE_LANDMARKS ? ((lastLmRef.current as any)?.faceLandmarks?.[0] ?? null) : null;
        buildFaceMask(mask, lm as any, { eyeBoost: USE_FACE_LANDMARKS });

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

      // 1) ?芸?雿輻 ImageCapture.takePhoto嚗?閫?? still嚗? ?cite?urn5search2??      let source: CaptureSource;
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
          note = "takePhoto 憭望?嚗?冽?蔣??ｇ??航頛?閫??嚗?;
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
        note = "甇斤汗?其??舀 ImageCapture.takePhoto嚗?冽?蔣???;
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        source = c;
        inputW = c.width;
        inputH = c.height;
      }

      // 2) 3:4 蝵桐葉鋆?嚗?閬質?頛詨銝?湛?
      const crop = computeCoverCrop(inputW, inputH, 3, 4);

      // 3) ?怨釭?芸?嚗?甇Ｖ?閫??蝖祆憭?????crop 銝雲 2160?2880嚗??芸???頛詨撠箏站
      const { outW, outH, downgraded } = chooseExportSizeNoUpscale(crop.sw, crop.sh, DESIRED_W, DESIRED_H);
      const finalNote =
        note +
        (downgraded
          ? "嚚迨鋆蔭/璅∪??桀??⊥???頞喳???閫??摨行??2160?2880 ?祕蝝啁?嚗歇?芸?撠撓?粹??唳餈撓?亥圾?漲嚗???3:4嚗?
          : "");

      setCapMeta({ inputW, inputH, exportW: outW, exportH: outH, downgraded, note: finalNote });

      // 4) ?? landmarks嚗? still ??菜葫嚗蝙頛詨?港??湛?
      let lmPts: any = null;
      if (USE_FACE_LANDMARKS && landmarkerRef.current && landmarkerReady) {
        try {
          // runningMode=VIDEO 隞??detect() ?撘蛛?API ?舀 image mode ? detect嚗?甇方??券?蝝??伐?
          // ??detect 銝???????敺?撟 landmarks
          // 嚗底閬?FaceLandmarker API嚗etect / detectForVideo嚗??cite?urn7view0??          const anyLm: any = landmarkerRef.current as any;
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

      // 5) export ??WebGL renderer嚗??汗??shader嚗?      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = outW;
      exportCanvas.height = outH;
      exportCanvasRef.current = exportCanvas;

      let exportRenderer: BeautyRenderer | null = null;
      try {
        exportRenderer = new BeautyRenderer(exportCanvas, outW, outH);
      } catch {
        exportRenderer = null;
      }

      // mask canvas 隞 256?256嚗? landmarks ??normalized嚗???仿? outW/outH
      buildFaceMask(mask, USE_FACE_LANDMARKS ? (lmPts as any) : null, { eyeBoost: USE_FACE_LANDMARKS });

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
        // ??WebGL ??????2D ?芸?鋆?頛詨嚗??臬???獢?
        const ctx = exportCanvas.getContext("2d")!;
        drawCroppedTo2D(ctx, source, crop, outW, outH);
      }

      // 6) ????嚗?D canvas ??PNG嚗?      let finalCanvas: HTMLCanvasElement = exportCanvas;
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
          // ??蝮格蝵桐葉閬??啗撓?箏之撠?          ctx2.drawImage(frameImg, 0, 0, outW, outH);
          finalCanvas = composite;
        } else {
          console.warn("2D canvas context unavailable; skip frame composite");
        }
      }

      // 7) ?臬 Blob嚗??toDataURL ????Blob嚗??toBlob嚗??cite?urn5search7??      const blob: Blob = await new Promise((resolve, reject) => {
        finalCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.95
        );
      });

      setResultBlob(blob);
      const obj = URL.createObjectURL(blob);
      setResultUrl(obj);

      // 8) 銝 ????token + url ????QR
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
        <h1>蝺??票嚗ypeScript / Next.js嚗?/h1>
        <div className="row">
          {landmarkerReady ? (
            <span className="badge ok">FaceLandmarker嚗歇?嚗???mask嚗?/span>
          ) : (
            <span className="badge warn">FaceLandmarker嚗?嚗?蝝芋撘?</span>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>A. ??嚗rame嚗??唾??豢?</h2>
          <FrameManager
            frames={frames}
            selectedId={selectedFrameId}
            onChange={(next) => setFrames(next)}
            onSelect={(id) => setSelectedFrameId(id)}
          />
        </div>

        <div className="card">
          <h2>B. ?豢??汗嚗?:4 ?嚗?+ D. 蝢?</h2>

          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div className="row">
              <span className="badge">?⊿嚗camInfo?.facing ?? facing}</span>
              <span className="badge">頛詨嚗rack settings嚗?{camInfo?.trackW ?? 0}?{camInfo?.trackH ?? 0}</span>
              <span className="badge">頛詨嚗ideo嚗?{camInfo?.videoW ?? 0}?{camInfo?.videoH ?? 0}</span>
              <span className="badge ok">?格?頛詨嚗DESIRED_W}?{DESIRED_H}嚗?:4嚗?/span>
            </div>
            <button onClick={toggleFacing}>????敺??/button>
          </div>
          <div className="row">
            <span className="badge">?汗璅∪?嚗previewMode === "webgl" ? "WebGL嚗?憿?" : "Video嚗蝢?嚗?}</span>
            <button onClick={() => setHiRes(v => !v)}>
              {hiRes ? "擃圾?漲嚗?" : "擃圾?漲嚗?"}
            </button>
          </div>

          {previewMode === "video" ? (
            <div className="muted" style={{ color: "#f59e0b" }}>
              蝢??閬?WebGL2????啁?憿???隢Ⅱ隤?Chrome 撌脤??′擃???閮剖? ??蝟餌絞 ??雿輻蝖祇?????              {webglError ? <div>WebGL ?航炊嚗webglError}</div> : null}
            </div>
          ) : null}
          {camError ? (
            <div className="muted" style={{ color: "#f59e0b" }}>
              ?⊿??憭望?嚗camError}
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
                <div className="countSub">?銝凌虫?蝬剜??單??汗??憿?/div>
                <div style={{ marginTop: 10 }}>
                  <button className="danger" onClick={cancelCountdown}>??</button>
                </div>
              </div>
            )}
          </div>

          <div className="hr" />

          <BeautyControls mode={mode} intensity={intensity} onMode={setMode} onIntensity={setIntensity} />

          <div className="hr" />

          <div className="row">
            <button className="primary" onClick={startCountdown} disabled={busy || count !== null}>
              {busy ? "??銝凌? : "?嚗摰 3 蝘?"}
            </button>
            <button onClick={doCapture} disabled={busy || count !== null}>
              蝡?
            </button>
            <button onClick={() => { setResultUrl(null); setQrUrl(null); setResultBlob(null); }} disabled={busy}>
              ??嚗?蝛箇???
            </button>
          </div>
          {captureError ? (
            <div className="muted" style={{ color: "#f59e0b" }}>
              ?憭望?嚗captureError}
            </div>
          ) : null}

          {capMeta && (
            <div className="muted" style={{ marginTop: 8 }}>
              <div>頛詨閫??摨佗?{capMeta.inputW}?{capMeta.inputH}嚚撓?箄圾?漲嚗capMeta.exportW}?{capMeta.exportH}</div>
              {capMeta.note ? <div style={{ color: capMeta.downgraded ? "#f59e0b" : "#aab1d6" }}>{capMeta.note}</div> : null}
            </div>
          )}

          {resultUrl && (
            <>
              <div className="hr" />
              <h2>E. ??蝯?</h2>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <img className="result" src={resultUrl} alt="result" />
                <div className="col">
                  <div className="muted">??摰?嚗??+ ??嚗?/div>
                  <div className="row">
                    <button onClick={downloadLocal}>銝??祆?</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {qrUrl && (
            <>
              <div className="hr" />
              <h2>F. QR Code嚗??脖?頛?嚗?/h2>
              <QrPanel url={qrUrl} />
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>撌亦?瘜冽?鈭?嚗?銝摰???</h2>
        <div className="muted">
          1) ?豢? API ?閬?Secure Context嚗TTPS ??localhost嚗?cite?urn5search0??          <br />
          2) 閫??摨西?閮???MediaStreamTrack.getSettings() ??video.videoWidth/videoHeight??cite?urn5search1??          <br />
          3) ??芸?雿輻 ImageCapture.takePhoto ??頛?閫?? still嚗??舀?????蔣??Ｕ?cite?urn5search2??        </div>
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

