import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Forge sends email by calling Composio's tool-execution API with the user's own
// API key (kept in .env.local) and their connected Gmail account. Nothing personal
// to any one machine lives here; it works on any client's Mac once Email is set up.
const COMPOSIO_EXECUTE_URL =
  "https://backend.composio.dev/api/v3/tools/execute/GMAIL_REPLY_TO_THREAD";

type SendDraftRequest = {
  accountEmail?: string;
  body?: string;
  messageId?: string;
  senderEmail?: string;
  subject?: string;
  threadId?: string;
};

type ComposioResponse = {
  successful?: boolean;
  error?: string | null;
  data?: unknown;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The connected account id is written by the Email setup step. It is optional:
// if a Composio API key has a single Gmail connection, Composio uses it by default.
async function readConnectedAccountId(): Promise<string> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "forge-email.json"),
      "utf8"
    );
    const config = JSON.parse(raw) as { connected_account_id?: string };
    return normalizeString(config.connected_account_id);
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  let payload: SendDraftRequest;
  try {
    payload = (await request.json()) as SendDraftRequest;
  } catch {
    return new NextResponse("Invalid JSON body.", { status: 400 });
  }

  const body = normalizeString(payload.body);
  const senderEmail = normalizeString(payload.senderEmail);
  const threadId = normalizeString(payload.threadId);

  if (!body) {
    return new NextResponse("Draft body is required.", { status: 400 });
  }
  if (!threadId) {
    return new NextResponse(
      "This version sends replies to an existing email thread. No thread id was found for this item.",
      { status: 400 }
    );
  }
  if (!senderEmail) {
    return new NextResponse("Cannot send a reply without a recipient.", {
      status: 400,
    });
  }

  const apiKey = normalizeString(process.env.COMPOSIO_API_KEY);
  if (!apiKey) {
    return new NextResponse(
      "Email sending is not set up yet. Run the Email step in SETUP.md to connect Gmail through Composio.",
      { status: 500 }
    );
  }

  const connectedAccountId = await readConnectedAccountId();
  const requestBody: Record<string, unknown> = {
    arguments: {
      thread_id: threadId,
      recipient_email: senderEmail,
      message_body: body,
      is_html: false,
    },
  };
  if (connectedAccountId) requestBody.connected_account_id = connectedAccountId;

  try {
    const response = await fetch(COMPOSIO_EXECUTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    const result = (await response
      .json()
      .catch(() => null)) as ComposioResponse | null;

    if (!response.ok || !result || result.successful === false) {
      const message =
        (result && result.error) ||
        `Gmail send failed (HTTP ${response.status}).`;
      return new NextResponse(message, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      provider: "composio",
      result: result.data ?? null,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const message = isTimeout
      ? "Composio took too long to send the email. Try again."
      : err instanceof Error
        ? err.message
        : "Could not reach Composio to send the email.";
    return new NextResponse(message, { status: 502 });
  }
}
