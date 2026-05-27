import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendDraftRequest = {
  accountEmail?: string;
  body?: string;
  messageId?: string;
  senderEmail?: string;
  subject?: string;
  threadId?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function replySubject(subject: string): string {
  if (!subject) return "Re:";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

function getGogPath(): string {
  return process.env.GOG_PATH || "/opt/homebrew/bin/gog";
}

function getAccountEmail(bodyAccount: string): string {
  return bodyAccount || process.env.FORGE_OWNER_EMAIL || "";
}

function parseGogOutput(stdout: string): unknown {
  if (!stdout.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout.trim() };
  }
}

function formatGogError(err: unknown): string {
  const message =
    err instanceof Error ? err.message : "gog failed to send the draft.";

  if (
    message.includes("GOG_KEYRING_PASSWORD") ||
    message.includes("no TTY available for keyring file backend password prompt")
  ) {
    return "Forge could not send this email because the Mini cannot unlock Gmail credentials non-interactively. Add GOG_KEYRING_PASSWORD to the Forge service environment, then try again.";
  }

  return message;
}

export async function POST(request: NextRequest) {
  let payload: SendDraftRequest;
  try {
    payload = (await request.json()) as SendDraftRequest;
  } catch {
    return new NextResponse("Invalid JSON body.", { status: 400 });
  }

  const body = normalizeString(payload.body);
  const accountEmail = getAccountEmail(normalizeString(payload.accountEmail));
  const messageId = normalizeString(payload.messageId);
  const senderEmail = normalizeString(payload.senderEmail);
  const subject = replySubject(normalizeString(payload.subject));
  const threadId = normalizeString(payload.threadId);

  if (!body) {
    return new NextResponse("Draft body is required.", { status: 400 });
  }

  if (!accountEmail) {
    return new NextResponse("Forge owner email is not configured.", { status: 500 });
  }

  if (!threadId && !messageId && !senderEmail) {
    return new NextResponse(
      "Cannot send draft without a Gmail thread, message, or recipient.",
      { status: 400 }
    );
  }

  const draftPath = path.join(os.tmpdir(), `forge-draft-${randomUUID()}.txt`);
  await fs.writeFile(draftPath, body, "utf8");

  const args = [
    "--json",
    "--no-input",
    "--account",
    accountEmail,
    "gmail",
    "send",
    "--subject",
    subject,
    "--body-file",
    draftPath,
  ];

  if (threadId) {
    args.push("--thread-id", threadId, "--reply-all");
  } else if (messageId) {
    args.push("--reply-to-message-id", messageId, "--reply-all");
  } else {
    args.push("--to", senderEmail);
  }

  try {
    const { stdout } = await execFileAsync(getGogPath(), args, {
      env: {
        ...process.env,
        PATH: [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
          process.env.PATH ?? "",
        ].join(":"),
      },
      maxBuffer: 1024 * 1024,
      timeout: 30000,
    });

    return NextResponse.json({
      ok: true,
      provider: "gog",
      result: parseGogOutput(stdout),
    });
  } catch (err) {
    return new NextResponse(formatGogError(err), { status: 502 });
  } finally {
    await fs.rm(draftPath, { force: true });
  }
}
