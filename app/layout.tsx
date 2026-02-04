import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "線上拍貼 Online Photobooth",
  description: "相機預覽（含美顏）→ 倒數拍照 → 合成邊框 → 上傳 → QR Code 下載"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        <div className="container">
          {children}
        </div>
      </body>
    </html>
  );
}
