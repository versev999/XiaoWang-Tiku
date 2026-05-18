const REQUIRED_FIELDS = [
  ["subject", "科目"],
  ["section", "章节"],
  ["difficulty", "难度"],
  ["question", "题干"],
  ["answer", "答案"],
  ["answer_text", "答案内容"],
  ["explanation", "解析"],
  ["source_file", "来源文件"],
  ["source_page", "来源页码"],
  ["source_excerpt", "来源摘录"],
  ["knowledge_point", "知识点"],
];

const TYPE_LABELS = {
  single: "单选题",
  multiple: "多选题",
  judgement: "判断题",
};

const OPTION_KEYS = ["A", "B", "C", "D", "E"];

function text(value) {
  return String(value ?? "").trim();
}

function normalizeAnswer(answer) {
  const letters = text(answer)
    .replace(/[，,\s]/g, "")
    .toUpperCase()
    .split("")
    .filter(Boolean);
  return [...new Set(letters)];
}

function optionValue(form, letter) {
  return text(form[`option_${letter.toLowerCase()}`]);
}

export function questionOptionLettersForType(type) {
  if (type === "judgement") return ["a", "b"];
  if (type === "multiple") return ["a", "b", "c", "d"];
  return ["a", "b", "c", "d", "e"];
}

export function normalizeAdminQuestionFormForType(form, nextType) {
  const answer = normalizeAnswer(form.answer);
  if (nextType === "judgement") {
    const nextAnswer = answer.find((letter) => ["A", "B"].includes(letter)) || "A";
    return {
      ...form,
      type: nextType,
      option_a: optionValue(form, "A") || "正确",
      option_b: optionValue(form, "B") || "错误",
      option_c: "",
      option_d: "",
      option_e: "",
      answer: nextAnswer,
    };
  }

  if (nextType === "multiple") {
    const nextAnswer = answer.filter((letter) => ["A", "B", "C", "D"].includes(letter));
    const fromJudgement = form.type === "judgement";
    return {
      ...form,
      type: nextType,
      option_a: fromJudgement && optionValue(form, "A") === "正确" ? "" : form.option_a,
      option_b: fromJudgement && optionValue(form, "B") === "错误" ? "" : form.option_b,
      option_e: "",
      answer: nextAnswer.length >= 2 ? nextAnswer.sort().join("") : "AB",
    };
  }

  return {
    ...form,
    type: nextType,
    answer: answer[0] || "A",
  };
}

export function buildAdminQuestionPreview(form) {
  const type = text(form.type);
  const answer = normalizeAnswer(form.answer);
  return {
    subject: text(form.subject),
    section: text(form.section),
    type,
    typeLabel: TYPE_LABELS[type] || type,
    difficulty: text(form.difficulty),
    question: text(form.question),
    options: OPTION_KEYS.map((letter) => ({ letter, text: optionValue(form, letter) })).filter((option) => option.text),
    answer: type === "multiple" ? [...answer].sort() : answer,
    answerText: text(form.answer_text),
    explanation: text(form.explanation),
    sourceFile: text(form.source_file),
    sourcePage: text(form.source_page),
    sourceExcerpt: text(form.source_excerpt),
    knowledgePoint: text(form.knowledge_point),
  };
}

export function validateAdminQuestionForm(form) {
  const errors = [];
  const type = text(form.type);

  for (const [field, label] of REQUIRED_FIELDS) {
    if (!text(form[field])) {
      errors.push(`${label}不能为空。`);
    }
  }

  if (!TYPE_LABELS[type]) {
    errors.push("题型必须是单选、多选或判断。");
    return errors;
  }

  const options = Object.fromEntries(OPTION_KEYS.map((letter) => [letter, optionValue(form, letter)]));
  const filledLetters = OPTION_KEYS.filter((letter) => options[letter]);
  const answerLetters = normalizeAnswer(form.answer);

  if (type === "single" && (!options.A || !options.B)) {
    errors.push("单选题至少需要填写 A/B 两个选项。");
  }

  if (type === "multiple") {
    if (!options.A || !options.B || !options.C || !options.D) {
      errors.push("多选题需要填写 A-D 四个选项。");
    }
    if (options.E) {
      errors.push("多选题只保留 A-D 四个选项，请清空 E。");
    }
  }

  if (type === "judgement") {
    if (!options.A || !options.B) {
      errors.push("判断题需要填写 A/B 两个选项。");
    }
    if (options.C || options.D || options.E) {
      errors.push("判断题只使用 A/B 两个选项，请清空 C-E。");
    }
  }

  if (!answerLetters.length) {
    errors.push("答案不能为空。");
  }

  const allowedLetters = type === "multiple" ? ["A", "B", "C", "D"] : type === "judgement" ? ["A", "B"] : filledLetters;
  const invalidAnswer = answerLetters.some((letter) => !allowedLetters.includes(letter));
  const unfilledAnswer = answerLetters.some((letter) => !filledLetters.includes(letter));
  const canDescribeAllowedLetters = type !== "single" || allowedLetters.length > 0;

  if (invalidAnswer && canDescribeAllowedLetters) {
    errors.push(`${TYPE_LABELS[type]}答案只能使用 ${allowedLetters.join("/")}。`);
  }
  if (unfilledAnswer) {
    errors.push("答案必须对应已填写选项。");
  }
  if (type === "single" && answerLetters.length !== 1) {
    errors.push("单选题只能有一个正确答案。");
  }
  if (type === "multiple" && answerLetters.length < 2) {
    errors.push("多选题至少两个正确答案。");
  }
  if (type === "judgement" && answerLetters.length !== 1) {
    errors.push("判断题只能有一个正确答案。");
  }

  return [...new Set(errors)];
}
