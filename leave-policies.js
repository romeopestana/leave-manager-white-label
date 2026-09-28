// Local leave policies for this deployment only.
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

/** Used by checks and by the browser loader. Replaces the fetched policy. */
export function usePolicyConfig(config) {
  policyConfig = config;
  return policyConfig;
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

function parseLocalDate(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

function dateKeyOf(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function calendarDaysBetween(earlier, later) {
  const a = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const b = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((b - a) / 86400000);
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Mon–Fri span for a leave booking. Matches the overlap helper. */
function workingDaySpan(startValue, days) {
  const startRaw = parseLocalDate(startValue);
  const qty = Number(days) || 0;
  if (!startRaw || qty <= 0) return null;
  const start = new Date(startRaw);
  while (isWeekend(start)) start.setDate(start.getDate() + 1);
  let remaining = Math.max(1, Math.ceil(qty - 1e-9)) - 1;
  const end = new Date(start);
  while (remaining > 0) {
    end.setDate(end.getDate() + 1);
    if (!isWeekend(end)) remaining -= 1;
  }
  return { start, end, days: qty };
}

export function getSickLeaveRules(emp) {
  const policy = getPolicyForEmployee(emp);
  if (!policy?.sickLeave) return null;
  return { countryName: policy.name, ...policy.sickLeave };
}

export function getSickOpeningDays(emp) {
  const rules = emp?.model ? emp : getSickLeaveRules(emp);
  if (!rules) return null;
  if (rules.model === "accruing") return round2(Number(rules.daysPerYear) || 0);
  if (rules.model === "per-episode") return round2(Number(rules.paidDaysPerEpisode) || 0);
  return round2(Number(rules.entitlementDays) || 0);
}

function sickAnchor(rules) {
  return parseLocalDate(rules.cycleAnchor || "2026-01-01");
}

function sickEntitlementDays(rules, asOfDate) {
  const anchor = sickAnchor(rules);
  if (!anchor || dateKeyOf(asOfDate) < dateKeyOf(anchor)) return 0;
  if (rules.model === "accruing") {
    const grants = asOfDate.getFullYear() - anchor.getFullYear() + 1;
    return round2((Number(rules.daysPerYear) || 0) * Math.max(0, grants));
  }
  if (rules.model === "per-episode") return round2(Number(rules.paidDaysPerEpisode) || 0);
  return round2(Number(rules.entitlementDays) || 0);
}

function sickDeductionWindow(rules, asOfDate) {
  const anchor = sickAnchor(rules);
  if (!anchor || dateKeyOf(asOfDate) < dateKeyOf(anchor)) return null;
  if (rules.model === "accruing") return { start: anchor, end: asOfDate };
  if (rules.model === "fixed-cycle") {
    const months = Number(rules.cycleMonths) || 0;
    if (months < 1) return null;
    let start = new Date(anchor);
    for (let i = 0; i < 200; i++) {
      const next = addMonths(start, months);
      if (dateKeyOf(asOfDate) < dateKeyOf(next)) {
        const end = new Date(next);
        end.setDate(end.getDate() - 1);
        return { start, end };
      }
      start = next;
    }
    return null;
  }
  const yearStart = new Date(asOfDate.getFullYear(), 0, 1);
  const start = dateKeyOf(yearStart) < dateKeyOf(anchor) ? anchor : yearStart;
  return { start, end: new Date(asOfDate.getFullYear(), 11, 31) };
}

function sickDaysInWindow(transactions, window, asOfDate) {
  if (!window) return 0;
  const startKey = dateKeyOf(window.start);
  const endKey = dateKeyOf(window.end);
  const asOfKey = dateKeyOf(asOfDate);
  let total = 0;
  for (const tx of transactions) {
    if (tx?.type !== "sick") continue;
    const days = Number(tx.days) || 0;
    if (days <= 0 || !tx.dateISO) continue;
    const start = parseLocalDate(tx.dateISO);
    if (!start) continue;
    const key = dateKeyOf(start);
    if (key < startKey || key > endKey || key > asOfKey) continue;
    total += days;
  }
  return round2(total);
}

function sickEpisodes(transactions, anchor, asOfDate) {
  const items = [];
  const anchorKey = dateKeyOf(anchor);
  const asOfKey = dateKeyOf(asOfDate);
  for (const tx of transactions) {
    if (tx?.type !== "sick") continue;
    const span = workingDaySpan(tx.dateISO, tx.days);
    if (!span) continue;
    const key = dateKeyOf(span.start);
    if (key < anchorKey || key > asOfKey) continue;
    items.push(span);
  }
  items.sort((a, b) => dateKeyOf(a.start) - dateKeyOf(b.start));
  return items;
}

function payStatus(rules, taken) {
  const full = Number(rules.fullPayDays) || 0;
  const half = Number(rules.halfPayDays) || 0;
  const unpaid = Number(rules.unpaidDays) || 0;
  if (half <= 0 && unpaid <= 0) return "Remaining days are full pay.";
  const fullLeft = round2(Math.max(0, full - taken));
  const afterFull = Math.max(0, taken - full);
  const halfLeft = round2(Math.max(0, half - afterFull));
  const afterHalf = Math.max(0, afterFull - half);
  const unpaidLeft = round2(Math.max(0, unpaid - afterHalf));
  return `Still available at full pay: ${fullLeft.toFixed(2)}; half pay: ${halfLeft.toFixed(2)}; unpaid: ${unpaidLeft.toFixed(2)}.`;
}

/**
 * Sick balance for an employee from the country rule.
 * Cycles start on 1 January 2026. Earlier sick days are ignored.
 * Returns null when the employee has no country sick rule.
 */
export function getSickBalance(emp, asOfDate = new Date()) {
  const rules = getSickLeaveRules(emp);
  if (!rules) return null;
  const asOf = parseLocalDate(asOfDate) || new Date();
  const openingDays = getSickOpeningDays(rules);
  const anchor = sickAnchor(rules);
  const entitlement = sickEntitlementDays(rules, asOf);
  const txs = Array.isArray(emp.transactions) ? emp.transactions : [];

  if (!anchor || dateKeyOf(asOf) < dateKeyOf(anchor) || entitlement <= 0) {
    return {
      balance: 0,
      openingDays,
      entitlementDays: 0,
      takenDays: 0,
      countryName: rules.countryName,
      note: "Sick leave is counted from 1 January 2026.",
      warnings: [],
    };
  }

  if (rules.model === "per-episode") {
    const gap = Number(rules.episodeGapDays);
    const gapDays = Number.isFinite(gap) ? gap : 3;
    const episodes = [];
    for (const item of sickEpisodes(txs, anchor, asOf)) {
      const last = episodes[episodes.length - 1];
      if (last && calendarDaysBetween(last.end, item.start) <= gapDays) {
        last.days = round2(last.days + item.days);
        if (dateKeyOf(item.end) > dateKeyOf(last.end)) last.end = item.end;
      } else {
        episodes.push({ start: item.start, end: item.end, days: round2(item.days) });
      }
    }
    let open = null;
    for (let i = episodes.length - 1; i >= 0; i--) {
      const episode = episodes[i];
      if (dateKeyOf(episode.start) > dateKeyOf(asOf)) continue;
      if (calendarDaysBetween(episode.end, asOf) <= gapDays) {
        open = episode;
        break;
      }
    }
    const taken = open ? open.days : 0;
    const balance = round2(Math.max(0, entitlement - taken));
    const warnings = [];
    if (taken > entitlement + 0.001) {
      warnings.push({
        level: "critical",
        message: `Sick leave in the current illness (${taken.toFixed(2)} days) exceeds the ${rules.countryName} paid cap of ${entitlement.toFixed(2)} days.`,
      });
    }
    const status = open
      ? `Current illness: ${taken.toFixed(2)} of ${entitlement.toFixed(2)} paid days used.`
      : `No current illness. The next illness starts at ${entitlement.toFixed(2)} paid days.`;
    return {
      balance,
      openingDays,
      entitlementDays: entitlement,
      takenDays: taken,
      countryName: rules.countryName,
      note: `${rules.summary} ${status} ${payStatus(rules, taken)}`,
      warnings,
    };
  }

  const taken = sickDaysInWindow(txs, sickDeductionWindow(rules, asOf), asOf);
  const balance = round2(Math.max(0, entitlement - taken));
  const warnings = [];
  if (taken > entitlement + 0.001) {
    warnings.push({
      level: "critical",
      message: `Sick leave taken (${taken.toFixed(2)} days) exceeds the ${rules.countryName} entitlement of ${entitlement.toFixed(2)} days for this cycle.`,
    });
  }
  return {
    balance,
    openingDays,
    entitlementDays: entitlement,
    takenDays: taken,
    countryName: rules.countryName,
    note: `${rules.summary} Taken in this cycle: ${taken.toFixed(2)} of ${entitlement.toFixed(2)}. ${payStatus(rules, taken)}`,
    warnings,
  };
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
  const sickOpening = getSickOpeningDays({ ...emp, country });
  const compliantSick =
    sickOpening == null ? round2(Number(emp.sickStart) || 0) : sickOpening;

  const changed =
    emp.country !== country ||
    round2(emp.annualAccrualPerMonth || 0) !== compliantAccrual ||
    (sickOpening != null && round2(Number(emp.sickStart) || 0) !== compliantSick);

  if (!changed) {
    return { employee: { ...emp, country }, changed: false };
  }

  return {
    employee: {
      ...emp,
      country,
      annualAccrualPerMonth: compliantAccrual,
      ...(sickOpening != null ? { sickStart: compliantSick } : {}),
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
