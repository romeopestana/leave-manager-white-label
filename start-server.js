// Loads DATABASE_URL from local ".env" (if present) and then starts server.js.
// This avoids fragile batch-file parsing for environment variables.

const fs = require("fs");
const path = require("path");

const projectDir = __dirname;
const envPath = path.join(projectDir, ".env");

function loadEnvFileIfPresent() {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key] && key) process.env[key] = value;
  }
}

loadEnvFileIfPresent();

// Start the actual Express server (server.js calls app.listen on import).
require("./server.js");

