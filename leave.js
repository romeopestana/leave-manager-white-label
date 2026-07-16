// Leave management.
// If the server is running with Postgres configured, data is stored in Postgres.
// Otherwise it falls back to localStorage in the browser.
// Baseline: all starting balances are effective from 1 Jan 2026.
// Branding is loaded from config/brand.json for white-label customization.

const STORAGE_KEY = "leave-manager-employees-v1";
const BASELINE_YEAR = 2026;
const BRAND_CONFIG_PATH = "/config/brand.json";

const DEFAULT_BRAND = {
  productName: "Leave Manager",
  companyName: "Your Company",
  pageTitle: "Leave Manager",
  logoPath: "",
  websiteUrl: "",
  accentColor: "#0066b3",
  accentHover: "#004d8c",
};

async function loadBrandConfig() {
  try {
    const res = await fetch(BRAND_CONFIG_PATH, { cache: "no-store" });
    if (!res.ok) return { ...DEFAULT_BRAND };
    const data = await res.json();
    return { ...DEFAULT_BRAND, ...(data || {}) };
  } catch {
    return { ...DEFAULT_BRAND };
  }
}

function applyBrand(brand) {
  const title = brand.pageTitle || brand.productName || DEFAULT_BRAND.pageTitle;
  document.title = title;

  if (brand.accentColor) {
    document.documentElement.style.setProperty("--accent", brand.accentColor);
  }
  if (brand.accentHover) {
    document.documentElement.style.setProperty("--accent-hover", brand.accentHover);
  }
  if (brand.accentColor) {
    document.documentElement.style.setProperty(
      "--accent-soft",
      `${brand.accentColor}1a`,
    );
  }

  const brandText = document.getElementById("brand-text");
  const brandLink = document.getElementById("brand-link");
  const brandLogo = document.getElementById("brand-logo");

  const logoPath = (brand.logoPath || "").trim();
  const websiteUrl = (brand.websiteUrl || "").trim();
  const label = brand.productName || DEFAULT_BRAND.productName;

  if (logoPath && brandLink && brandLogo) {
    brandLogo.src = logoPath;
    brandLogo.alt = brand.companyName || label;
    if (websiteUrl) {
      brandLink.href = websiteUrl;
    } else {
      brandLink.removeAttribute("href");
      brandLink.removeAttribute("target");
      brandLink.style.cursor = "default";
    }
    brandLink.style.display = "flex";
    if (brandText) brandText.style.display = "none";
  } else if (brandText) {
    brandText.textContent = label;
    brandText.style.display = "block";
    if (brandLink) brandLink.style.display = "none";
  }
}

async function logToServer(data) {
  try {
    await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    // Server may not be running
  }
}
const BASELINE_MONTH_INDEX = 0; // January (0-based)

async function loadEmployees() {
  // Preferred: Postgres-backed source of truth via server API.
  try {
    const res = await fetch("/api/employees", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.employees)) return data.employees;
    }
  } catch {
    // Server may not be running (or DB not configured). Fall back to localStorage.
  }

  // Fallback: localStorage (previous behavior).
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function saveEmployees(employees) {
  // Preferred: Postgres via server API.
  try {
    const res = await fetch("/api/employees/bulk-replace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employees }),
    });
    if (res.ok) return;
  } catch {
    // Fall back below.
  }

  // Fallback: localStorage.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(employees));
}

async function exportEmployees() {
  const employees = await loadEmployees();
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    employees,
  };
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    const data = await res.json();
    if (data.ok) {
      alert("Backup saved to project folder: " + (data.filename || "leave-manager-backup.json"));
    } else {
      throw new Error(data.error || "Export failed");
    }
  } catch (err) {
    alert("Export failed. Make sure the server is running (node server.js). " + (err.message || ""));
  }
}

async function importEmployees(employees) {
  if (!Array.isArray(employees)) return false;
  for (const emp of employees) {
    if (!emp || typeof emp.name !== "string" || !emp.id) return false;
  }
  await saveEmployees(employees);
  return true;
}

function createEmployee(data) {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  return {
    id,
    name: data.name,
    startDisplay: data.startDisplay, // MM/YY text
    annualStart: data.annualStart,
    sickStart: data.sickStart,
    familyStart: data.familyStart,
    studyStart: data.studyStart,
    religiousStart: data.religiousStart,
    annualAccrualPerMonth: data.annualAccrualPerMonth,
    // Each transaction: { type, days, dateISO }
    transactions: [],
  };
}

