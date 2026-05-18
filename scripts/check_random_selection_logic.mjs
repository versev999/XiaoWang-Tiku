import { shouldAdvanceAfterRandomSelection } from "../frontend/src/randomPracticeLogic.js";

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

assertEqual(
  shouldAdvanceAfterRandomSelection({ type: "single", previousSelected: [], nextSelected: ["A"] }),
  true,
  "single choice should advance on first selection",
);

assertEqual(
  shouldAdvanceAfterRandomSelection({ type: "judgement", previousSelected: [], nextSelected: ["B"] }),
  true,
  "judgement should advance on first selection",
);

assertEqual(
  shouldAdvanceAfterRandomSelection({ type: "single", previousSelected: ["A"], nextSelected: ["B"] }),
  false,
  "single choice should not advance when editing an existing answer",
);

assertEqual(
  shouldAdvanceAfterRandomSelection({ type: "judgement", previousSelected: ["A"], nextSelected: ["B"] }),
  false,
  "judgement should not advance when editing an existing answer",
);

assertEqual(
  shouldAdvanceAfterRandomSelection({ type: "multiple", previousSelected: [], nextSelected: ["A"] }),
  false,
  "multiple choice should never auto advance",
);

assertEqual(
  shouldAdvanceAfterRandomSelection({ type: "single", previousSelected: [], nextSelected: [] }),
  false,
  "empty selection should not advance",
);

console.log("random selection navigation checks passed");
