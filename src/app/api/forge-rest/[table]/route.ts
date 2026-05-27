import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ table: string }>;
};

const ALLOWED_TABLES = new Set([
  "companies",
  "contact_activities",
  "contacts",
  "drafts",
  "email_action_log",
  "email_items",
  "email_triage_runs",
  "task_columns",
  "tasks",
]);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tablePrefix =
  process.env.FORGE_TABLE_PREFIX ??
  process.env.NEXT_PUBLIC_FORGE_TABLE_PREFIX ??
  "";

export const dynamic = "force-dynamic";

function resolveTableName(table: string): string {
  return tablePrefix && !table.startsWith(tablePrefix)
    ? `${tablePrefix}${table}`
    : table;
}

function stripKnownPrefix(table: string): string {
  return tablePrefix && table.startsWith(tablePrefix)
    ? table.slice(tablePrefix.length)
    : table;
}

function buildSupabaseUrl(table: string, request: NextRequest): string {
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  const url = new URL(`/rest/v1/${resolveTableName(table)}`, supabaseUrl);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  return url.toString();
}

async function handleRequest(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  if (!serviceRoleKey) {
    return new NextResponse("SUPABASE_SERVICE_ROLE_KEY is not configured.", {
      status: 500,
    });
  }

  const { table } = await context.params;
  const decodedTable = decodeURIComponent(table);
  const unprefixedTable = stripKnownPrefix(decodedTable);

  if (!ALLOWED_TABLES.has(unprefixedTable)) {
    return new NextResponse("Unknown Forge table.", { status: 404 });
  }

  const method = request.method;
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await request.text();

  let response: Response;
  try {
    response = await fetch(buildSupabaseUrl(unprefixedTable, request), {
      method,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body || undefined,
    });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Supabase request failed.",
      { status: 502 }
    );
  }

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export function GET(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}
