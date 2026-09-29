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

export async function GET(_request: Request, { params }: { params: Promise<{ skillId: string }> }) {
  const ctx = await requireAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const skillId = Number((await params).skillId);
  const skill = await getSkillForOrg(skillId, ctx.orgId);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const versions = await getSkillVersionsForSkill(skillId);
  const currentVersion = skill.currentVersionId ? await getSkillVersion(skill.currentVersionId) : undefined;
  const currentVersionMarkdown = currentVersion ? await getSkillVersionMarkdown(ctx.orgId, currentVersion) : undefined;
  const currentVersionInstructions = currentVersionMarkdown
    ? decomposeSkillMarkdown(currentVersionMarkdown).instructions
    : undefined;
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
