// Local annual leave policies for this deployment only.
// Edit policy/annual-leave-policy.json and the source document in policy/ for this system alone.

const POLICY_URL = "/policy/annual-leave-policy.json";

let policyConfig = null;

export async function initLeavePolicies() {
  if (policyConfig) return policyConfig;

  const res = await fetch(POLICY_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load leave policy (${res.status})`);
  }

  policyConfig = await res.json();
  return policyConfig;
}

function requirePolicy() {
  if (!policyConfig) {
    throw new Error("Leave policy not loaded. Call initLeavePolicies() first.");
  }
  return policyConfig;
}

export function getPolicyConfig() {
  return policyConfig;
}

export function getPolicyVersion() {
  return policyConfig?.version ?? null;
}

export function getCountries() {
  const config = requirePolicy();
  return config.countries;
}

export function getEmployeeCountryByName() {
  const config = requirePolicy();
  return config.employeeCountryByName || {};
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function inferCountryFromName(name) {
  if (!name) return null;
  const trimmed = name.trim();
  const map = policyConfig?.employeeCountryByName || {};
  return map[trimmed] || null;
}

export function parseStartDate(startDisplay) {
  const trimmed = (startDisplay || "").trim();
  const match = trimmed.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

export function getYearsOfService(emp, asOfDate = new Date()) {
  const start = parseStartDate(emp.startDisplay);
  if (!start) return 0;
  let years = asOfDate.getFullYear() - start.getFullYear();
  const monthDiff = asOfDate.getMonth() - start.getMonth();
  if (monthDiff < 0) years -= 1;
  return Math.max(0, years);
}

function getRulesForCountry(country) {
  const config = requirePolicy();
  return config.countries[country] || null;
}

export function getStatutoryAnnualDaysPerYear(emp, asOfDate = new Date()) {
  const country = emp.country || inferCountryFromName(emp.name);
  const rules = getRulesForCountry(country);
  if (!rules) return null;

  const years = getYearsOfService(emp, asOfDate);

  switch (country) {
    case "CI": {
      const bonus =
        Math.floor(years / rules.tenureBonusEveryYears) * rules.tenureBonusDays;
      return rules.statutoryDaysPerYear + bonus;
    }
    case "ET": {
      const extra =
        years <= 0
          ? 0
          : Math.floor((years - 1) / rules.tenureBonusEveryYears) *
            rules.tenureBonusDays;
      return rules.baseDaysYear1 + extra;
    }
    case "ZA":
      return rules.groupPolicyDaysPerYear;
    case "NG":
      return rules.statutoryDaysPerYear;
    case "AU":
      return rules.statutoryDaysPerYear;
    case "AT":
      return rules.statutoryDaysPerYear;
    default:
      return null;
  }
}

export function getStatutoryAccrualPerMonth(emp, asOfDate = new Date()) {
  const country = emp.country || inferCountryFromName(emp.name);
  const rules = getRulesForCountry(country);
  if (!rules) return 0;

  if (rules.accrualPerMonth != null) {
    if (country === "CI") {
      const annualDays = getStatutoryAnnualDaysPerYear(emp, asOfDate);
      return round2(annualDays / 12);
    }
    return rules.accrualPerMonth;
  }

  if (rules.groupAccrualPerMonth != null) {
    return rules.groupAccrualPerMonth;
  }

  const annualDays = getStatutoryAnnualDaysPerYear(emp, asOfDate);
  if (annualDays == null) return 0;
  return round2(annualDays / 12);
}

export function resolveAnnualAccrualPerMonth(emp, asOfDate = new Date()) {
  const statutory = getStatutoryAccrualPerMonth(emp, asOfDate);
  const configured = Number(emp.annualAccrualPerMonth) || 0;
  return round2(Math.max(statutory, configured));
}

export function getPolicyForEmployee(emp) {
  const country = emp.country || inferCountryFromName(emp.name);
  if (!country) return null;
  const rules = getRulesForCountry(country);
  if (!rules) return null;
  return {
    country,
    ...rules,
    rules,
  };
}

export function getMaxAccumulationDays(emp, asOfDate = new Date()) {
  const country = emp.country || inferCountryFromName(emp.name);
  const rules = getRulesForCountry(country);
  if (!rules) return null;

  if (rules.accumulationCapDays != null) {
    return rules.accumulationCapDays;
  }

  if (rules.maxPostponementYears != null) {
    const annualDays = getStatutoryAnnualDaysPerYear(emp, asOfDate) || 0;
    return round2(annualDays * rules.maxPostponementYears);
  }

  return null;
}

/**
 * Clamp manage/create form leave values to country policy limits.
 * Hard accumulation caps (e.g. ZA 25 days) discard any excess annual/carry request.
 * Accrual below the statutory minimum is raised to that minimum.
 */
export function clampManagedLeaveToPolicy(emp, values = {}, asOfDate = new Date()) {
  const policy = getPolicyForEmployee(emp);
  const adjustments = [];
  let annual =
    values.annual == null ? null : round2(Math.max(0, Number(values.annual) || 0));
  let maxCarry =
    values.maxCarry == null
      ? null
      : round2(Math.max(0, Number(values.maxCarry) || 0));
  let accrual =
    values.accrual == null
      ? null
      : round2(Math.max(0, Number(values.accrual) || 0));

  const statutoryAccrual = getStatutoryAccrualPerMonth(
    { ...emp, country: emp.country || inferCountryFromName(emp.name) },
    asOfDate,
  );
  if (accrual != null && accrual + 0.001 < statutoryAccrual) {
    adjustments.push({
      field: "accrual",
      requested: accrual,
      applied: statutoryAccrual,
      message: `Accrual raised to ${statutoryAccrual.toFixed(2)}/mo (${policy?.name || "policy"} minimum).`,
    });
    accrual = statutoryAccrual;
  }

  if (policy?.capType === "hard") {
    const max = getMaxAccumulationDays(emp, asOfDate);
    if (max != null) {
      if (annual != null && annual > max) {
        adjustments.push({
          field: "annual",
          requested: annual,
          applied: max,
          message: `Annual leave capped at ${max} days per ${policy.name} policy (requested ${annual.toFixed(2)}; excess discarded).`,
        });
        annual = max;
      }
      if (maxCarry != null && maxCarry > max) {
        adjustments.push({
          field: "maxCarry",
          requested: maxCarry,
          applied: max,
          message: `Max carry-over capped at ${max} days per ${policy.name} policy (requested ${maxCarry.toFixed(2)}; excess discarded).`,
        });
        maxCarry = max;
      }
    }
  }

  return { annual, maxCarry, accrual, adjustments, policy };
}

export function applyAnnualBalancePolicy(emp, rawAnnualBalance, asOfDate = new Date()) {
  const policy = getPolicyForEmployee(emp);
  if (!policy) {
    return {
      balance: round2(Math.max(0, rawAnnualBalance)),
      capped: false,
      warnings: [],
    };
  }

  const warnings = [];
  let balance = round2(Math.max(0, rawAnnualBalance));
  let capped = false;
  const rules = policy.rules;
  const maxAccumulation = getMaxAccumulationDays(emp, asOfDate);

  if (rules.capType === "hard" && maxAccumulation != null && balance > maxAccumulation) {
    warnings.push({
      level: "critical",
      message: `Balance exceeds ${maxAccumulation}-day ${policy.name} accumulation cap.`,
    });
    // Hard caps are enforced in the balance engine (forfeit after accrual,
    // before leave). Do not re-clamp here or approved leave would not show
    // while the uncapped running total is still above the cap.
  }

  if (maxAccumulation != null && rules.capType === "postponement" && balance > maxAccumulation) {
    warnings.push({
      level: "critical",
      message: `Balance exceeds ~${maxAccumulation} days (${rules.maxPostponementYears}-year postponement limit in ${policy.name}).`,
    });
  }

  if (rules.excessiveThresholdDays != null && balance >= rules.excessiveThresholdDays) {
    warnings.push({
      level: "warning",
      message: `Excessive leave threshold reached (${rules.excessiveThresholdDays} days) — schedule leave per policy.`,
    });
  }

  const statutoryAccrual = getStatutoryAccrualPerMonth(emp, asOfDate);
  const configured = Number(emp.annualAccrualPerMonth) || 0;
  if (configured > 0 && configured + 0.001 < statutoryAccrual) {
    warnings.push({
      level: "critical",
      message: `Accrual ${configured.toFixed(2)}/mo is below ${policy.name} statutory minimum (${statutoryAccrual.toFixed(2)}/mo).`,
    });
  }

  return { balance, capped, warnings };
}

export function migrateEmployeeToPolicy(emp, asOfDate = new Date()) {
  const country = emp.country || inferCountryFromName(emp.name);
  if (!country) return { employee: emp, changed: false };

  const statutoryAccrual = getStatutoryAccrualPerMonth(
    { ...emp, country },
    asOfDate,
  );
  const compliantAccrual = round2(
    Math.max(statutoryAccrual, Number(emp.annualAccrualPerMonth) || 0),
  );

  const changed =
    emp.country !== country ||
    round2(emp.annualAccrualPerMonth || 0) !== compliantAccrual;

  if (!changed) {
    return { employee: { ...emp, country }, changed: false };
  }

  return {
    employee: {
      ...emp,
      country,
      annualAccrualPerMonth: compliantAccrual,
    },
    changed: true,
  };
}

export function migrateEmployeesToPolicies(employees, asOfDate = new Date()) {
  let changed = false;
  const next = employees.map((emp) => {
    const result = migrateEmployeeToPolicy(emp, asOfDate);
    if (result.changed) changed = true;
    return result.employee;
  });
  return { employees: next, changed };
}

export function getCountryOptions() {
  const config = requirePolicy();
  return Object.values(config.countries).map((c) => ({
    code: c.code,
    label: c.name,
  }));
}

export function getPolicyDocumentLinks() {
  const config = requirePolicy();
  const docName = config.sourceDocument || "annual-leave-policy.json";
  return {
    json: POLICY_URL,
    document: `/policy/${encodeURIComponent(docName)}`,
    version: config.version,
    title: config.title,
    lastUpdated: config.lastUpdated,
  };
}
