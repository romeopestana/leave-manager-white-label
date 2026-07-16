const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { readStore, writeStore } = require("./fileStore");

const ROLES = ["admin", "employee", "exco"];

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    employeeId: user.employeeId || null,
    active: user.active !== false,
    createdAt: user.createdAt,
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailDomain(email) {
  const parts = normalizeEmail(email).split("@");
  return parts.length === 2 ? parts[1] : "";
}

function isDomainAllowed(email, companyDomains) {
  const domains = Array.isArray(companyDomains)
    ? companyDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : [];
  if (!domains.length) return true; // open until configured
  const domain = emailDomain(email);
  return domains.includes(domain);
}

function listUsers() {
  return readStore().users.map(publicUser);
}

function findUserByEmail(email) {
  const target = normalizeEmail(email);
  return readStore().users.find((u) => normalizeEmail(u.email) === target) || null;
}

function findUserById(id) {
  return readStore().users.find((u) => u.id === id) || null;
}

async function createUser({ email, name, role, password, employeeId = null }, companyDomains = []) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) {
    throw new Error("A valid company email is required.");
  }
  if (!isDomainAllowed(normalized, companyDomains)) {
    throw new Error("Email domain is not allowed for this company.");
  }
  if (!ROLES.includes(role)) {
    throw new Error("Role must be admin, employee, or exco.");
  }
  if (findUserByEmail(normalized)) {
    throw new Error("A user with this email already exists.");
  }
  if (!password || String(password).length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const store = readStore();
  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    name: String(name || "").trim() || normalized,
    role,
    employeeId: employeeId || null,
    passwordHash: await bcrypt.hash(String(password), 10),
    active: true,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeStore(store);
  return publicUser(user);
}

async function updateUser(id, patch, companyDomains = []) {
  const store = readStore();
  const idx = store.users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error("User not found.");

  const current = store.users[idx];
  const next = { ...current };

  if (patch.email != null) {
    const normalized = normalizeEmail(patch.email);
    if (!isDomainAllowed(normalized, companyDomains)) {
      throw new Error("Email domain is not allowed for this company.");
    }
    const clash = store.users.find((u) => u.id !== id && normalizeEmail(u.email) === normalized);
    if (clash) throw new Error("A user with this email already exists.");
    next.email = normalized;
  }
  if (patch.name != null) next.name = String(patch.name).trim();
  if (patch.role != null) {
    if (!ROLES.includes(patch.role)) throw new Error("Role must be admin, employee, or exco.");
    next.role = patch.role;
  }
  if (patch.employeeId !== undefined) next.employeeId = patch.employeeId || null;
  if (patch.active != null) next.active = Boolean(patch.active);
  if (patch.password) {
    if (String(patch.password).length < 8) {
      throw new Error("Temporary password must be at least 8 characters.");
    }
    next.passwordHash = await bcrypt.hash(String(patch.password), 10);
  }

  store.users[idx] = next;
  writeStore(store);
  return publicUser(next);
}

function deleteUser(id) {
  const store = readStore();
  const nextUsers = store.users.filter((u) => u.id !== id);
  if (nextUsers.length === store.users.length) throw new Error("User not found.");
  store.users = nextUsers;
  writeStore(store);
}

async function verifyLogin(email, password, companyDomains = []) {
  const user = findUserByEmail(email);
  if (!user || user.active === false) return null;
  if (!isDomainAllowed(user.email, companyDomains)) return null;
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash || "");
  return ok ? user : null;
}

async function ensureSeedAdmin(companyDomains = []) {
  const store = readStore();
  if (store.users.length) return null;

  const seedEmail = process.env.SEED_ADMIN_EMAIL || "admin@yourcompany.com";
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const seedName = process.env.SEED_ADMIN_NAME || "System Admin";

  // Allow seed even if domain list is empty / mismatched during bootstrap.
  const user = {
    id: crypto.randomUUID(),
    email: normalizeEmail(seedEmail),
    name: seedName,
    role: "admin",
    employeeId: null,
    passwordHash: await bcrypt.hash(seedPassword, 10),
    active: true,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeStore(store);
  return {
    email: user.email,
    password: seedPassword,
    note: "Change this password after first login. Configure companyDomains in config/brand.json.",
  };
}

module.exports = {
  ROLES,
  publicUser,
  normalizeEmail,
  isDomainAllowed,
  listUsers,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  verifyLogin,
  ensureSeedAdmin,
};
