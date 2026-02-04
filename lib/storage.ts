import fs from "node:fs";
import path from "node:path";

export const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

export type UploadMeta = {
  token: string;
  createdAt: number;
  expiresAt: number;
  fileName: string;
  mime: string;
  inputW: number;
  inputH: number;
  exportW: number;
  exportH: number;
};

export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function metaPath(token: string) {
  return path.join(UPLOAD_DIR, `${token}.json`);
}
export function filePath(token: string, ext: string) {
  return path.join(UPLOAD_DIR, `${token}${ext}`);
}

export function cleanupExpired(now = Date.now()) {
  ensureUploadDir();
  const files = fs.readdirSync(UPLOAD_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const p = path.join(UPLOAD_DIR, f);
    try {
      const meta = JSON.parse(fs.readFileSync(p, "utf-8")) as UploadMeta;
      if (meta.expiresAt <= now) {
        // delete json + image
        try { fs.unlinkSync(p); } catch {}
        const ext = path.extname(meta.fileName) || (meta.mime === "image/png" ? ".png" : ".jpg");
        try { fs.unlinkSync(filePath(meta.token, ext)); } catch {}
      }
    } catch {
      // invalid meta → ignore
    }
  }
}

export function readMeta(token: string): UploadMeta | null {
  const p = metaPath(token);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as UploadMeta; } catch { return null; }
}
