import fs from "node:fs";

const app = fs.readFileSync("frontend/src/App.jsx", "utf8");
const styles = fs.readFileSync("frontend/src/styles.css", "utf8");

const requiredLabels = ["\u603b\u89c8", "\u9898\u5e93\u7ba1\u7406", "\u7ec3\u4e60\u914d\u7f6e", "\u7528\u6237\u7ba1\u7406", "\u64cd\u4f5c\u5ba1\u8ba1"];
const issues = [];

if (!/const ADMIN_TABS\s*=/.test(app)) {
  issues.push("missing ADMIN_TABS definition");
}

for (const label of requiredLabels) {
  if (!app.includes(label)) {
    issues.push(`missing admin tab label: ${label}`);
  }
}

if (!/const \[adminTab,\s*setAdminTab\]\s*=\s*useState\("overview"\)/.test(app)) {
  issues.push("admin dashboard should default to overview tab");
}

for (const key of ["overview", "questions", "practiceSets", "users", "audit"]) {
  if (!app.includes(`adminTab === "${key}"`)) {
    issues.push(`missing conditional section for admin tab: ${key}`);
  }
}

if (!/className="admin-tabs"/.test(app)) {
  issues.push("missing admin tab navigation markup");
}

if (!styles.includes(".admin-tabs")) {
  issues.push("missing admin tab styles");
}

if (!styles.includes(".overview-grid")) {
  issues.push("missing admin overview grid styles");
}

for (const token of [
  "ADMIN_QUESTION_FILTERS_STORAGE_KEY",
  "difficulty",
  "status",
  "origin",
  "knowledgePoint",
  "resetQuestionFilters",
  "knowledge_point",
  "normalizeAdminQuestionFormForType",
  "questionOptionLettersForType",
  "updateQuestionType",
  "practiceAvailability",
  "validatePracticeSetForm",
  "availability-strip",
  "selectedAdminUser",
  "confirmAdminUserPatch",
  "用户详情",
  "auditFilters",
  "formatAuditDetail",
  "audit-filters",
  "notice",
  "setNotice",
  "status-message",
]) {
  if (!app.includes(token)) {
    issues.push(`missing admin question filter token: ${token}`);
  }
}

if (issues.length) {
  throw new Error(`Admin v0.4 structure issues found:\n${issues.join("\n")}`);
}

console.log(JSON.stringify({ adminTabs: requiredLabels.length, structureIssues: 0 }, null, 2));
