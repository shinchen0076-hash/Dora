"use client";

import { useMemo, useState } from "react";

type Meta = {
  createdAt: number;
  expiresAt: number;
  inputW: number;
  inputH: number;
  exportW: number;
  exportH: number;
};

export default function DownloadClient({ token, imgUrl, meta }: { token: string; imgUrl: string; meta: Meta }) {
  const [busy, setBusy] = useState(false);

  const created = useMemo(() => new Date(meta.createdAt).toLocaleString("zh-TW"), [meta.createdAt]);
  const expires = useMemo(() => new Date(meta.expiresAt).toLocaleString("zh-TW"), [meta.expiresAt]);

  async function onShare() {
    if (!navigator.share) return;
    setBusy(true);
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      const file = new File([blob], `photobooth-${token}.jpg`, { type: blob.type || "image/jpeg" });
      await navigator.share({ files: [file], title: "拍貼照片" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col">
      <div className="row">
        <span className="badge">輸入解析度：{meta.inputW}×{meta.inputH}</span>
        <span className="badge ok">輸出解析度：{meta.exportW}×{meta.exportH}</span>
        <span className="badge">建立：{created}</span>
        <span className="badge warn">到期：{expires}</span>
      </div>

      <img
        src={imgUrl}
        alt="photo"
        style={{ width: "100%", maxWidth: 520, borderRadius: 14, border: "1px solid rgba(255,255,255,.12)" }}
      />

      <div className="row">
        <a href={`${imgUrl}?download=1`} style={{ textDecoration: "none" }}>
          <button className="primary">下載照片</button>
        </a>

        {typeof navigator !== "undefined" && (navigator as any).share && (
          <button onClick={onShare} disabled={busy}>分享 / 傳送</button>
        )}
      </div>

      <div className="muted">
        下載小提醒：Android 多數可直接下載；iOS/Safari 可能需要「長按圖片→加入照片」。
      </div>
    </div>
  );
}
