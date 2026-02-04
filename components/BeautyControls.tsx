"use client";

import type { BeautyMode } from "@/lib/beauty/types";

export default function BeautyControls({
  mode,
  intensity,
  onMode,
  onIntensity
}: {
  mode: BeautyMode;
  intensity: number; // 0..100
  onMode: (m: BeautyMode) => void;
  onIntensity: (v: number) => void;
}) {
  return (
    <div className="col">
      <div className="row">
        <button className={mode==="smooth" ? "primary" : ""} onClick={()=>onMode("smooth")}>淨膚平滑</button>
        <button className={mode==="brighten" ? "primary" : ""} onClick={()=>onMode("brighten")}>透亮美白</button>
        <button className={mode==="tone" ? "primary" : ""} onClick={()=>onMode("tone")}>膚色校正</button>
        <button className={mode==="detail" ? "primary" : ""} onClick={()=>onMode("detail")}>立體細節</button>
      </div>
      <div className="muted">強度：{intensity}</div>
      <input
        type="range"
        min={0}
        max={100}
        value={intensity}
        onChange={(e) => onIntensity(Number(e.target.value))}
      />
      <div className="muted small">
        以上四種模式都不是單純整張柔焦：平滑採保邊平滑（bilateral 近似）、美白採中間調/曲線提亮、膚色以 HSV 微調、細節採 unsharp 概念並抑制噪點。
      </div>
    </div>
  );
}
