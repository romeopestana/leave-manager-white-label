const fs = require("fs");
const path = require("path");

const OUTBOX_FILE = path.join(__dirname, "..", "data", "email-outbox.jsonl");

function ensureOutbox() {
  const dir = path.dirname(OUTBOX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(OUTBOX_FILE)) fs.writeFileSync(OUTBOX_FILE, "", "utf8");
}

/**
 * Phase 1 stub: writes notification payloads to a local outbox file.
 * Later this will send via Google Workspace SMTP.
 */
async function notify({ to, subject, body, meta = {} }) {
  ensureOutbox();
  const entry = {
    at: new Date().toISOString(),
    to,
    subject,
    body,
    meta,
    status: "queued-local",
  };
  fs.appendFileSync(OUTBOX_FILE, JSON.stringify(entry) + "\n", "utf8");
  console.log(`[notify] to=${to} subject=${subject}`);
  return entry;
}

async function notifyMany(messages) {
  const results = [];
  for (const msg of messages) {
    results.push(await notify(msg));
  }
  return results;
}

module.exports = {
  notify,
  notifyMany,
  OUTBOX_FILE,
};
