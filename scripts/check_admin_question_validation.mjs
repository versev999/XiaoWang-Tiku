import {
  buildAdminQuestionPreview,
  normalizeAdminQuestionFormForType,
  questionOptionLettersForType,
  validateAdminQuestionForm,
} from "../frontend/src/adminQuestionForm.js";

const validBase = {
  subject: "\u6f14\u51fa\u5e02\u573a\u653f\u7b56\u4e0e\u7ecf\u7eaa\u5b9e\u52a1",
  section: "\u7b2c\u4e00\u7ae0",
  type: "single",
  difficulty: "\u4e2d\u4e0a",
  question: "\u4e0b\u5217\u5173\u4e8e\u6f14\u51fa\u7ecf\u7eaa\u4eba\u5458\u7ba1\u7406\u7684\u8868\u8ff0\uff0c\u54ea\u4e00\u9879\u6b63\u786e\uff1f",
  option_a: "\u8868\u8ff0 A",
  option_b: "\u8868\u8ff0 B",
  option_c: "\u8868\u8ff0 C",
  option_d: "\u8868\u8ff0 D",
  option_e: "",
  answer: "A",
  answer_text: "\u8868\u8ff0 A",
  explanation: "\u89e3\u6790\u5185\u5bb9",
  source_file: "\u7ba1\u7406\u5458\u7ef4\u62a4\u9898",
  source_page: "\u540e\u53f0\u5f55\u5165",
  source_excerpt: "\u6765\u6e90\u6458\u5f55",
  knowledge_point: "\u7ba1\u7406\u8981\u70b9",
};

function assertValid(form, message) {
  const errors = validateAdminQuestionForm(form);
  if (errors.length) {
    throw new Error(`${message}: expected valid form, got ${errors.join("; ")}`);
  }
}

function assertInvalid(form, expected, message) {
  const errors = validateAdminQuestionForm(form);
  if (!errors.some((item) => item.includes(expected))) {
    throw new Error(`${message}: expected error containing "${expected}", got ${JSON.stringify(errors)}`);
  }
}

assertValid(validBase, "single question with A-D options");

assertInvalid({ ...validBase, section: " " }, "\u7ae0\u8282", "required section");
assertInvalid({ ...validBase, answer: "AB" }, "\u5355\u9009\u9898", "single answer count");
assertInvalid({ ...validBase, answer: "E" }, "\u5df2\u586b\u5199\u9009\u9879", "answer must point to filled option");

assertValid(
  {
    ...validBase,
    type: "multiple",
    answer: "AC",
    answer_text: "\u8868\u8ff0 A\u3001C",
  },
  "multiple question with two answers"
);
assertInvalid(
  {
    ...validBase,
    type: "multiple",
    answer: "A",
  },
  "\u81f3\u5c11\u4e24\u4e2a",
  "multiple answer count"
);
assertInvalid(
  {
    ...validBase,
    type: "multiple",
    answer: "AE",
    option_e: "\u8868\u8ff0 E",
  },
  "\u53ea\u4fdd\u7559 A-D",
  "multiple option E should be rejected"
);

assertValid(
  {
    ...validBase,
    type: "judgement",
    option_a: "\u6b63\u786e",
    option_b: "\u9519\u8bef",
    option_c: "",
    option_d: "",
    answer: "B",
    answer_text: "\u9519\u8bef",
  },
  "judgement question with A/B answer"
);
assertInvalid(
  {
    ...validBase,
    type: "judgement",
    option_a: "\u6b63\u786e",
    option_b: "\u9519\u8bef",
    option_c: "\u4e0d\u786e\u5b9a",
    option_d: "",
    answer: "C",
  },
  "\u53ea\u80fd\u4f7f\u7528 A/B",
  "judgement answer and options"
);

const preview = buildAdminQuestionPreview({
  ...validBase,
  type: "multiple",
  answer: "CA",
  option_a: "  \u8868\u8ff0 A  ",
  option_b: "\u8868\u8ff0 B",
  option_c: "\u8868\u8ff0 C",
  option_d: "\u8868\u8ff0 D",
});

if (preview.typeLabel !== "\u591a\u9009\u9898") {
  throw new Error(`expected preview type label, got ${preview.typeLabel}`);
}
if (preview.options.length !== 4 || preview.options[0].text !== "\u8868\u8ff0 A") {
  throw new Error(`expected trimmed A-D preview options, got ${JSON.stringify(preview.options)}`);
}
if (preview.answer.join("") !== "AC") {
  throw new Error(`expected sorted preview answer AC, got ${preview.answer.join("")}`);
}

const judgementForm = normalizeAdminQuestionFormForType(
  {
    ...validBase,
    option_a: "",
    option_b: "",
    option_c: "\u591a\u4f59 C",
    option_d: "\u591a\u4f59 D",
    option_e: "\u591a\u4f59 E",
    answer: "D",
  },
  "judgement"
);
if (
  judgementForm.type !== "judgement" ||
  judgementForm.option_a !== "\u6b63\u786e" ||
  judgementForm.option_b !== "\u9519\u8bef" ||
  judgementForm.option_c ||
  judgementForm.option_d ||
  judgementForm.option_e ||
  judgementForm.answer !== "A"
) {
  throw new Error(`judgement normalization failed: ${JSON.stringify(judgementForm)}`);
}

const multipleForm = normalizeAdminQuestionFormForType({ ...validBase, answer: "AE", option_e: "\u591a\u4f59 E" }, "multiple");
if (multipleForm.type !== "multiple" || multipleForm.option_e || multipleForm.answer !== "AB") {
  throw new Error(`multiple normalization failed: ${JSON.stringify(multipleForm)}`);
}

const judgementToMultiple = normalizeAdminQuestionFormForType(judgementForm, "multiple");
if (judgementToMultiple.option_a || judgementToMultiple.option_b || judgementToMultiple.option_e) {
  throw new Error(`judgement to multiple should clear judgement defaults: ${JSON.stringify(judgementToMultiple)}`);
}

if (questionOptionLettersForType("judgement").join("") !== "ab") {
  throw new Error("judgement visible options should be a/b");
}
if (questionOptionLettersForType("multiple").join("") !== "abcd") {
  throw new Error("multiple visible options should be a-d");
}

console.log(JSON.stringify({ validationCases: 10, previewCases: 1, normalizationCases: 5, issues: 0 }, null, 2));
