const express = require("express");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

app.get("/", (req, res) => res.redirect("/leave.html"));
app.get("/leave", (req, res) => res.redirect("/leave.html"));

// -------- Postgres (employees + transactions) --------
// Configure via environment variable, e.g.:
//   set DATABASE_URL=postgres://user:pass@localhost:5432/leave_manager
const DB_ENABLED = Boolean(process.env.DATABASE_URL);
const pool = DB_ENABLED
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      // Helps with brief restarts during local development.
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
      annual_override DOUBLE PRECISION,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

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

const LOG_FILE = path.join(__dirname, "leave-manager-log.csv");
const LOG_HEADERS = "Date/Time,Action,Employee Name,Start Date,Annual,Sick,Family,Study,Religious,Accrual/Month,Leave Type,Days,Leave Date";

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

app.post("/api/log", (req, res) => {
  try {
    const d = req.body;
    if (!d || !d.action) {
      return res.status(400).json({ error: "Invalid log data" });
    }
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

app.post("/api/export", (req, res) => {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.employees)) {
      return res.status(400).json({ error: "Invalid export data" });
    }
    const filename = `leave-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const filepath = path.join(__dirname, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
    ensureLogFile();
    const logRow = [new Date().toISOString(), "Backup", `${data.employees.length} employees`, "", "", "", "", "", "", "", "", "", ""].map(escapeCsv).join(",");
    fs.appendFileSync(LOG_FILE, logRow + "\n", "utf8");
    res.json({ ok: true, filename });
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: String(err.message) });
  }
});

app.get("/api/employees", async (req, res) => {
  if (!DB_ENABLED) return res.status(503).json({ error: "Postgres not configured (set DATABASE_URL)." });
  try {
    const empRes = await pool.query(`
      SELECT
        id,
        name,
        start_display,
        annual_start,
        sick_start,
        family_start,
        study_start,
        religious_start,
        annual_accrual_per_month,
        annual_override
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
        // Preserve optional field from some backups; the current UI may ignore it.
        ...(row.annual_override != null ? { annualOverride: row.annual_override } : {}),
        transactions: [],
      });
    }

    for (const row of txRes.rows) {
      const emp = empMap.get(row.employee_id);
      if (!emp) continue;
      const dateISO = row.date_iso ? new Date(row.date_iso).toISOString() : null;
      emp.transactions.push({
        type: row.type,
        days: Number(row.days),
        dateISO,
      });
    }

    res.json(Array.from(empMap.values()));
  } catch (err) {
    console.error("GET /api/employees failed:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/employees/bulk-replace", async (req, res) => {
  if (!DB_ENABLED) return res.status(503).json({ error: "Postgres not configured (set DATABASE_URL)." });
  try {
    const payload = req.body;
    const employees = Array.isArray(payload) ? payload : payload?.employees;
    if (!Array.isArray(employees)) {
      return res.status(400).json({ error: "Invalid payload. Expected an employees array." });
    }

    await pool.query("BEGIN");
    await pool.query("DELETE FROM transactions");
    await pool.query("DELETE FROM employees");

    for (const emp of employees) {
      if (!emp || typeof emp !== "object") continue;
      if (!emp.id || !emp.name) {
        throw new Error("Invalid employee object in payload.");
      }

      await pool.query(
        `
          INSERT INTO employees (
            id, name, start_display,
            annual_start, sick_start, family_start, study_start, religious_start,
            annual_accrual_per_month, annual_override
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
          `
            INSERT INTO transactions (employee_id, type, date_iso, days)
            VALUES ($1,$2,$3,$4)
          `,
          [emp.id, tx.type, date, days],
        );
      }
    }

    await pool.query("COMMIT");
    res.json({ ok: true, count: employees.length });
  } catch (err) {
    try {
      await pool.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    console.error("POST /api/employees/bulk-replace failed:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

initDb()
  .catch((err) => {
    // Server should still run for logging/export even if DB isn't configured.
    console.error("DB init failed:", err);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log("");
      console.log("Leave Manager server running at http://localhost:" + PORT);
      console.log("Open http://localhost:3000 in your browser.");
      console.log("Backups saved to project folder. Log: leave-manager-log.csv");
      if (DB_ENABLED) console.log("Postgres enabled (DATABASE_URL set).");
      else console.log("Postgres disabled (set DATABASE_URL to enable).");
      console.log("");
      console.log("Press Ctrl+C to stop the server.");
      console.log("");
    });
  });
