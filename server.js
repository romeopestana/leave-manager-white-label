const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const { Pool } = require("pg");

const { readStore, writeStore } = require("./lib/fileStore");
const users = require("./lib/users");
const leaveRequests = require("./lib/leaveRequests");
const { notify, smtpConfigured } = require("./lib/notifications");
const googleAuth = require("./lib/googleAuth");

function loadEnvFileIfPresent() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}
loadEnvFileIfPresent();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json({ limit: "10mb" }));
app.use(
  session({
    name: "leave.sid",
    secret: process.env.SESSION_SECRET || "dev-leave-manager-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

// -------- Config --------
function loadBrandConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "config", "brand.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function companyDomains() {
  const brand = loadBrandConfig();
  return Array.isArray(brand.companyDomains) ? brand.companyDomains : [];
}

function authOptions() {
  const brand = loadBrandConfig();
  const auth = brand.auth || {};
  const googleEnabled =
    auth.googleOAuthEnabled === true && googleAuth.googleConfigured();
  const localEnabled = auth.allowLocalLogin !== false;
  return {
    googleEnabled,
    localEnabled,
    googleConfigured: googleAuth.googleConfigured(),
    smtpConfigured: smtpConfigured(),
    companyDomains: companyDomains(),
  };
}

// -------- Postgres (optional) --------
const DB_ENABLED = Boolean(process.env.DATABASE_URL);
const pool = DB_ENABLED
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

async function initDb() {
  if (!DB_ENABLED) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      start_display TEXT NOT NULL,
      annual_start DOUBLE PRECISION NOT NULL,
      sick_start DOUBLE PRECISION NOT NULL,
      family_start DOUBLE PRECISION NOT NULL,
      study_start DOUBLE PRECISION NOT NULL,
      religious_start DOUBLE PRECISION NOT NULL,
      annual_accrual_per_month DOUBLE PRECISION NOT NULL,
      annual_max_carry_over DOUBLE PRECISION,
      annual_override DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS annual_max_carry_over DOUBLE PRECISION;

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('annual','sick','family','study','religious')),
      date_iso TIMESTAMPTZ NOT NULL,
      days DOUBLE PRECISION NOT NULL CHECK (days > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_employee_date
    ON transactions(employee_id, date_iso);

    CREATE INDEX IF NOT EXISTS idx_transactions_employee_type_date
    ON transactions(employee_id, type, date_iso);
  `);
}

// -------- Auth helpers --------
function currentUser(req) {
  return req.session?.user || null;
}

function requireAuth(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: "Authentication required." });
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required." });
    if (!roles.includes(user.role)) return res.status(403).json({ error: "Insufficient permissions." });
    return next();
  };
}

function requirePageAuth(req, res, next) {
  if (currentUser(req)) return next();
  return res.redirect("/login.html");
}

// -------- Employee persistence (Postgres or file) --------
async function loadEmployees() {
  if (!DB_ENABLED) {
    return readStore().employees;
  }

  const empRes = await pool.query(`
    SELECT
      id, name, start_display,
      annual_start, sick_start, family_start, study_start, religious_start,
      annual_accrual_per_month, annual_max_carry_over, annual_override
    FROM employees
    ORDER BY name;
  `);
  const txRes = await pool.query(`
    SELECT employee_id, type, days, date_iso
    FROM transactions
    ORDER BY employee_id, date_iso;
  `);

  const empMap = new Map();
  for (const row of empRes.rows) {
    empMap.set(row.id, {
      id: row.id,
      name: row.name,
      startDisplay: row.start_display,
      annualStart: row.annual_start,
      sickStart: row.sick_start,
      familyStart: row.family_start,
      studyStart: row.study_start,
      religiousStart: row.religious_start,
      annualAccrualPerMonth: row.annual_accrual_per_month,
      annualMaxCarryOver: row.annual_max_carry_over == null ? 0 : Number(row.annual_max_carry_over),
      ...(row.annual_override != null ? { annualOverride: row.annual_override } : {}),
      transactions: [],
    });
  }
  for (const row of txRes.rows) {
    const emp = empMap.get(row.employee_id);
    if (!emp) continue;
    emp.transactions.push({
      type: row.type,
      days: Number(row.days),
      dateISO: row.date_iso ? new Date(row.date_iso).toISOString() : null,
    });
  }
  return Array.from(empMap.values());
}

async function saveEmployees(employees) {
  if (!Array.isArray(employees)) throw new Error("Invalid employees payload.");

  if (!DB_ENABLED) {
    const store = readStore();
    store.employees = employees;
    writeStore(store);
    return { count: employees.length };
  }

  await pool.query("BEGIN");
  try {
    await pool.query("DELETE FROM transactions");
    await pool.query("DELETE FROM employees");

    for (const emp of employees) {
      if (!emp || typeof emp !== "object") continue;
      if (!emp.id || !emp.name) throw new Error("Invalid employee object in payload.");

      await pool.query(
        `
          INSERT INTO employees (
            id, name, start_display,
            annual_start, sick_start, family_start, study_start, religious_start,
            annual_accrual_per_month, annual_max_carry_over, annual_override
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          emp.id,
          emp.name,
          emp.startDisplay,
          Number(emp.annualStart ?? 0),
          Number(emp.sickStart ?? 0),
          Number(emp.familyStart ?? 0),
          Number(emp.studyStart ?? 0),
          Number(emp.religiousStart ?? 0),
          Number(emp.annualAccrualPerMonth ?? 0),
          emp.annualMaxCarryOver == null ? 0 : Number(emp.annualMaxCarryOver),
          emp.annualOverride == null ? null : Number(emp.annualOverride),
        ],
      );

      const txs = Array.isArray(emp.transactions) ? emp.transactions : [];
      for (const tx of txs) {
        if (!tx || !tx.type || !tx.dateISO) continue;
        const days = Number(tx.days ?? 0);
        if (!days || days <= 0) continue;
        const date = new Date(tx.dateISO);
        if (isNaN(date.getTime())) continue;
        await pool.query(
          `INSERT INTO transactions (employee_id, type, date_iso, days) VALUES ($1,$2,$3,$4)`,
          [emp.id, tx.type, date, days],
        );
      }
    }
    await pool.query("COMMIT");
    return { count: employees.length };
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}

