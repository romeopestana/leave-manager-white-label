const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_FILE = path.join(DATA_DIR, "app-store.json");

const DEFAULT_STORE = {
  employees: [],
  users: [],
  leaveRequests: [],
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      leaveRequests: Array.isArray(parsed.leaveRequests) ? parsed.leaveRequests : [],
    };
  } catch {
    return { ...DEFAULT_STORE, employees: [], users: [], leaveRequests: [] };
  }
}

function writeStore(store) {
  ensureStore();
  const payload = {
    employees: Array.isArray(store.employees) ? store.employees : [],
    users: Array.isArray(store.users) ? store.users : [],
    leaveRequests: Array.isArray(store.leaveRequests) ? store.leaveRequests : [],
  };
  fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

module.exports = {
  readStore,
  writeStore,
  STORE_FILE,
};