function updateEmployee(employees, employeeId, data) {
  const idx = employees.findIndex((e) => e.id === employeeId);
  if (idx === -1) return employees;
  const emp = employees[idx];
  const updated = {
    ...emp,
    id: emp.id,
    transactions: emp.transactions,
    name: data.name,
    startDisplay: data.startDisplay,
    annualStart: data.annualStart,
    sickStart: data.sickStart,
    familyStart: data.familyStart,
    studyStart: data.studyStart,
    religiousStart: data.religiousStart,
    annualAccrualPerMonth: data.annualAccrualPerMonth,
  };
  const next = [...employees];
  next[idx] = updated;
  return next;
}

function deleteEmployee(employees, employeeId) {
  return employees.filter((e) => e.id !== employeeId);
}

function addTransaction(employees, employeeId, tx) {
  const idx = employees.findIndex((e) => e.id === employeeId);
  if (idx === -1) return employees;
  const emp = employees[idx];
  const updated = {
    ...emp,
    transactions: [
      ...emp.transactions,
      {
        type: tx.type,
        days: tx.days,
        dateISO: tx.dateISO,
      },
    ],
  };
  const next = [...employees];
  next[idx] = updated;
  return next;
}

// --- Balance calculation helpers ---

function monthsSinceBaseline(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-based
  return (year - BASELINE_YEAR) * 12 + (month - BASELINE_MONTH_INDEX);
}

function getBalancesForEmployee(emp, asOfDate = new Date()) {
  const txs = Array.isArray(emp.transactions) ? emp.transactions : [];

  // Accrual is added at the start of each month (including the baseline month)
  const monthsElapsed = Math.max(0, monthsSinceBaseline(asOfDate));
  const accrualMonths = monthsElapsed + 1;
  const accrued = emp.annualAccrualPerMonth * accrualMonths;

  let annualTaken = 0;
  let sickTaken = 0;
  let familyTaken = 0;
  let studyTaken = 0;
  let religiousTaken = 0;

  const currentYear = asOfDate.getFullYear();

  for (const tx of txs) {
    const days = Number(tx.days) || 0;
    if (!days) continue;
    const d = tx.dateISO ? new Date(tx.dateISO) : asOfDate;
    const year = d.getFullYear();

    switch (tx.type) {
      case "annual":
        annualTaken += days;
        break;
      case "sick":
        if (year === currentYear) sickTaken += days;
        break;
      case "family":
        if (year === currentYear) familyTaken += days;
        break;
      case "study":
        if (year === currentYear) studyTaken += days;
        break;
      case "religious":
        if (year === currentYear) religiousTaken += days;
        break;
      default:
        break;
    }
  }

  const annual = emp.annualStart + accrued - annualTaken;
  const sick = emp.sickStart - sickTaken;
  const family = emp.familyStart - familyTaken;
  const study = emp.studyStart - studyTaken;
  const religious = emp.religiousStart - religiousTaken;

  const clamp = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

  return {
    annual: clamp(Math.max(0, annual)),
    sick: clamp(Math.max(0, sick)),
    family: clamp(Math.max(0, family)),
    study: clamp(Math.max(0, study)),
    religious: clamp(Math.max(0, religious)),
  };
}

function getLeaveTakenForEmployee(emp, asOfDate = new Date()) {
  const txs = Array.isArray(emp.transactions) ? emp.transactions : [];
  let annualTaken = 0, sickTaken = 0, familyTaken = 0, studyTaken = 0, religiousTaken = 0;
  const currentYear = asOfDate.getFullYear();
  for (const tx of txs) {
    const days = Number(tx.days) || 0;
    if (!days) continue;
    const d = tx.dateISO ? new Date(tx.dateISO) : asOfDate;
    const year = d.getFullYear();
    if (tx.type === "annual") annualTaken += days;
    else if (tx.type === "sick" && year === currentYear) sickTaken += days;
    else if (tx.type === "family" && year === currentYear) familyTaken += days;
    else if (tx.type === "study" && year === currentYear) studyTaken += days;
    else if (tx.type === "religious" && year === currentYear) religiousTaken += days;
  }
  return { annualTaken, sickTaken, familyTaken, studyTaken, religiousTaken };
}

// --- Rendering ---