async function applyApprovedLeaveToEmployee(request) {
  const employees = await loadEmployees();
  const idx = employees.findIndex((e) => e.id === request.employeeId);
  if (idx === -1) throw new Error("Employee linked to this request was not found.");
  const emp = employees[idx];
  const transactions = Array.isArray(emp.transactions) ? emp.transactions.slice() : [];
  transactions.push({
    type: request.type,
    days: Number(request.days),
    dateISO: request.dateISO,
  });
  employees[idx] = { ...emp, transactions };
  await saveEmployees(employees);
}

// -------- Logging / export --------
const LOG_FILE = path.join(__dirname, "leave-manager-log.csv");
const LOG_HEADERS =
  "Date/Time,Action,Employee Name,Start Date,Annual,Sick,Family,Study,Religious,Accrual/Month,Leave Type,Days,Leave Date";

function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function ensureLogFile() {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, LOG_HEADERS + "\n", "utf8");
  }
}

// -------- Public / auth pages --------
app.get("/", (req, res) => {
  if (!currentUser(req)) return res.redirect("/login.html");
  return res.redirect("/leave.html");
});
app.get("/leave", requirePageAuth, (req, res) => res.redirect("/leave.html"));
app.get("/leave.html", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "leave.html"));
});
app.get("/login.html", (req, res, next) => {
  if (currentUser(req)) return res.redirect("/leave.html");
  return next();
});

app.use(express.static(__dirname));

// -------- Auth API --------
app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user });
});

