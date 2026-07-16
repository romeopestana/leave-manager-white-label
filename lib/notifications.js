const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const OUTBOX_FILE = path.join(__dirname, "..", "data", "email-outbox.jsonl");

function ensureOutbox() {
  const dir = path.dirname(OUTBOX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(OUTBOX_FILE)) fs.writeFileSync(OUTBOX_FILE, "", "utf8");
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function appBaseUrl() {
  const fromEnv = (process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const port = process.env.PORT || 3001;
  return `http://localhost:${port}`;
}

function loginUrl() {
  return `${appBaseUrl()}/login.html`;
}

function normalizeAddressList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return [
    ...new Set(
      list
        .map((v) => String(v || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    String(process.env.SMTP_SECURE || "true").toLowerCase() === "true" || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function appendOutbox(entry) {
  ensureOutbox();
  fs.appendFileSync(OUTBOX_FILE, JSON.stringify(entry) + "\n", "utf8");
}

/**
 * Sends email via SMTP when configured; always writes a local outbox copy.
 * Supports `cc` (string or array). Falls back to outbox-only when SMTP is unavailable.
 */
async function notify({ to, cc, subject, body, meta = {} }) {
  const toList = normalizeAddressList(to);
  const ccList = normalizeAddressList(cc).filter((addr) => !toList.includes(addr));
  const base = {
    at: new Date().toISOString(),
    to: toList,
    cc: ccList,
    subject,
    body,
    meta,
  };

  if (!toList.length) {
    const entry = { ...base, status: "skipped", reason: "No recipients" };
    appendOutbox(entry);
    return entry;
  }

  if (!smtpConfigured()) {
    const entry = { ...base, status: "queued-local", reason: "SMTP not configured" };
    appendOutbox(entry);
    console.log(`[notify:local] to=${toList.join(",")} cc=${ccList.join(",")} subject=${subject}`);
    return entry;
  }

  try {
    const transporter = createTransport();
    const from =
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      "Leave Manager <noreply@localhost>";
    const info = await transporter.sendMail({
      from,
      to: toList.join(", "),
      cc: ccList.length ? ccList.join(", ") : undefined,
      subject,
      text: body,
    });
    const entry = {
      ...base,
      status: "sent",
      messageId: info.messageId || null,
    };
    appendOutbox(entry);
    console.log(`[notify:smtp] to=${toList.join(",")} cc=${ccList.join(",")} subject=${subject}`);
    return entry;
  } catch (err) {
    const entry = {
      ...base,
      status: "smtp-failed-queued-local",
      error: String(err.message || err),
    };
    appendOutbox(entry);
    console.error(`[notify:smtp-failed] to=${toList.join(",")} subject=${subject}`, err.message || err);
    return entry;
  }
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
  smtpConfigured,
  appBaseUrl,
  loginUrl,
  OUTBOX_FILE,
};
