/**
 * Leave overlap helpers.
 * Leave spans are counted in Mon–Fri working days from the first leave day.
 * Fractional days occupy a full working day for clash detection (ceil).
 */

function toDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateKey(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function formatDateDisplay(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function workingDaySpan(startValue, days) {
  const startRaw = toDateOnly(startValue);
  if (!startRaw) return null;
  const qty = Number(days) || 0;
  if (qty <= 0) return null;

  let start = new Date(startRaw);
  while (isWeekend(start)) {
    start.setDate(start.getDate() + 1);
  }

  const workingDaysNeeded = Math.max(1, Math.ceil(qty - 1e-9));
  let remaining = workingDaysNeeded - 1;
  let end = new Date(start);
  while (remaining > 0) {
    end.setDate(end.getDate() + 1);
    if (!isWeekend(end)) remaining -= 1;
  }
  return { start, end };
}

function rangesOverlap(a, b) {
  if (!a || !b) return false;
  return dateKey(a.start) <= dateKey(b.end) && dateKey(b.start) <= dateKey(a.end);
}

function leaveTypeLabel(type) {
  if (!type) return "Leave";
  const t = String(type);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Find clashes for a proposed leave against approved transactions and pending requests.
 */
function findLeaveClashes({
  employeeId,
  dateISO,
  days,
  employeeTransactions = [],
  leaveRequests = [],
  excludeRequestId = null,
}) {
  const proposed = workingDaySpan(dateISO, days);
  if (!proposed) return [];

  const clashes = [];

  for (const tx of employeeTransactions || []) {
    if (!tx || !tx.dateISO) continue;
    const span = workingDaySpan(tx.dateISO, tx.days);
    if (!rangesOverlap(proposed, span)) continue;
    clashes.push({
      source: "approved",
      type: tx.type,
      days: Number(tx.days) || 0,
      dateISO: tx.dateISO,
      start: span.start,
      end: span.end,
      status: "approved",
    });
  }

  for (const req of leaveRequests || []) {
    if (!req || req.employeeId !== employeeId) continue;
    if (req.status !== "pending") continue;
    if (excludeRequestId && req.id === excludeRequestId) continue;
    const span = workingDaySpan(req.dateISO, req.days);
    if (!rangesOverlap(proposed, span)) continue;
    clashes.push({
      source: "pending",
      type: req.type,
      days: Number(req.days) || 0,
      dateISO: req.dateISO,
      start: span.start,
      end: span.end,
      status: "pending approval",
    });
  }

  return clashes;
}

function formatClashMessage(clashes) {
  if (!clashes.length) return "";
  const lines = clashes.map((c) => {
    const start = formatDateDisplay(c.start);
    const end = formatDateDisplay(c.end);
    const range = start === end ? start : `${start} to ${end}`;
    return `- ${leaveTypeLabel(c.type)}: ${c.days} day(s) on ${range} (${c.status})`;
  });
  return [
    "This leave request overlaps with existing leave:",
    ...lines,
    "",
    "Please ask your manager/Exco to edit or cancel the overlapping leave, or try another date.",
  ].join("\n");
}

module.exports = {
  toDateOnly,
  workingDaySpan,
  rangesOverlap,
  findLeaveClashes,
  formatClashMessage,
  formatDateDisplay,
  leaveTypeLabel,
};
