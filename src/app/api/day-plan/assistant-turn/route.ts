import { NextRequest, NextResponse } from "next/server";
import {
  currentDayPlanAccessMode,
  hasDayPlanRouteAccess,
} from "@/lib/request-security";
import { publicDayPlan } from "@/lib/day-plan/public-execution";
import {
  DayPlanInvalidTransition,
  DayPlanNotFound,
  DayPlanVersionConflict,
  getDayPlanStore,
} from "@/lib/day-plan/store";
import { getQuietCurrentCsrfToken } from "@/lib/quiet-current/store";
import { triggerOneShotWorker } from "@/lib/claude-execution/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const MUTATION_ID = /^[A-Za-z0-9:_-]+$/;

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${name} is too long.`);
  return result;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value as number;
}

export function parseAssistantTurnPostBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const mutationId = text(body.mutationId, "mutationId", 240);
  if (!MUTATION_ID.test(mutationId)) throw new Error("mutationId has an invalid format.");
  return {
    id: mutationId,
    planId: text(body.planId, "planId", 200),
    expectedVersion: positiveInteger(body.expectedVersion, "expectedVersion"),
    userText: text(body.userText, "userText", 4000),
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof DayPlanVersionConflict) {
    return NextResponse.json(
      {
        error: "version_conflict",
        currentPlan: publicDayPlan(error.currentPlan, currentDayPlanAccessMode()),
      },
      { status: 409 },
    );
  }
  if (error instanceof DayPlanNotFound) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof DayPlanInvalidTransition || error instanceof SyntaxError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Assistant turn failed." },
    { status: 400 },
  );
}

export async function GET(request: NextRequest) {
  if (!hasDayPlanRouteAccess(request)) {
    return NextResponse.json({ error: "Untrusted request host." }, { status: 403 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const turn = getDayPlanStore().getAssistantTurn(id);
  return turn
    ? NextResponse.json({ turn })
    : NextResponse.json({ error: "Assistant turn not found." }, { status: 404 });
}

export async function POST(request: NextRequest) {
  if (!hasDayPlanRouteAccess(request)) {
    return NextResponse.json({ error: "Untrusted request host." }, { status: 403 });
  }
  if (request.headers.get("x-forge-csrf") !== getQuietCurrentCsrfToken()) {
    return NextResponse.json({ error: "Forge request token is missing." }, { status: 403 });
  }
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Assistant request is too large." }, { status: 413 });
    }
    const result = getDayPlanStore().createAssistantTurn(
      parseAssistantTurnPostBody(JSON.parse(raw) as unknown),
    );
    const worker = result.turn.state === "queued"
      ? triggerOneShotWorker("assistant")
      : undefined;
    return NextResponse.json(
      { ...result, worker },
      { status: result.replayed ? 200 : 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
