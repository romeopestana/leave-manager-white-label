const crypto = require("crypto");
const { readStore, writeStore } = require("./fileStore");
const { notify, loginUrl } = require("./notifications");
const { listUsers } = require("./users");

function listLeaveRequests() {
  return readStore().leaveRequests.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getLeaveRequest(id) {
  return readStore().leaveRequests.find((r) => r.id === id) || null;
}

function createLeaveRequest({
  employeeId,
  employeeName,
  type,
  days,
  dateISO,
  requestedByUserId,
  requestedByEmail,
  requestedByRole,
}) {
  const store = readStore();
  const request = {
    id: crypto.randomUUID(),
    employeeId,
    employeeName: employeeName || "",
    type,
    days: Number(days),
    dateISO,
    status: "pending",
    requestedByUserId,
    requestedByEmail,
    requestedByRole,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedByUserId: null,
    decidedByEmail: null,
    decisionNote: "",
  };
  store.leaveRequests.push(request);
  writeStore(store);
  return request;
}

function setLeaveRequestStatus(id, { status, decidedByUserId, decidedByEmail, decisionNote = "" }) {
  const store = readStore();
  const idx = store.leaveRequests.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error("Leave request not found.");
  const current = store.leaveRequests[idx];
  if (current.status !== "pending") throw new Error("Only pending requests can be updated.");
  if (!["approved", "rejected"].includes(status)) throw new Error("Invalid status.");

  const updated = {
    ...current,
    status,
    decidedAt: new Date().toISOString(),
    decidedByUserId,
    decidedByEmail,
    decisionNote: String(decisionNote || ""),
  };
  store.leaveRequests[idx] = updated;
  writeStore(store);
  return updated;
}

function activeUsersByRole(role) {
  return listUsers().filter((u) => u.role === role && u.active !== false);
}

function employeeEmailFor(employeeId, fallbackEmail = "") {
  const linked = listUsers().find(
    (u) => u.employeeId === employeeId && u.active !== false && u.email,
  );
  if (linked?.email) return linked.email;
  return fallbackEmail || "";
}

function formatLeaveDate(dateISO) {
  return String(dateISO || "").slice(0, 10);
}

async function notifyLeaveRequested(request) {
  const excoUsers = activeUsersByRole("exco");
  const excoEmails = excoUsers.map((u) => u.email).filter(Boolean);
  const employeeEmail = employeeEmailFor(request.employeeId, request.requestedByEmail);
  const link = loginUrl();
  const leaveDate = formatLeaveDate(request.dateISO);

  if (!excoEmails.length) {
    // Still acknowledge the employee if no Exco is configured yet.
    if (employeeEmail) {
      await notify({
        to: employeeEmail,
        subject: `Leave request submitted (${request.type})`,
        body: [
          `Your ${request.type} leave request was submitted.`,
          "",
          `Employee: ${request.employeeName || ""}`,
          `Type: ${request.type}`,
          `Days: ${request.days}`,
          `First day: ${leaveDate}`,
          `Requested by: ${request.requestedByEmail || ""}`,
          "",
          "No Exco users are configured to receive approval emails yet.",
          `Sign in: ${link}`,
        ].join("\n"),
        meta: { type: "leave_requested_no_exco", requestId: request.id },
      });
    }
    return;
  }

  await notify({
    to: excoEmails,
    cc: employeeEmail || undefined,
    subject: `Approval needed: ${request.employeeName || "Employee"} — ${request.type} leave`,
    body: [
      "A leave request needs your approval.",
      "",
      `Employee: ${request.employeeName || ""}`,
      `Type: ${request.type}`,
      `Days: ${request.days}`,
      `First day of leave: ${leaveDate}`,
      `Requested by: ${request.requestedByEmail || ""}`,
      `Role of requester: ${request.requestedByRole || ""}`,
      "",
      "Please sign in to Leave Manager to approve or reject this request:",
      link,
    ].join("\n"),
    meta: { type: "leave_requested_exco", requestId: request.id },
  });
}

async function notifyLeaveDecision(request) {
  const employeeEmail = employeeEmailFor(request.employeeId, request.requestedByEmail);
  const excoEmails = activeUsersByRole("exco").map((u) => u.email).filter(Boolean);
  const link = loginUrl();
  const leaveDate = formatLeaveDate(request.dateISO);
  if (!employeeEmail) return;

  await notify({
    to: employeeEmail,
    cc: excoEmails,
    subject: `Leave request ${request.status}: ${request.type}`,
    body: [
      `Your leave request was ${request.status}.`,
      "",
      `Employee: ${request.employeeName || ""}`,
      `Type: ${request.type}`,
      `Days: ${request.days}`,
      `First day of leave: ${leaveDate}`,
      `Decided by: ${request.decidedByEmail || ""}`,
      request.decisionNote ? `Note: ${request.decisionNote}` : null,
      "",
      "Sign in to Leave Manager to view your leave balances:",
      link,
    ]
      .filter((line) => line != null)
      .join("\n"),
    meta: { type: "leave_decision", requestId: request.id, status: request.status },
  });
}

async function notifyEmployeeProfileUpdated({
  employee,
  actor,
  changes = [],
  balances = null,
}) {
  const employeeEmail = employeeEmailFor(employee?.id);
  if (!employeeEmail) {
    throw new Error("No user email is linked to this employee profile.");
  }
  const link = loginUrl();
  const actorEmail = actor?.email || "";
  const changeLines = Array.isArray(changes) && changes.length
    ? changes.map((c) => `- ${c}`)
    : ["- Employee profile was updated."];

  const balanceLines = balances
    ? [
        "",
        "Current balances:",
        `Annual: ${balances.annual}`,
        `Sick: ${balances.sick}`,
        `Family: ${balances.family}`,
        `Study: ${balances.study}`,
        `Religious: ${balances.religious}`,
        `Accrual / month: ${balances.accrual}`,
        `Max carry-over: ${balances.maxCarry}`,
      ]
    : [];

  await notify({
    to: employeeEmail,
    cc: actorEmail || undefined,
    subject: `Your leave profile was updated (${employee?.name || "employee"})`,
    body: [
      "An Exco member updated your leave profile.",
      "",
      `Employee: ${employee?.name || ""}`,
      `Updated by: ${actor?.name || actorEmail}`,
      "",
      "Changes:",
      ...changeLines,
      ...balanceLines,
      "",
      "Sign in to Leave Manager to review your profile:",
      link,
    ].join("\n"),
    meta: {
      type: "employee_profile_updated",
      employeeId: employee?.id || null,
      actorEmail,
    },
  });
}

module.exports = {
  listLeaveRequests,
  getLeaveRequest,
  createLeaveRequest,
  setLeaveRequestStatus,
  notifyLeaveRequested,
  notifyLeaveDecision,
  notifyEmployeeProfileUpdated,
  employeeEmailFor,
};