function sortEmployeesByFirstName(employees) {
  return [...employees].sort((a, b) => {
    const firstA = (a.name || "").trim().split(/\s+/)[0] || "";
    const firstB = (b.name || "").trim().split(/\s+/)[0] || "";
    return firstA.localeCompare(firstB, undefined, { sensitivity: "base" });
  });
}

function renderCurrentDate() {
  const el = document.getElementById("current-date-label");
  if (!el) return;
  const now = new Date();
  const fmt = now.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  el.textContent = fmt;
}

function renderEmployeesTable(employees) {
  const tbody = document.getElementById("employees-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!employees.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "muted";
    td.textContent = "No employees yet. Create one above.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const now = new Date();
  const sorted = sortEmployeesByFirstName(employees);

  for (const emp of sorted) {
    const balances = getBalancesForEmployee(emp, now);
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = emp.name;

    const startTd = document.createElement("td");
    startTd.textContent = emp.startDisplay || "";
    startTd.className = "cell-small muted";

    const annualTd = document.createElement("td");
    annualTd.className = "cell-small";
    annualTd.textContent = balances.annual.toFixed(2);

    const sickTd = document.createElement("td");
    sickTd.className = "cell-small";
    sickTd.textContent = balances.sick.toFixed(2);

    const familyTd = document.createElement("td");
    familyTd.className = "cell-small";
    familyTd.textContent = balances.family.toFixed(2);

    const studyTd = document.createElement("td");
    studyTd.className = "cell-small";
    studyTd.textContent = balances.study.toFixed(2);

    const relTd = document.createElement("td");
    relTd.className = "cell-small";
    relTd.textContent = balances.religious.toFixed(2);

    const accrualTd = document.createElement("td");
    accrualTd.className = "cell-small muted";
    accrualTd.textContent = (emp.annualAccrualPerMonth || 0).toFixed(2);

    tr.appendChild(nameTd);
    tr.appendChild(startTd);
    tr.appendChild(annualTd);
    tr.appendChild(sickTd);
    tr.appendChild(familyTd);
    tr.appendChild(studyTd);
    tr.appendChild(relTd);
    tr.appendChild(accrualTd);

    tbody.appendChild(tr);
  }
}

function renderEmployeeSelect(employees) {
  const sel = document.getElementById("leave-employee");
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select employee";
  sel.appendChild(placeholder);

  const sorted = sortEmployeesByFirstName(employees);
  for (const emp of sorted) {
    const opt = document.createElement("option");
    opt.value = emp.id;
    opt.textContent = emp.name;
    sel.appendChild(opt);
  }

  if (employees.some((e) => e.id === currentValue)) {
    sel.value = currentValue;
  }
}

function renderManageEmployeeSelect(employees) {
  const sel = document.getElementById("manage-employee-select");
  const formEl = document.getElementById("manage-employee-form");
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select employee to manage";
  sel.appendChild(placeholder);

  const sorted = sortEmployeesByFirstName(employees);
  for (const emp of sorted) {
    const opt = document.createElement("option");
    opt.value = emp.id;
    opt.textContent = emp.name;
    sel.appendChild(opt);
  }

  if (employees.some((e) => e.id === currentValue)) {
    sel.value = currentValue;
    const emp = employees.find((e) => e.id === currentValue);
    if (emp) populateManageForm(emp);
  } else {
    if (formEl) formEl.style.display = "none";
  }
}

function renderReportEmployeeSelect(employees) {
  const sel = document.getElementById("report-employee-select");
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select employee";
  sel.appendChild(placeholder);
  const sorted = sortEmployeesByFirstName(employees);
  for (const emp of sorted) {
    const opt = document.createElement("option");
    opt.value = emp.id;
    opt.textContent = emp.name;
    sel.appendChild(opt);
  }
  if (employees.some((e) => e.id === currentValue)) sel.value = currentValue;
}

function leaveTypeLabel(type) {
  if (!type) return "";
  const t = String(type).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatDisplayDate(isoDateStr) {
  if (!isoDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoDateStr)) return isoDateStr || "";
  const [y, m, d] = isoDateStr.split("-");
  return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
  if (str == null) return "";
  const s = String(str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function populateManageForm(emp) {
  const formEl = document.getElementById("manage-employee-form");
  if (!formEl) return;
  const balances = getBalancesForEmployee(emp);
  const fmt = (n) => String(Number(n ?? 0).toFixed(2));
  document.getElementById("manage-emp-name").value = emp.name || "";
  document.getElementById("manage-emp-start").value = emp.startDisplay || "";
  document.getElementById("manage-emp-annual").value = fmt(balances.annual);
  document.getElementById("manage-emp-sick").value = fmt(balances.sick);
  document.getElementById("manage-emp-family").value = fmt(balances.family);
  document.getElementById("manage-emp-study").value = fmt(balances.study);
  document.getElementById("manage-emp-religious").value = fmt(balances.religious);
  document.getElementById("manage-emp-accrual").value = fmt(emp.annualAccrualPerMonth);
  formEl.style.display = "block";
  showError("manage-form-error", "");
}

// --- Validation helpers ---

/** Parse numeric input, accepting both . and , as decimal separator. */
function parseDecimal(str) {
  if (str == null || str === "") return 0;
  const s = String(str).trim().replace(",", ".");
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

/** Replace comma with period in an input's value (ensures . for decimals). */
function normalizeDecimalInput(el) {
  if (!el || el.tagName !== "INPUT") return;
  const v = el.value;
  if (typeof v === "string" && v.includes(",")) {
    el.value = v.replace(/,/g, ".");
  }
}

function setLeaveDateToToday() {
  const el = document.getElementById("leave-date");
  if (!el) return;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  el.value = `${yyyy}-${mm}-${dd}`;
}

function resetLeaveForm() {
  const empSel = document.getElementById("leave-employee");
  const typeSel = document.getElementById("leave-type");
  const daysEl = document.getElementById("leave-days");
  if (empSel) empSel.value = "";
  if (typeSel) typeSel.value = "";
  if (daysEl) daysEl.value = "";
  setLeaveDateToToday();
  showError("leave-form-error", "");
}

function resetManageSection() {
  const selectEl = document.getElementById("manage-employee-select");
  const formEl = document.getElementById("manage-employee-form");
  if (selectEl) selectEl.value = "";
  if (formEl) {
    formEl.reset();
    formEl.style.display = "none";
  }
  showError("manage-form-error", "");
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
  } else {
    el.style.display = "block";
    el.textContent = msg;
  }
}

function parseMMYY(str) {
  const trimmed = (str || "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const yearTwoDigits = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const fullYear = 2000 + yearTwoDigits;
  return { month, year: fullYear };
}

// --- Event wiring ---

function setupEmployeeForm() {
  const form = document.getElementById("employee-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("employee-form-error", "");

    const name = document.getElementById("emp-name").value.trim();
    const startText = document.getElementById("emp-start").value.trim();
    const mmYY = parseMMYY(startText);
    const annualStart = parseDecimal(document.getElementById("emp-annual").value);
    const sickStart = parseDecimal(document.getElementById("emp-sick").value);
    const familyStart = parseDecimal(document.getElementById("emp-family").value);
    const studyStart = parseDecimal(document.getElementById("emp-study").value);
    const religiousStart = parseDecimal(document.getElementById("emp-religious").value);
    const accrual = parseDecimal(document.getElementById("emp-accrual").value);

    if (!name) {
      showError("employee-form-error", "Please enter an employee name.");
      return;
    }
    if (!mmYY) {
      showError(
        "employee-form-error",
        "Start date must be in MM/YY format, e.g. 01/26.",
      );
      return;
    }
    if (annualStart < 0 || sickStart < 0 || familyStart < 0 || studyStart < 0 || religiousStart < 0 || accrual < 0) {
      showError(
        "employee-form-error",
        "All leave values must be zero or positive.",
      );
      return;
    }

    const employees = await loadEmployees();
    const newEmp = createEmployee({
      name,
      startDisplay: startText,
      annualStart,
      sickStart,
      familyStart,
      studyStart,
      religiousStart,
      annualAccrualPerMonth: accrual,
    });

    const updated = [...employees, newEmp];
    await saveEmployees(updated);
    renderEmployeesTable(updated);
    renderEmployeeSelect(updated);
    renderManageEmployeeSelect(updated);
    renderReportEmployeeSelect(updated);
    form.reset();
    resetLeaveForm();
    resetManageSection();
  });

  const resetBtn = document.getElementById("reset-all");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (
        !confirm(
          "This will remove all employees and history stored in this browser. Continue?",
        )
      ) {
        return;
      }
      await saveEmployees([]);
      logToServer({ action: "Clear All", employeeName: "(all employees removed)" });
      renderEmployeesTable([]);
      renderEmployeeSelect([]);
      renderManageEmployeeSelect([]);
      renderReportEmployeeSelect([]);
      resetLeaveForm();
      resetManageSection();
    });
  }
}

