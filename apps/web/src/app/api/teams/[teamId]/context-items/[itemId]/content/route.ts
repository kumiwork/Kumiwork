import { NextResponse } from "next/server";
import { getTeamContextItemForOrg } from "@agentfactory/db";
import { createBlobStore } from "@agentfactory/storage";
import { requireAuthContext } from "@/server/auth";

let blobStore: ReturnType<typeof createBlobStore> | undefined;
function getBlobStore() {
  if (!blobStore) blobStore = createBlobStore();
  return blobStore;
}

// Mirrors apps/web/src/app/api/tasks/[taskId]/context-items/[itemId]/content/route.ts — a
// generic content-serving route, not markdown-specific: it streams whatever bytes and mime an
// item has. Only the panel's choice to preview it through ContentViewer makes this "the
// document preview route" in practice.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ teamId: string; itemId: string }> },
) {
  const ctx = await requireAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;
  const item = await getTeamContextItemForOrg(Number(itemId), ctx.orgId);
  // 404, not 403: an item in another org must not be distinguishable from one that isn't there.
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await getBlobStore().get(item.orgId, item.sha256);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": item.mime, "X-Content-Type-Options": "nosniff" },
  });
}
