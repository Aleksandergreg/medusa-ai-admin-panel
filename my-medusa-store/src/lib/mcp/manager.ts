import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { MedusaMcpClient } from "./client";

let instance: MedusaMcpClient | null = null;
let connecting: Promise<MedusaMcpClient> | null = null;

export async function getMcp(): Promise<MedusaMcpClient> {
  if (instance) return instance;
  if (connecting) return connecting;

  // Ensure medusa-mcp is built if dist is missing or stale
  const mcpRoot = path.resolve(process.cwd(), "..", "medusa-mcp");
  const serverEntry = path.resolve(mcpRoot, "dist", "index.js");
  try {
    const distStat = fs.existsSync(serverEntry) ? fs.statSync(serverEntry) : null;
    const srcCandidates = [
      path.resolve(mcpRoot, "src", "index.ts"),
      path.resolve(mcpRoot, "src", "tools", "analytics-tool-factory.ts"),
      path.resolve(mcpRoot, "src", "tools", "promotion-analytics-tool-factory.ts"),
    ].filter(fs.existsSync);
    const newestSrcMtime = srcCandidates.reduce<number>((acc, p) => {
      try {
        const st = fs.statSync(p);
        return Math.max(acc, st.mtimeMs);
      } catch {
        return acc;
      }
    }, 0);
    const distIsStale = !distStat || distStat.mtimeMs < newestSrcMtime;
    if (distIsStale) {
      const build = spawnSync("npm", ["run", "build"], { cwd: mcpRoot, stdio: "inherit" });
      if (build.status !== 0 || !fs.existsSync(serverEntry)) {
        // Fallback to using existing dist if present; otherwise rethrow
        if (!distStat) {
          throw new Error("Failed to build medusa-mcp server; dist/index.js missing");
        }
      }
    }
  } catch (err) {
    // Non-fatal: we'll try to run whatever is present in dist
     
    console.warn("Warning: could not verify/build medusa-mcp dist:", err);
  }
  const env: Record<string, string> = {
    ...process.env as any,
  };
  const client = new MedusaMcpClient({ serverEntry, cwd: path.dirname(serverEntry), env });
  connecting = client.connect().then(() => {
    instance = client;
    connecting = null;
    return client;
  });
  return connecting;
}

export async function closeMcp(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
