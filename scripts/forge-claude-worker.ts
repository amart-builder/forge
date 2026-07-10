import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createDayPlanStore } from "../src/lib/day-plan/store";
import {
  drainClaudeQueues,
  runOneAssistantTurn,
  runOneExecution,
  watchClaudeQueues,
} from "../src/lib/claude-execution/worker";

async function main(): Promise<number> {
  const laneIndex = process.argv.indexOf("--lane");
  const lane = laneIndex >= 0 ? process.argv[laneIndex + 1] : undefined;
  if (!["assistant", "execution", "all", "watch"].includes(lane ?? "")) return 2;
  if (process.env.FORGE_CLAUDE_WORKER_ENABLED !== "1") return 3;
  const repoDir = process.cwd();
  const claudePath = process.env.FORGE_CLAUDE_BIN ?? path.join(homedir(), ".local", "bin", "claude");
  if (!existsSync(claudePath)) {
    return 4;
  }
  const store = createDayPlanStore({
    dbPath: process.env.FORGE_DB_PATH ?? path.join(repoDir, "data", "forge.db"),
  });
  const heartbeatPath = path.join(repoDir, "data", "claude-worker.heartbeat");
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    const shutdown = new AbortController();
    const stop = () => shutdown.abort();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    const options = {
      store,
      claudePath,
      emptyMcpConfigPath: path.join(repoDir, "scripts", "forge-empty-mcp.json"),
      logDir: path.join(repoDir, "data", "claude-runs"),
      fallbackCwd: repoDir,
      abortSignal: shutdown.signal,
    };
    if (lane === "watch") {
      mkdirSync(path.dirname(heartbeatPath), { recursive: true, mode: 0o700 });
      const writeHeartbeat = () => writeFileSync(
        heartbeatPath,
        `${new Date().toISOString()}\n`,
        { mode: 0o600 },
      );
      writeHeartbeat();
      heartbeat = setInterval(writeHeartbeat, 2000);
    }
    if (lane === "assistant") await runOneAssistantTurn(options);
    else if (lane === "execution") await runOneExecution(options);
    else if (lane === "all") await drainClaudeQueues(options);
    else await watchClaudeQueues(options);
    return 0;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (lane === "watch") rmSync(heartbeatPath, { force: true });
    store.close();
  }
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