app.get("/api/auth/options", (req, res) => {
  res.json(authOptions());
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const opts = authOptions();
    if (!opts.localEnabled) {
      return res.status(403).json({ error: "Password login is disabled for this company." });
    }
    const email = req.body?.email;
    const password = req.body?.password;
    const user = await users.verifyLogin(email, password, companyDomains());
    if (!user) return res.status(401).json({ error: "Invalid email or password." });
    req.session.user = users.publicUser(user);
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/auth/google", (req, res) => {
  try {
    const opts = authOptions();
    if (!opts.googleEnabled) {
      return res.redirect("/login.html?error=" + encodeURIComponent("Google sign-in is not enabled."));
    }
    const url = googleAuth.getAuthorizeUrl(companyDomains());
    res.redirect(url);
  } catch (err) {
    res.redirect("/login.html?error=" + encodeURIComponent(err.message || "Google sign-in failed."));
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const opts = authOptions();
    if (!opts.googleEnabled) {
      return res.redirect("/login.html?error=" + encodeURIComponent("Google sign-in is not enabled."));
    }
    if (req.query.error) {
      return res.redirect(
        "/login.html?error=" + encodeURIComponent(String(req.query.error_description || req.query.error)),
      );
    }
    const code = req.query.code;
    if (!code) {
      return res.redirect("/login.html?error=" + encodeURIComponent("Missing Google authorization code."));
    }

    const profile = await googleAuth.getGoogleProfileFromCode(String(code));
    if (!users.isDomainAllowed(profile.email, companyDomains())) {
      return res.redirect(
        "/login.html?error=" + encodeURIComponent("Google email domain is not allowed for this company."),
      );
    }

    const user = users.resolveGoogleLogin(profile.email, companyDomains());
    // Keep directory name in sync when Google provides a display name.
    if (profile.name && profile.name !== user.name) {
      try {
        await users.updateUser(user.id, { name: profile.name }, companyDomains());
      } catch {
        // non-fatal
      }
    }
    req.session.user = users.publicUser(users.findUserById(user.id) || user);
    res.redirect("/leave.html");
  } catch (err) {
    res.redirect("/login.html?error=" + encodeURIComponent(err.message || "Google sign-in failed."));
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("leave.sid");
    res.json({ ok: true });
  });
});

// -------- Users API (Admin) --------
app.get("/api/users", requireAuth, requireRole("admin"), (req, res) => {
  res.json(users.listUsers());
});

