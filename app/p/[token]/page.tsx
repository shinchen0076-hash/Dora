import { readMeta, cleanupExpired } from "@/lib/storage";
import DownloadClient from "./DownloadClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  cleanupExpired();
  const { token } = await params;
  const meta = readMeta(token);

  if (!meta) {
    return (
      <div className="card">
        <h1>下載連結已失效</h1>
        <div className="muted">此照片可能已超過保存期限（24 小時）或已被刪除。</div>
      </div>
    );
  }

  const imgUrl = `/api/image/${token}`;
  return (
    <div className="card">
      <h1>拍貼下載</h1>
      <div className="muted">提示：iPhone 若無法直接下載，請長按圖片 → 儲存到照片。</div>
      <div className="hr" />
      <DownloadClient token={token} imgUrl={imgUrl} meta={meta} />
    </div>
  );
}
