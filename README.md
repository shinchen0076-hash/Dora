# 線上拍貼（Next.js + TypeScript）— 完整可執行專案

此專案實作流程：  
「使用者選邊框 → 開相機即時預覽（含美顏）→ 自動倒數 3 秒拍照 → 合成（照片+邊框）→ 上傳合成圖 → 產生 QR Code → 手機掃描開啟下載頁 → 下載/儲存照片」。

---

## 1) Windows 安裝/執行步驟（照做即可）

1. 下載並解壓縮專案（資料夾名稱：`online-photobooth-ts`）
2. 打開 Windows 終端機 / PowerShell
3. `cd` 進到**有 package.json 的資料夾**（避免你之前遇到的 ENOENT）

```bash
cd path\to\online-photobooth-ts
dir
# 你應該要看到 package.json
```

4. 安裝依賴

```bash
npm install
```

5. 開發模式啟動（http://localhost:3000）

```bash
npm run dev
```

6. 若你要正式模式

```bash
npm run build
npm start
```

---

## 2) 功能對照（驗收標準）

- 邊框最多 5 個、可點選切換、可移除、可拖曳排序（@dnd-kit）
- 按「拍照」固定倒數 3 秒（3→2→1→0）並可取消
- 預覽與輸出皆採 3:4 置中裁切（避免預覽與輸出不一致）
- 拍照優先使用 ImageCapture.takePhoto（高解析 still）— 失敗才退回 drawImage(video)
- 畫質優先：若裁切後不足以支撐 2160×2880，不會硬放大，會自動把輸出降到接近輸入解析度（仍 3:4）並提示
- 合成後上傳到後端（Next.js Route Handler），回傳短連結 token，前端用 QR code 顯示
- 手機掃描 /p/{token} 看到下載頁（大按鈕 + 解析度資訊 + Web Share）

---

## 3) 瀏覽器權限與限制（必讀）

- 相機需要 Secure Context（HTTPS / localhost）。  
  若你用 `http://IP:3000` 在手機上開，通常會被擋；建議：
  - 本機測試：直接用 `http://localhost:3000`
  - 手機測試：用 `ngrok http 3000` 或自己架 HTTPS 反向代理
- 不同手機/瀏覽器對 takePhoto 支援度不同；本專案會自動降級並在 UI 提示。

---

## 4) 上傳檔案儲存與過期

- 儲存位置：`/.data/uploads`
- 每次 upload / 讀取都會清理超過 24 小時的檔案（簡易清理策略，避免堆積）
- 若要更嚴謹（背景排程清理），可以在部署平台用 cron job 或 serverless 定時清理。

---

## 5) 重要提醒：你若遇到 ENOENT 找不到 package.json

代表你在錯的資料夾跑 `npm start`。  
請務必先 `cd` 到 **包含 package.json 的那一層** 再執行（上面步驟已示範）。

---

## 參考資料（APA）

- Mozilla. (2025, November 30). *MediaDevices.getUserMedia()* (Web APIs). MDN Web Docs.  
- Mozilla. (2024, July 26). *MediaStreamTrack.getSettings()* (Web APIs). MDN Web Docs.  
- Mozilla. (2025, June 23). *ImageCapture.takePhoto()* (Web APIs). MDN Web Docs.  
- Mozilla. (2025, September 25). *CanvasRenderingContext2D.imageSmoothingQuality* (Web APIs). MDN Web Docs.  
- Google. (2024, May 7). *FaceLandmarker class* (MediaPipe Tasks Vision JS API). Google AI Edge.  
- Tomasi, C., & Manduchi, R. (1998). Bilateral filtering for gray and color images. *Proceedings of the IEEE International Conference on Computer Vision*.
