import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getBuddyStore, type BuddyStore } from "@/lib/buddy/store";
import { seedBuddySession } from "@/lib/buddy/spawn-session";
import { getQuietCurrentCsrfToken } from "@/lib/quiet-current/store";
import { hasDayPlanRouteAccess } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

type SpawnRouteDependencies = {
  store?: BuddyStore;
  homeDir?: string;
  randomId?: () => string;
  realpath?: typeof realpathSync;
  stat?: typeof statSync;
  seed?: typeof seedBuddySession;
};

class SpawnRequestError extends Error {}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new SpawnRequestError(`${name} is invalid.`);
  }
  return value.trim();
}

export function resolveBuddySpawnDirectory(rawDir: string, dependencies: SpawnRouteDependencies = {}): string {
  const home = dependencies.homeDir ?? os.homedir();
  const expanded = rawDir === "~"
    ? home
    : rawDir.startsWith(`~${path.sep}`) ? path.join(home, rawDir.slice(2)) : rawDir;
  const resolved = path.resolve(expanded);
  let real: string;
  try {
    real = (dependencies.realpath ?? realpathSync)(resolved);
  } catch {
    throw new SpawnRequestError("Project directory does not exist.");
  }
  let directory: boolean;
  try {
    directory = (dependencies.stat ?? statSync)(real).isDirectory();
  } catch {
    throw new SpawnRequestError("Project directory does not exist.");
  }
  if (!directory) throw new SpawnRequestError("Project path must be a directory.");
  const atlasRoot = path.join(home, "Atlas");
  if (real !== atlasRoot && !real.startsWith(`${atlasRoot}${path.sep}`)) {
    throw new SpawnRequestError("Project directory must be inside ~/Atlas.");
  }
  return real;
}

function denied(request: NextRequest, csrf: boolean): NextResponse | undefined {
  if (!hasDayPlanRouteAccess(request)) {
    return NextResponse.json({ error: "Untrusted request host." }, { status: 403 });
  }
  if (csrf && request.headers.get("x-forge-csrf") !== getQuietCurrentCsrfToken()) {
    return NextResponse.json({ error: "Forge request token is missing." }, { status: 403 });
  }
}

function publicSession(session: NonNullable<ReturnType<BuddyStore["getSpawnedSession"]>>) {
  return {
    sessionId: session.session_id,
    dir: session.dir,
    title: session.title,
    state: session.state,
    error: session.error,
    createdAt: session.created_at,
    hostname: os.hostname(),
    deepLinksEnabled: process.env.FORGE_BUDDY_DEEPLINKS !== "0",
  };
}

export async function handleSpawnSessionPost(
  request: NextRequest,
  dependencies: SpawnRouteDependencies = {},
) {
  const accessError = denied(request, true);
  if (accessError) return accessError;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      throw new SpawnRequestError("Spawn request is too large.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SpawnRequestError("Spawn request is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SpawnRequestError("Spawn request is invalid.");
    }
    const body = parsed as Record<string, unknown>;
    const rawDir = requiredText(body.dir, "dir", 2_000);
    const prompt = requiredText(body.prompt, "prompt", 8_000);
    const title = body.title === undefined
      ? "Buddy session"
      : requiredText(body.title, "title", 120);
    const dir = resolveBuddySpawnDirectory(rawDir, dependencies);
    const sessionId = (dependencies.randomId ?? randomUUID)();
    const store = dependencies.store ?? getBuddyStore();
    store.createSpawnedSession({ sessionId, dir, title });
    (dependencies.seed ?? seedBuddySession)({ store, sessionId, dir, prompt, title });
    return NextResponse.json({ sessionId, state: "seeding" });
  } catch (error) {
    if (!(error instanceof SpawnRequestError)) {
      console.error("Buddy session spawn failed.", error);
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not start the Claude session.",
    }, { status: error instanceof SpawnRequestError ? 400 : 500 });
  }
}

export async function handleSpawnSessionGet(
  request: NextRequest,
  dependencies: SpawnRouteDependencies = {},
) {
  const accessError = denied(request, false);
  if (accessError) return accessError;
  const sessionId = request.nextUrl.searchParams.get("id")?.trim();
  if (!sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const session = (dependencies.store ?? getBuddyStore()).getSpawnedSession(sessionId);
  return session
    ? NextResponse.json(publicSession(session))
    : NextResponse.json({ error: "Spawned session not found." }, { status: 404 });
}

export function POST(request: NextRequest) {
  return handleSpawnSessionPost(request);
}

export function GET(request: NextRequest) {
  return handleSpawnSessionGet(request);
}