function setupLeaveForm() {
  const form = document.getElementById("leave-form");
  if (!form) return;

  // Default leave date to today
  const leaveDateInput = document.getElementById("leave-date");
  if (leaveDateInput) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    leaveDateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("leave-form-error", "");

    const employeeId = document.getElementById("leave-employee").value;
    const type = document.getElementById("leave-type").value;
    const days = parseDecimal(document.getElementById("leave-days").value);
    const dateStr = document.getElementById("leave-date").value;

    if (!employeeId) {
      showError("leave-form-error", "Please select an employee.");
      return;
    }
    if (!type) {
      showError("leave-form-error", "Please select a leave type.");
      return;
    }
    if (!days || days <= 0) {
      showError("leave-form-error", "Please enter a positive number of days.");
      return;
    }

    const dateISO = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

    let employees = await loadEmployees();
    const emp = employees.find((eEmp) => eEmp.id === employeeId);
    if (!emp) {
      showError("leave-form-error", "Selected employee could not be found.");
      return;
    }

    // Prevent overdrawing beyond current balance.
    const balances = getBalancesForEmployee(emp, new Date(dateISO));
    const remaining = balances[type] ?? 0;
    if (days > remaining + 0.0001) {
      showError(
        "leave-form-error",
        `Not enough ${type} leave. Available: ${remaining.toFixed(2)} days, requested: ${days.toFixed(2)} days.`,
      );
      return;
    }

    employees = addTransaction(employees, employeeId, {
      type,
      days,
      dateISO,
    });
    await saveEmployees(employees);
    logToServer({
      action: "Leave Applied",
      employeeName: emp?.name || "",
      leaveType: type,
      days,
      leaveDate: dateStr,
    });
    renderEmployeesTable(employees);
    renderEmployeeSelect(employees);
    renderManageEmployeeSelect(employees);
    renderReportEmployeeSelect(employees);
    resetLeaveForm();
  });
}

