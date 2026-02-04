"use client";

import { QRCodeCanvas } from "qrcode.react";

export default function QrPanel({ url }: { url: string }) {
  return (
    <div className="qrBox">
      <div>
        <QRCodeCanvas value={url} size={200} includeMargin />
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="muted">手機掃描即可進入下載頁：</div>
        <div style={{ wordBreak: "break-all" }}>{url}</div>
        <div className="muted small">若你在同一台手機上操作，也可以直接點開網址。</div>
        <a href={url} style={{ textDecoration: "none" }}>
          <button>開啟下載頁</button>
        </a>
      </div>
    </div>
  );
}