app.post("/api/users", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const created = await users.createUser(req.body || {}, companyDomains());
    await notify({
      to: created.email,
      subject: "Leave Manager account created",
      body: `An account was created for you with role: ${created.role}. Sign in at /login.html using your company email (password and/or Google, depending on company settings).`,
      meta: { type: "user_created", userId: created.id },
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.put("/api/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const updated = await users.updateUser(req.params.id, req.body || {}, companyDomains());
    await notify({
      to: updated.email,
      subject: "Leave Manager account updated",
      body: `Your account was updated. Role: ${updated.role}. Active: ${updated.active}.`,
      meta: { type: "user_updated", userId: updated.id },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.delete("/api/users/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    if (currentUser(req)?.id === req.params.id) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }
    users.deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// -------- Employees API --------
app.get("/api/employees", requireAuth, async (req, res) => {
  try {
    const all = await loadEmployees();
    const user = currentUser(req);
    if (user.role === "employee") {
      if (!user.employeeId) return res.json([]);
      return res.json(all.filter((e) => e.id === user.employeeId));
    }
    res.json(all);
  } catch (err) {
    console.error("GET /api/employees failed:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/employees/bulk-replace", requireAuth, requireRole("admin", "exco"), async (req, res) => {
  try {
    const payload = req.body;
    const employees = Array.isArray(payload) ? payload : payload?.employees;
    const result = await saveEmployees(employees);
    res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error("POST /api/employees/bulk-replace failed:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/employees/profile-updated-notify", requireAuth, requireRole("exco"), async (req, res) => {
  try {
    const user = currentUser(req);
    const { employeeId, changes, balances } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: "employeeId is required." });

    const allEmployees = await loadEmployees();
    const employee = allEmployees.find((e) => e.id === employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found." });

    await leaveRequests.notifyEmployeeProfileUpdated({
      employee,
      actor: user,
      changes: Array.isArray(changes) ? changes : [],
      balances: balances || null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// -------- Leave requests API --------
app.get("/api/leave-requests", requireAuth, (req, res) => {
  const user = currentUser(req);
  let rows = leaveRequests.listLeaveRequests();
  if (user.role === "employee") {
    rows = rows.filter((r) => r.requestedByUserId === user.id || r.employeeId === user.employeeId);
  }
  res.json(rows);
});

app.post("/api/leave-requests", requireAuth, requireRole("admin", "employee"), async (req, res) => {
  try {
    const user = currentUser(req);
    const { employeeId, type, days, dateISO } = req.body || {};
    if (!employeeId || !type || !days || !dateISO) {
      return res.status(400).json({ error: "employeeId, type, days, and dateISO are required." });
    }
    if (user.role === "employee" && user.employeeId && user.employeeId !== employeeId) {
      return res.status(403).json({ error: "Employees can only request leave for themselves." });
    }

    const allEmployees = await loadEmployees();
    const emp = allEmployees.find((e) => e.id === employeeId);
    if (!emp) return res.status(400).json({ error: "Employee not found." });

    const request = leaveRequests.createLeaveRequest({
      employeeId,
      employeeName: emp.name,
      type,
      days,
      dateISO,
      requestedByUserId: user.id,
      requestedByEmail: user.email,
      requestedByRole: user.role,
    });

    await leaveRequests.notifyLeaveRequested(request);
    ensureLogFile();
    const logRow = [
      new Date().toISOString(),
      "Leave Requested",
      emp.name,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      type,
      days,
      String(dateISO).slice(0, 10),
    ]
      .map(escapeCsv)
      .join(",");
    fs.appendFileSync(LOG_FILE, logRow + "\n", "utf8");

    res.status(201).json(request);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/leave-requests/:id/approve", requireAuth, requireRole("exco"), async (req, res) => {
  try {
    const user = currentUser(req);
    const updated = leaveRequests.setLeaveRequestStatus(req.params.id, {
      status: "approved",
      decidedByUserId: user.id,
      decidedByEmail: user.email,
      decisionNote: req.body?.note || "",
    });
    await applyApprovedLeaveToEmployee(updated);
    await leaveRequests.notifyLeaveDecision(updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/leave-requests/:id/reject", requireAuth, requireRole("exco"), async (req, res) => {
  try {
    const user = currentUser(req);
    const updated = leaveRequests.setLeaveRequestStatus(req.params.id, {
      status: "rejected",
      decidedByUserId: user.id,
      decidedByEmail: user.email,
      decisionNote: req.body?.note || "",
    });
    await leaveRequests.notifyLeaveDecision(updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// -------- Existing log/export --------
app.post("/api/log", requireAuth, (req, res) => {
  try {
    const d = req.body;
    if (!d || !d.action) return res.status(400).json({ error: "Invalid log data" });
    ensureLogFile();
    const row = [
      new Date().toISOString(),
      d.action,
      escapeCsv(d.employeeName),
      escapeCsv(d.startDate),
      escapeCsv(d.annual),
      escapeCsv(d.sick),
      escapeCsv(d.family),
      escapeCsv(d.study),
      escapeCsv(d.religious),
      escapeCsv(d.accrual),
      escapeCsv(d.leaveType),
      escapeCsv(d.days),
      escapeCsv(d.leaveDate),
    ].join(",");
    fs.appendFileSync(LOG_FILE, row + "\n", "utf8");
    res.json({ ok: true });
  } catch (err) {
    console.error("Log error:", err);
    res.status(500).json({ error: String(err.message) });
  }
});

app.post("/api/export", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.employees)) {
      return res.status(400).json({ error: "Invalid export data" });
    }
    const filename = `leave-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const filepath = path.join(__dirname, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
    ensureLogFile();
    const logRow = [new Date().toISOString(), "Backup", `${data.employees.length} employees`, "", "", "", "", "", "", "", "", "", ""]
      .map(escapeCsv)
      .join(",");
    fs.appendFileSync(LOG_FILE, logRow + "\n", "utf8");
    res.json({ ok: true, filename });
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: String(err.message) });
  }
});

initDb()
  .catch((err) => {
    console.error("DB init failed:", err);
  })
  .then(async () => {
    const seeded = await users.ensureSeedAdmin(companyDomains());
    app.listen(PORT, () => {
      console.log("");
      console.log("Leave Manager server running at http://localhost:" + PORT);
      console.log("Open http://localhost:" + PORT + "/login.html to sign in.");
      if (seeded) {
        console.log("Seed admin created:");
        console.log("  email:", seeded.email);
        console.log("  password:", seeded.password);
        console.log("  ", seeded.note);
      }
      const opts = authOptions();
      console.log(
        "Auth: local=" +
          opts.localEnabled +
          " google=" +
          opts.googleEnabled +
          " (credentials=" +
          opts.googleConfigured +
          ") smtp=" +
          opts.smtpConfigured,
      );
      if (DB_ENABLED) console.log("Postgres enabled (DATABASE_URL set).");
      else console.log("File store enabled (data/app-store.json). Set DATABASE_URL for Postgres.");
      console.log("");
    });
  });