function setupManageEmployee() {
  const selectEl = document.getElementById("manage-employee-select");
  const saveBtn = document.getElementById("manage-save-btn");
  const deleteBtn = document.getElementById("manage-delete-btn");
  const cancelBtn = document.getElementById("manage-cancel-btn");
  const formEl = document.getElementById("manage-employee-form");

  if (!selectEl) return;

  selectEl.addEventListener("change", async () => {
    const id = selectEl.value;
    if (!id) {
      if (formEl) formEl.style.display = "none";
      showError("manage-form-error", "");
      return;
    }
    const employees = await loadEmployees();
    const emp = employees.find((e) => e.id === id);
    if (emp) populateManageForm(emp);
  });

  const manageForm = document.getElementById("manage-employee-form");
  if (manageForm) {
    manageForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = selectEl.value;
      if (!id) return;
      showError("manage-form-error", "");

      const name = document.getElementById("manage-emp-name").value.trim();
      const startText = document.getElementById("manage-emp-start").value.trim();
      const mmYY = parseMMYY(startText);
      const userAnnual = parseDecimal(document.getElementById("manage-emp-annual").value);
      const userSick = parseDecimal(document.getElementById("manage-emp-sick").value);
      const userFamily = parseDecimal(document.getElementById("manage-emp-family").value);
      const userStudy = parseDecimal(document.getElementById("manage-emp-study").value);
      const userReligious = parseDecimal(document.getElementById("manage-emp-religious").value);
      const accrual = parseDecimal(document.getElementById("manage-emp-accrual").value);

      if (!name) {
        showError("manage-form-error", "Please enter an employee name.");
        return;
      }
      if (!mmYY) {
        showError("manage-form-error", "Start date must be in MM/YY format, e.g. 01/26.");
        return;
      }
      if (userAnnual < 0 || userSick < 0 || userFamily < 0 || userStudy < 0 || userReligious < 0 || accrual < 0) {
        showError("manage-form-error", "All leave values must be zero or positive.");
        return;
      }

      let employees = await loadEmployees();
      const currentEmp = employees.find((e) => e.id === id);
      if (!currentEmp) return;
      const taken = getLeaveTakenForEmployee(currentEmp);
      const monthsElapsed = Math.max(0, monthsSinceBaseline(new Date()));
      const accrualMonths = monthsElapsed + 1;
      const accrued = (currentEmp.annualAccrualPerMonth || 0) * accrualMonths;

      employees = updateEmployee(employees, id, {
        name,
        startDisplay: startText,
        annualStart: userAnnual + taken.annualTaken - accrued,
        sickStart: userSick + taken.sickTaken,
        familyStart: userFamily + taken.familyTaken,
        studyStart: userStudy + taken.studyTaken,
        religiousStart: userReligious + taken.religiousTaken,
        annualAccrualPerMonth: accrual,
      });
      await saveEmployees(employees);
      logToServer({
        action: "Updated",
        employeeName: name,
        startDate: startText,
        annual: userAnnual,
        sick: userSick,
        family: userFamily,
        study: userStudy,
        religious: userReligious,
        accrual,
      });
      renderEmployeesTable(employees);
      renderEmployeeSelect(employees);
      renderManageEmployeeSelect(employees);
      renderReportEmployeeSelect(employees);
      resetManageSection();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      location.reload();
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const id = selectEl.value;
      if (!id) return;
      const employees = await loadEmployees();
      const emp = employees.find((e) => e.id === id);
      const name = emp ? emp.name : "this employee";
      if (!confirm(`Delete ${name}? This cannot be undone.`)) return;

      const updated = deleteEmployee(employees, id);
      await saveEmployees(updated);
      logToServer({
        action: "Deleted",
        employeeName: emp?.name || "",
        startDate: emp?.startDisplay || "",
        annual: emp?.annualStart,
        sick: emp?.sickStart,
        family: emp?.familyStart,
        study: emp?.studyStart,
        religious: emp?.religiousStart,
        accrual: emp?.annualAccrualPerMonth,
      });
      renderEmployeesTable(updated);
      renderEmployeeSelect(updated);
      renderManageEmployeeSelect(updated);
      renderReportEmployeeSelect(updated);
      resetManageSection();
    });
  }
}

