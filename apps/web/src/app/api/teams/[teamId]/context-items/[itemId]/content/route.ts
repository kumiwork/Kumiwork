import { NextResponse } from "next/server";
import { getTeamContextItemForOrg } from "@kumiwork/db";
import { createBlobStore } from "@kumiwork/storage";
import { requireAuthContext } from "@/server/auth";

let blobStore: ReturnType<typeof createBlobStore> | undefined;
function getBlobStore() {
  if (!blobStore) blobStore = createBlobStore();
  return blobStore;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ teamId: string; itemId: string }> },
) {
  const ctx = await requireAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const item = await getTeamContextItemForOrg(Number(itemId), ctx.orgId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await getBlobStore().get(item.orgId, item.sha256);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": item.mime, "X-Content-Type-Options": "nosniff" },
  });
}
