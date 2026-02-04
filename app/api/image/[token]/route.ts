import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { cleanupExpired, readMeta, UPLOAD_DIR } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  cleanupExpired();
  const { token } = await params;
  const meta = readMeta(token);
  if (!meta) return new NextResponse("Not found / expired", { status: 404 });

  const imgPath = path.join(UPLOAD_DIR, meta.fileName);
  if (!fs.existsSync(imgPath)) return new NextResponse("Not found", { status: 404 });

  const buf = fs.readFileSync(imgPath);
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  return new NextResponse(buf, {
    headers: {
      "Content-Type": meta.mime,
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="${token}${path.extname(meta.fileName)}"` } : {})
    }
  });
}