const REPORT_MIN_DATE = "2026-01-01";

function setupReporting() {
  const employeeSelect = document.getElementById("report-employee-select");
  const startInput = document.getElementById("report-start-date");
  const endInput = document.getElementById("report-end-date");
  const generateBtn = document.getElementById("report-generate-btn");
  const errorEl = document.getElementById("report-error");
  const overlay = document.getElementById("report-modal-overlay");
  const titleEl = document.getElementById("report-modal-title");
  const tbody = document.getElementById("report-results-tbody");
  const saveBtn = document.getElementById("report-save-file-btn");
  const closeBtn = document.getElementById("report-modal-close");
  const closeBtn2 = document.getElementById("report-modal-close-btn");

  function showReportError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || "";
    errorEl.style.display = msg ? "block" : "none";
  }

  function openReportModal(employeeName, startStr, endStr, rows) {
    if (!overlay || !titleEl || !tbody) return;
    titleEl.textContent = `Leave report: ${employeeName} (${startStr} – ${endStr})`;
    tbody.innerHTML = "";
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(row.leaveType)}</td><td>${escapeHtml(String(row.days))}</td><td>${escapeHtml(row.firstDay)}</td>`;
      tbody.appendChild(tr);
    }
    overlay.classList.add("open");
    overlay._reportRows = rows;
    overlay._reportMeta = { employeeName, startStr, endStr };
  }

  function closeReportModal() {
    if (overlay) overlay.classList.remove("open");
  }

  if (generateBtn && employeeSelect && startInput && endInput) {
    generateBtn.addEventListener("click", async () => {
      showReportError("");
      const empId = employeeSelect.value?.trim();
      const startRaw = startInput.value?.trim();
      const endRaw = endInput.value?.trim();
      if (!empId) {
        showReportError("Please select an employee.");
        return;
      }
      if (!startRaw) {
        showReportError("Please select a start date.");
        return;
      }
      if (!endRaw) {
        showReportError("Please select an end date.");
        return;
      }
      if (startRaw < REPORT_MIN_DATE) {
        showReportError("Start date cannot be earlier than 1 January 2026.");
        return;
      }
      if (endRaw < startRaw) {
        showReportError("End date must be on or after the start date.");
        return;
      }
      const employees = await loadEmployees();
      const emp = employees.find((e) => e.id === empId);
      if (!emp) {
        showReportError("Selected employee not found.");
        return;
      }
      const transactions = emp.transactions || [];
      const startDate = new Date(startRaw + "T00:00:00");
      const endDate = new Date(endRaw + "T23:59:59");
      const rows = [];
      for (const t of transactions) {
        const d = t.dateISO ? new Date(t.dateISO) : null;
        if (!d || isNaN(d.getTime())) continue;
        if (d < startDate || d > endDate) continue;
        const days = t.days != null ? Number(t.days) : 0;
        const dateStr = t.dateISO ? t.dateISO.slice(0, 10) : "";
        const displayDate = dateStr ? formatDisplayDate(dateStr) : dateStr;
        rows.push({
          leaveType: leaveTypeLabel(t.type),
          days,
          firstDay: displayDate,
          dateISO: dateStr,
        });
      }
      rows.sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
      const startStr = formatDisplayDate(startRaw);
      const endStr = formatDisplayDate(endRaw);
      openReportModal(emp.name, startStr, endStr, rows);
    });
  }

  if (saveBtn && overlay) {
    saveBtn.addEventListener("click", () => {
      const rows = overlay._reportRows;
      const meta = overlay._reportMeta;
      if (!rows || !meta) return;
      const headers = ["Leave type", "Days taken", "First day of leave"];
      const lines = [headers.join(",")];
      for (const row of rows) {
        const cells = [
          `"${String(row.leaveType).replace(/"/g, '""')}"`,
          String(row.days),
          `"${String(row.firstDay).replace(/"/g, '""')}"`,
        ];
        lines.push(cells.join(","));
      }
      const csv = lines.join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const name = `leave-report-${(meta.employeeName || "employee").replace(/\s+/g, "-")}-${meta.startStr.replace(/\//g, "-")}-to-${meta.endStr.replace(/\//g, "-")}.csv`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  if (closeBtn) closeBtn.addEventListener("click", closeReportModal);
  if (closeBtn2) closeBtn2.addEventListener("click", closeReportModal);
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeReportModal();
    });
  }
}

