import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cleanupExpired, ensureUploadDir, metaPath, filePath, type UploadMeta } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXP_HOURS = 24;

export async function POST(req: Request) {
  cleanupExpired();
  ensureUploadDir();

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const fd = await req.formData();
  const file = fd.get("file");
  const metaStr = fd.get("meta");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const mime = file.type || "image/jpeg";
  const ext = mime === "image/png" ? ".png" : ".jpg";

  const buf = Buffer.from(await file.arrayBuffer());
  const outFile = filePath(token, ext);
  fs.writeFileSync(outFile, buf);

  let meta: Partial<UploadMeta> = {};
  try {
    if (typeof metaStr === "string") meta = JSON.parse(metaStr);
  } catch {}

  const createdAt = Date.now();
  const expiresAt = createdAt + EXP_HOURS * 60 * 60 * 1000;

  const fullMeta: UploadMeta = {
    token,
    createdAt,
    expiresAt,
    fileName: `${token}${ext}`,
    mime,
    inputW: Number(meta.inputW ?? 0),
    inputH: Number(meta.inputH ?? 0),
    exportW: Number(meta.exportW ?? 0),
    exportH: Number(meta.exportH ?? 0)
  };

  fs.writeFileSync(metaPath(token), JSON.stringify(fullMeta, null, 2), "utf-8");

  const url = `${origin}/p/${token}`;
  return NextResponse.json({ token, url });
}
