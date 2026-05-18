import fs from "node:fs";

const app = fs.readFileSync("frontend/src/App.jsx", "utf8");
const styles = fs.readFileSync("frontend/src/styles.css", "utf8");

const labels = ["\u603b\u89c8", "\u9519\u9898\u672c", "\u6211\u7684\u6536\u85cf", "\u8584\u5f31\u70b9", "\u5b66\u4e60\u8bb0\u5f55"];
const issues = [];

if (!/const LEARNING_TABS\s*=/.test(app)) {
  issues.push("missing LEARNING_TABS definition");
}

for (const label of labels) {
  if (!app.includes(label)) {
    issues.push(`missing learning tab label: ${label}`);
  }
}

for (const key of ["overview", "wrong", "favorites", "insights", "history"]) {
  if (!app.includes(`view === "${key}"`)) {
    issues.push(`missing learning view conditional: ${key}`);
  }
}

for (const token of [
  "LearningCenterFrame",
  "LearningTabs",
  "LearningEmptyState",
  "learning-tabs",
  "learning-history",
  "learning-focus-card",
  "learning-empty-state",
  "learningNotice",
  "setLearningNotice",
  "handleFavoriteListChanged",
  "\u5df2\u53d6\u6d88\u6536\u85cf",
]) {
  if (!app.includes(token) && !styles.includes(token)) {
    issues.push(`missing learning structure token: ${token}`);
  }
}

if (!styles.includes(".learning-tabs")) {
  issues.push("missing learning tabs styles");
}

if (!styles.includes(".learning-history")) {
  issues.push("missing learning history styles");
}

if (issues.length) {
  throw new Error(`Learning center v0.5 structure issues found:\n${issues.join("\n")}`);
}

console.log(JSON.stringify({ learningTabs: labels.length, structureIssues: 0 }, null, 2));