function setupDecimalInputs() {
  const decimalInputIds = [
    "emp-annual", "emp-sick", "emp-family", "emp-study", "emp-religious", "emp-accrual",
    "leave-days",
    "manage-emp-annual", "manage-emp-sick", "manage-emp-family", "manage-emp-study",
    "manage-emp-religious", "manage-emp-accrual",
  ];
  for (const id of decimalInputIds) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => normalizeDecimalInput(el));
      el.addEventListener("blur", () => normalizeDecimalInput(el));
      el.addEventListener("paste", () => setTimeout(() => normalizeDecimalInput(el), 0));
      el.setAttribute("inputmode", "decimal");
      el.setAttribute("lang", "en");
    }
  }
}

// --- Boot ---

document.addEventListener("DOMContentLoaded", async () => {
  const brand = await loadBrandConfig();
  applyBrand(brand);
  renderCurrentDate();
  const employees = await loadEmployees();
  renderEmployeesTable(employees);
  renderEmployeeSelect(employees);
  renderManageEmployeeSelect(employees);
  renderReportEmployeeSelect(employees);
  setupEmployeeForm();
  setupLeaveForm();
  setupManageEmployee();
  setupReporting();
  setupDecimalInputs();
  setupExportImport();
});

function setupExportImport() {
  const exportBtn = document.getElementById("export-data-btn");
  const importBtn = document.getElementById("import-data-btn");
  const fileInput = document.getElementById("import-file-input");

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      exportEmployees();
    });
  }

  if (importBtn && fileInput) {
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result);
          const employees = Array.isArray(data.employees) ? data.employees : Array.isArray(data) ? data : null;
          if (!employees) {
            alert("Invalid backup file. Expected JSON with an 'employees' array.");
            return;
          }
          if (!confirm(`Import ${employees.length} employee(s)? This will replace all current data.`)) {
            return;
          }
          if (await importEmployees(employees)) {
            logToServer({
              action: "Import",
              employeeName: `${employees.length} employees restored`,
            });
            renderEmployeesTable(employees);
            renderEmployeeSelect(employees);
            renderManageEmployeeSelect(employees);
            renderReportEmployeeSelect(employees);
            resetLeaveForm();
            resetManageSection();
            alert("Import complete. " + employees.length + " employee(s) restored.");
          } else {
            alert("Import failed. The file may be corrupted or invalid.");
          }
        } catch (err) {
          alert("Could not read file: " + (err.message || "Invalid JSON"));
        }
        fileInput.value = "";
      };
      reader.readAsText(file);
    });
  }
}

