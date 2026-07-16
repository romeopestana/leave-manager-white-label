const crypto = require("crypto");
const { readStore, writeStore } = require("./fileStore");
const { notify } = require("./notifications");
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

async function notifyLeaveRequested(request) {
  const users = listUsers();
  const excoUsers = users.filter((u) => u.role === "exco" && u.active !== false);
  const messages = [];

  if (request.requestedByEmail) {
    messages.push({
      to: request.requestedByEmail,
      subject: `Leave request submitted (${request.type})`,
      body: `Your ${request.type} leave request for ${request.days} day(s) on ${String(request.dateISO).slice(0, 10)} is pending Exco approval.`,
      meta: { type: "leave_requested_self", requestId: request.id },
    });
  }

  for (const exco of excoUsers) {
    messages.push({
      to: exco.email,
      subject: `Approval needed: ${request.employeeName || "Employee"} ${request.type} leave`,
      body: `${request.requestedByEmail} requested ${request.days} day(s) ${request.type} leave for ${request.employeeName} on ${String(request.dateISO).slice(0, 10)}.`,
      meta: { type: "leave_requested_exco", requestId: request.id },
    });
  }

  for (const msg of messages) await notify(msg);
}

async function notifyLeaveDecision(request) {
  if (!request.requestedByEmail) return;
  await notify({
    to: request.requestedByEmail,
    subject: `Leave request ${request.status}: ${request.type}`,
    body: `Your ${request.type} leave request for ${request.days} day(s) on ${String(request.dateISO).slice(0, 10)} was ${request.status}.`,
    meta: { type: "leave_decision", requestId: request.id, status: request.status },
  });
}

module.exports = {
  listLeaveRequests,
  getLeaveRequest,
  createLeaveRequest,
  setLeaveRequestStatus,
  notifyLeaveRequested,
  notifyLeaveDecision,
};
