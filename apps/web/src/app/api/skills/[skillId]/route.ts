import { NextResponse } from "next/server";
import {
  decomposeSkillMarkdown,
  deleteSkillForOrg,
  getSkillForOrg,
  getSkillVersion,
  getSkillVersionMarkdown,
  getSkillVersionsForSkill,
} from "@agentfactory/db";
import { requireAuthContext } from "@/server/auth";
import { createLogger } from "@agentfactory/logger";

const log = createLogger("api:skills:[skillId]");

async function readCurrentVersionInstructions(
  orgId: number,
  currentVersionId: number | undefined,
): Promise<string | undefined> {
  if (!currentVersionId) return undefined;
  try {
    const currentVersion = await getSkillVersion(currentVersionId);
    if (!currentVersion) return undefined;
    const markdown = await getSkillVersionMarkdown(orgId, currentVersion);
    return markdown ? decomposeSkillMarkdown(markdown).instructions : undefined;
  } catch (err) {
    log.warn("Failed to read current version instructions", { currentVersionId, err });
    return undefined;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const skillId = Number((await params).skillId);
  const skill = await getSkillForOrg(skillId, ctx.orgId);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const versions = await getSkillVersionsForSkill(skillId);
  const currentVersionInstructions = await readCurrentVersionInstructions(ctx.orgId, skill.currentVersionId);
  return NextResponse.json({ skill, versions, currentVersionInstructions });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const skillId = Number((await params).skillId);
  const skill = await getSkillForOrg(skillId, ctx.orgId);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const deleted = await deleteSkillForOrg(skillId, ctx.orgId);
  if (!deleted) {
    return NextResponse.json({ error: "Skill is assigned to an agent; unassign it first" }, { status: 409 });
  }
  return new NextResponse(null, { status: 204 });
}
