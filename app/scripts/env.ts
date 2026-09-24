// Imported first by every script so NEXT_PUBLIC_* config resolves like in the app.
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const APP_DIR = join(__dirname, "..");
export const REPO_DIR = join(APP_DIR, "..");
export const ENV_FILE = join(APP_DIR, ".env.local");

config({ path: ENV_FILE, quiet: true });

/** Sets `key=value` lines in .env.local without touching any other line. */
export function upsertEnv(values: Record<string, string>): void {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
    process.env[key] = value;
  }
  writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"));
}
