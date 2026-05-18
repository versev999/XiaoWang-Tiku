import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardList,
  ListRestart,
  LogOut,
  Play,
  RotateCcw,
  Search,
  Send,
  Shield,
  SkipForward,
  Shuffle,
  Star,
  UserRound,
} from "lucide-react";
import {
  buildAdminQuestionPreview,
  normalizeAdminQuestionFormForType,
  questionOptionLettersForType,
  validateAdminQuestionForm,
} from "./adminQuestionForm.js";
import { shouldAdvanceAfterRandomSelection } from "./randomPracticeLogic.js";

const AUTH_STORAGE_KEY = "performanceExamAuth";
const RANDOM_DRAFT_PREFIX = "performanceExamRandomDraft";
const ADMIN_QUESTION_FILTERS_STORAGE_KEY = "performanceExamAdminQuestionFilters";

const TYPE_LABELS = {
  single: "单选",
  multiple: "多选",
  judgement: "判断",
};
const TYPE_ORDER = ["single", "multiple", "judgement"];
const ADMIN_TABS = [
  { key: "overview", label: "总览", description: "数据概览" },
  { key: "questions", label: "题库管理", description: "查询编辑" },
  { key: "practiceSets", label: "练习配置", description: "专项练习" },
  { key: "users", label: "用户管理", description: "账号权限" },
  { key: "audit", label: "操作审计", description: "变更记录" },
];
const LEARNING_TABS = [
  { key: "overview", label: "总览", description: "学习状态" },
  { key: "wrong", label: "错题本", description: "集中订正" },
  { key: "favorites", label: "我的收藏", description: "重点复习" },
  { key: "insights", label: "薄弱点", description: "查漏补缺" },
  { key: "history", label: "学习记录", description: "最近作答" },
];
const QUESTION_DIFFICULTIES = ["中上", "较难", "非常难"];
const DEFAULT_ADMIN_QUESTION_FILTERS = {
  type: "",
  subject: "",
  difficulty: "",
  status: "",
  origin: "",
  knowledgePoint: "",
  keyword: "",
  includeInactive: true,
};
const DEFAULT_AUDIT_FILTERS = { action: "", targetType: "", actor: "" };
const AUDIT_ACTIONS = [
  "create_question",
  "update_question",
  "toggle_question_status",
  "create_practice_set",
  "update_practice_set",
  "publish_practice_set",
  "unpublish_practice_set",
  "update_user",
  "reset_password",
];
const AUDIT_TARGET_TYPES = ["question", "practice_set", "user"];

function readStoredAuth() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeAuth(payload) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
}

function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function readStoredAdminQuestionFilters() {
  try {
    const raw = window.localStorage.getItem(ADMIN_QUESTION_FILTERS_STORAGE_KEY);
    return raw ? { ...DEFAULT_ADMIN_QUESTION_FILTERS, ...JSON.parse(raw) } : DEFAULT_ADMIN_QUESTION_FILTERS;
  } catch {
    return DEFAULT_ADMIN_QUESTION_FILTERS;
  }
}

function storeAdminQuestionFilters(filters) {
  window.localStorage.setItem(ADMIN_QUESTION_FILTERS_STORAGE_KEY, JSON.stringify(filters));
}

function formatAuditDetail(detail) {
  if (!detail) return "-";
  if (typeof detail !== "object") return String(detail);
  return Object.entries(detail)
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join("；");
}

async function api(path, options = {}) {
  const { skipAuth = false, headers, ...fetchOptions } = options;
  const auth = readStoredAuth();
  const authHeaders = !skipAuth && auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...authHeaders, ...(headers || {}) },
    ...fetchOptions,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "请求失败");
  }
  return payload;
}

function useStats(refreshKey) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api("/api/stats").then(setStats).catch(() => setStats(null));
  }, [refreshKey]);
  return stats;
}

function isTextInputTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
}

function firstUnsubmittedIndex(questions = [], submittedById = {}, startIndex = 0) {
  if (!questions.length) return 0;
  const normalizedStart = Math.max(0, Math.min(startIndex, questions.length - 1));
  for (let offset = 0; offset < questions.length; offset += 1) {
    const index = (normalizedStart + offset) % questions.length;
    if (!submittedById[questions[index].id]) return index;
  }
  return normalizedStart;
}

function typeGroups(questions = [], submittedById = {}) {
  return TYPE_ORDER.map((type) => {
    const indexes = questions
      .map((question, index) => ({ question, index }))
      .filter((item) => item.question.type === type);
    return {
      type,
      label: TYPE_LABELS[type],
      indexes,
      total: indexes.length,
      submitted: indexes.filter((item) => submittedById[item.question.id]).length,
    };
  }).filter((group) => group.total > 0);
}

function randomDraftKey(sessionId) {
  return sessionId ? `${RANDOM_DRAFT_PREFIX}:${sessionId}` : "";
}

function readRandomDraft(sessionId) {
  const key = randomDraftKey(sessionId);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRandomDraft(sessionId, payload) {
  const key = randomDraftKey(sessionId);
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(payload));
}

function clearRandomDraft(sessionId) {
  const key = randomDraftKey(sessionId);
  if (key) window.localStorage.removeItem(key);
}

function OptionList({ question, selected, setSelected, locked, result }) {
  const isMulti = question?.type === "multiple";
  const selectedSet = new Set(selected);
  const answerSet = new Set(result?.answer || []);

  function toggle(letter) {
    if (locked) return;
    if (isMulti) {
      const next = new Set(selectedSet);
      if (next.has(letter)) next.delete(letter);
      else next.add(letter);
      setSelected([...next].sort());
    } else {
      setSelected([letter]);
    }
  }

  return (
    <div className="options">
      {question.options.map((option) => {
        const checked = selectedSet.has(option.letter);
        const isAnswer = answerSet.has(option.letter);
        const className = [
          "option",
          checked ? "selected" : "",
          result && isAnswer ? "right" : "",
          result && checked && !isAnswer ? "wrong" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={option.letter}
            className={className}
            onClick={() => toggle(option.letter)}
            disabled={locked}
            type="button"
          >
            <span className="option-letter">{option.letter}</span>
            <span>{option.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionView({
  question,
  selected,
  setSelected,
  onSubmit,
  onSubmitNext,
  submitted,
  submitting = false,
  result,
  compactMeta = false,
  submitLabel = "提交本题",
  submittedHint,
  showSubmitActions = true,
}) {
  if (!question) return null;
  return (
    <section className="question-shell">
      <div className="question-meta">
        <span>{question.position ? `第 ${question.position} 题` : question.id}</span>
        <span>{question.type_label || TYPE_LABELS[question.type]}</span>
        <span>{question.difficulty}</span>
        {question.style_tag && <span>{question.style_tag}</span>}
        {!compactMeta && <span>{question.subject}</span>}
      </div>
      <h2>{question.question}</h2>
      <p className="section-line">{question.section}</p>
      <OptionList
        question={question}
        selected={selected}
        setSelected={setSelected}
        locked={submitted || Boolean(result)}
        result={result}
      />
      {!result && showSubmitActions && (
        <>
          <div className="question-actions">
            <button className="primary" type="button" onClick={onSubmit} disabled={!selected.length || submitted || submitting}>
              <Send size={18} />
              {submitting ? "提交中" : submitted ? "本题已提交" : submitLabel}
            </button>
            {onSubmitNext && (
              <button
                className="secondary"
                type="button"
                onClick={onSubmitNext}
                disabled={!selected.length || submitted || submitting}
              >
                <SkipForward size={18} />
                提交并下一题
              </button>
            )}
          </div>
          {submitted && submittedHint && <p className="submitted-hint">{submittedHint}</p>}
        </>
      )}
      {result && <AnswerBlock result={result} />}
    </section>
  );
}

function AnswerBlock({ result }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  return (
    <div className="answer-block">
      <div className={result.correct ? "answer-title correct" : "answer-title incorrect"}>
        {result.correct ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
        {result.correct ? "回答正确" : "回答错误"}
      </div>
      <p>
        <b>你的答案：</b>
        {result.selected?.join("") || "未作答"}
        <b className="spaced">正确答案：</b>
        {result.answer.join("")}
      </p>
      <p>
        <b>答案内容：</b>
        {result.answer_text}
      </p>
      <p>
        <b>解析：</b>
        {result.explanation}
      </p>
      <p className="source">
        来源：{result.source.file}，{result.source.page}
      </p>
      {result.source.excerpt && (
        <>
          <button className="table-action reveal-action" type="button" onClick={() => setSourceOpen((value) => !value)}>
            {sourceOpen ? "收起来源摘录" : "查看来源摘录"}
          </button>
          {sourceOpen && <p className="source-excerpt">{result.source.excerpt}</p>}
        </>
      )}
      <FavoriteButton questionId={result.id} />
    </div>
  );
}

function FavoriteButton({ questionId, initial = false, onChanged }) {
  const [favorited, setFavorited] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!questionId || busy) return;
    setBusy(true);
    try {
      const payload = await api(`/api/me/favorites/${questionId}`, {
        method: favorited ? "DELETE" : "POST",
      });
      setFavorited(payload.favorited);
      onChanged?.(payload.favorited);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className={favorited ? "secondary favorite active" : "secondary favorite"} type="button" onClick={toggle} disabled={busy}>
      <Star size={16} />
      {favorited ? "已收藏" : "收藏本题"}
    </button>
  );
}

function AuthPanel({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", password: "", display_name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = {
        username: form.username,
        password: form.password,
        ...(mode === "register" ? { display_name: form.display_name || form.username } : {}),
      };
      const data = await api(path, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify(payload),
      });
      storeAuth(data);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mode-panel auth-panel">
      <div className="toolbar">
        <div>
          <h2>{mode === "login" ? "账号登录" : "注册账号"}</h2>
          <p>登录后记录个人刷题进度，管理员账号可进入管理平台。</p>
        </div>
        <div className="auth-switch">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label>
          用户名
          <input
            autoComplete="username"
            maxLength={32}
            minLength={3}
            required
            value={form.username}
            onChange={(event) => updateField("username", event.target.value)}
          />
        </label>
        {mode === "register" && (
          <label>
            显示名称
            <input
              maxLength={40}
              value={form.display_name}
              onChange={(event) => updateField("display_name", event.target.value)}
            />
          </label>
        )}
        <label>
          密码
          <input
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            required
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          <UserRound size={18} />
          {busy ? "处理中" : mode === "login" ? "登录" : "注册并登录"}
        </button>
      </form>
    </section>
  );
}

function PracticeMap({ questions = [], currentIndex, submittedById, onJump, filter = "all", collapsed = false, onToggleCollapsed, onFilterChange }) {
  const groups = typeGroups(questions, submittedById);
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      indexes: group.indexes.filter(({ question }) => {
        if (filter === "submitted") return Boolean(submittedById[question.id]);
        if (filter === "unsubmitted") return !submittedById[question.id];
        return true;
      }),
    }))
    .filter((group) => group.indexes.length > 0);
  if (!groups.length) return null;
  return (
    <div className="practice-map">
      <div className="practice-map-toolbar">
        <div className="segmented-control">
          {[
            ["all", "全部"],
            ["unsubmitted", "未作答"],
            ["submitted", "已作答"],
          ].map(([value, label]) => (
            <button
              className={filter === value ? "active" : ""}
              key={value}
              onClick={() => onFilterChange?.(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <button className="table-action" type="button" onClick={onToggleCollapsed}>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          {collapsed ? "展开题号" : "收起题号"}
        </button>
      </div>
      {!collapsed && filteredGroups.map((group) => (
        <div className="practice-map-group" key={group.type}>
          <div className="practice-map-heading">
            <b>{group.label}</b>
            <span>
              {group.submitted} / {group.total}
            </span>
          </div>
          <div className="question-dots">
            {group.indexes.map(({ question, index }) => (
              <button
                aria-label={`跳转到第 ${question.position} 题`}
                className={[
                  "question-dot",
                  index === currentIndex ? "current" : "",
                  submittedById[question.id] ? "done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={question.id}
                onClick={() => onJump(index)}
                type="button"
              >
                {question.position}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!collapsed && !filteredGroups.length && <p className="muted">当前筛选下没有题目</p>}
    </div>
  );
}

function ResultTypeSummary({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="result-summary">
      {items.map((item) => (
        <div key={item.type}>
          <span>{item.type_label}</span>
          <strong>
            {item.correct} / {item.total}
          </strong>
        </div>
      ))}
    </div>
  );
}

function MissingQuestionPanel({ items = [], onJump, onClose, hidden = false }) {
  if (hidden || !items.length) return null;
  return (
    <div className="missing-panel">
      <div className="section-heading">
        <h3>未作答题目</h3>
        <button className="table-action" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="muted">还有 {items.length} 题未作答，点击题号可直接跳转补做。</p>
      <div className="missing-list">
        {items.slice(0, 24).map(({ question, itemIndex }) => (
          <button key={question.id} type="button" onClick={() => onJump(itemIndex)}>
            第 {question.position} 题 · {TYPE_LABELS[question.type]}
          </button>
        ))}
      </div>
      {items.length > 24 && <p className="muted">仅显示前 24 道未作答题，可继续使用“下一未作答”定位。</p>}
    </div>
  );
}

function RandomPractice({ onRefreshStats }) {
  const [session, setSession] = useState(null);
  const [index, setIndex] = useState(0);
  const [selectedById, setSelectedById] = useState({});
  const [submittedById, setSubmittedById] = useState({});
  const [results, setResults] = useState(null);
  const [practiceSets, setPracticeSets] = useState([]);
  const [selectedPracticeSet, setSelectedPracticeSet] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState("");
  const [mapFilter, setMapFilter] = useState("all");
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const [showMissingPanel, setShowMissingPanel] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const current = session?.questions?.[index];
  const selected = selectedById[current?.id] || [];
  const answeredCount = session?.questions?.filter((question) => submittedById[question.id]).length || 0;
  const missingIndexes = useMemo(
    () => (session?.questions || []).map((question, itemIndex) => ({ question, itemIndex })).filter((item) => !submittedById[item.question.id]),
    [session, submittedById],
  );

  useEffect(() => {
    api("/api/practice-sets")
      .then((payload) => setPracticeSets(payload.items || []))
      .catch(() => setPracticeSets([]));
  }, []);

  useEffect(() => {
    loadActive({ silent: true });
  }, []);

  useEffect(() => {
    if (!session?.session_id || results) return;
    writeRandomDraft(session.session_id, { index, selectedById });
  }, [session?.session_id, index, selectedById, results]);

  useEffect(() => {
    function onKeyDown(event) {
      if (!current || results || isTextInputTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((value) => Math.min((session?.total || 1) - 1, value + 1));
        return;
      }
      if (event.key === "Enter" && current.type === "multiple") {
        event.preventDefault();
        setIndex((value) => Math.min((session?.total || 1) - 1, value + 1));
        return;
      }
      const letter = event.key.toUpperCase();
      if (current.options.some((option) => option.letter === letter)) {
        event.preventDefault();
        if (current.type === "multiple") {
          const next = new Set(selected);
          if (next.has(letter)) next.delete(letter);
          else next.add(letter);
          updateRandomSelection(current, [...next].sort());
        } else {
          updateRandomSelection(current, [letter], {
            autoNext: shouldAdvanceAfterRandomSelection({
              type: current.type,
              previousSelected: selected,
              nextSelected: [letter],
            }),
          });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, results, selected, session]);

  function advanceAfterSingleChoice() {
    if (!session?.questions?.length) return;
    setIndex((value) => Math.min(session.total - 1, value + 1));
  }

  async function updateRandomSelection(question, nextSelected, { autoNext = false } = {}) {
    if (!question || !session) return;
    const normalized = question.type === "multiple" ? [...nextSelected].sort() : nextSelected.slice(0, 1);
    setError("");
    setNotice("");
    setSelectedById((prev) => ({ ...prev, [question.id]: normalized }));
    setSubmittedById((prev) => {
      const next = { ...prev };
      if (normalized.length) next[question.id] = true;
      else delete next[question.id];
      return next;
    });
    if (autoNext) advanceAfterSingleChoice();
    try {
      await api(`/api/random/${session.session_id}/answer`, {
        method: "POST",
        body: JSON.stringify({ question_id: question.id, selected: normalized }),
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function start() {
    if (session && answeredCount > 0 && !results) {
      const confirmed = window.confirm("当前随机练习尚未交卷，重新抽题会放弃这次已保存的作答记录。确认重新抽题？");
      if (!confirmed) return;
    }
    setError("");
    setNotice("");
    setShowMissingPanel(false);
    setResults(null);
    setBusyAction("start");
    try {
      const params = new URLSearchParams({ single: "2", multiple: "1", judgement: "1" });
      if (selectedDifficulty) params.set("difficulty", selectedDifficulty);
      const payload = selectedPracticeSet
        ? await api(`/api/practice-sets/${selectedPracticeSet}/start`, { method: "POST" })
        : await api(`/api/random/start?${params.toString()}`, { method: "POST" });
      setSession(payload);
      setIndex(0);
      setSelectedById({});
      setSubmittedById({});
      setMapFilter("all");
      clearRandomDraft(payload.session_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction("");
    }
  }

  async function loadActive({ silent = false } = {}) {
    setError("");
    setNotice("");
    setResults(null);
    setBusyAction("active");
    try {
      const payload = await api("/api/random/active");
      if (!payload.active) {
        if (!silent) setError("暂无未完成的随机练习");
        return;
      }
      const draft = readRandomDraft(payload.session_id);
      const nextSelected = {
        ...(draft?.selectedById || {}),
        ...(payload.selected_answers || {}),
      };
      setSession(payload);
      setSelectedById(nextSelected);
      setSubmittedById(payload.answered || Object.fromEntries(Object.keys(nextSelected).map((id) => [id, true])));
      const draftIndex = Number.isInteger(draft?.index) ? draft.index : null;
      const nextIndex = draftIndex !== null
        ? Math.max(0, Math.min(draftIndex, payload.questions.length - 1))
        : payload.next_unanswered_position
          ? Math.max(0, payload.next_unanswered_position - 1)
          : firstUnsubmittedIndex(payload.questions, payload.answered || {});
      setIndex(nextIndex);
      if (!silent) setNotice(`已恢复上次练习，定位到第 ${nextIndex + 1} 题。`);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      setBusyAction("");
    }
  }

  async function finish() {
    if (!session) return;
    setError("");
    setNotice("");
    if (missingIndexes.length) {
      const confirmed = window.confirm(`还有 ${missingIndexes.length} 题未作答，交卷后这些题会按错误处理。确认交卷？`);
      if (!confirmed) {
        setIndex(missingIndexes[0].itemIndex);
        setShowMissingPanel(true);
        setMapFilter("unsubmitted");
        setNotice(`还有 ${missingIndexes.length} 题未作答，已列出未作答清单。`);
        return;
      }
    }
    setBusyAction("finish");
    try {
      const payload = await api(`/api/random/${session.session_id}/finish`, { method: "POST" });
      setResults(payload);
      clearRandomDraft(session.session_id);
      onRefreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction("");
    }
  }

  function jumpToFirstMissing() {
    if (missingIndexes.length) {
      setIndex(missingIndexes[0].itemIndex);
      setShowMissingPanel(false);
    }
  }

  if (results) {
    return (
      <section className="mode-panel">
        <div className="toolbar">
          <div>
            <h2>随机刷题结果</h2>
            <p>
              得分 {results.score} / {results.total}
            </p>
          </div>
          <div className="toolbar-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setResults(null);
                setSession(null);
                setSelectedById({});
                setSubmittedById({});
              }}
            >
              <ArrowLeft size={18} />
              返回随机刷题
            </button>
            <button className="secondary" type="button" onClick={start}>
              <Shuffle size={18} />
              重新抽题
            </button>
          </div>
        </div>
        <ResultTypeSummary items={results.summary_by_type} />
        <div className="result-list">
          {results.results.map((item) => (
            <article key={item.id} className="result-item">
              <QuestionView
                question={item}
                selected={item.selected}
                setSelected={() => {}}
                submitted
                result={item}
                compactMeta
              />
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mode-panel">
      <div className="toolbar">
        <div>
          <h2>随机刷题</h2>
          <p>可使用默认练习并筛选难度，也可选择管理员发布的专项练习；按题型分段作答，选择后自动保存，交卷后统一显示分数、答案和解析。</p>
        </div>
        <div className="start-controls">
          <select value={selectedPracticeSet} onChange={(event) => setSelectedPracticeSet(event.target.value)}>
            <option value="">默认示例练习：2/1/1</option>
            {practiceSets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            disabled={Boolean(selectedPracticeSet)}
            value={selectedDifficulty}
            onChange={(event) => setSelectedDifficulty(event.target.value)}
          >
            <option value="">全部难度</option>
            <option value="中上">中上</option>
            <option value="较难">较难</option>
            <option value="非常难">非常难</option>
          </select>
          <button className="primary" type="button" onClick={start} disabled={busyAction === "start"}>
            <Shuffle size={18} />
            {busyAction === "start" ? "抽题中" : session ? "重新抽题" : "开始随机刷题"}
          </button>
          {!session && (
            <button className="secondary" type="button" onClick={() => loadActive()} disabled={busyAction === "active"}>
              <Play size={18} />
              {busyAction === "active" ? "恢复中" : "恢复未完成"}
            </button>
          )}
        </div>
      </div>

      {session && (
        <>
          <div className="progress-row">
            <span>
              已作答 {answeredCount} / {session.total}
            </span>
            <progress value={answeredCount} max={session.total} />
            <div className="progress-actions">
              <button className="secondary" type="button" onClick={jumpToFirstMissing} disabled={!missingIndexes.length}>
                <ClipboardList size={18} />
                下一未作答
              </button>
              <button className="finish" type="button" onClick={finish} disabled={busyAction === "finish"}>
                {busyAction === "finish" ? "交卷中" : "交卷"}
              </button>
            </div>
          </div>
          <PracticeMap
            questions={session.questions}
            currentIndex={index}
            submittedById={submittedById}
            onJump={setIndex}
            filter={mapFilter}
            collapsed={mapCollapsed}
            onFilterChange={setMapFilter}
            onToggleCollapsed={() => setMapCollapsed((value) => !value)}
          />
          <MissingQuestionPanel
            items={missingIndexes}
            onClose={() => setShowMissingPanel(false)}
            onJump={(itemIndex) => {
              setIndex(itemIndex);
              setShowMissingPanel(false);
            }}
            hidden={!showMissingPanel}
          />
          <QuestionView
            question={current}
            selected={selected}
            setSelected={(next) => updateRandomSelection(current, next, {
              autoNext: shouldAdvanceAfterRandomSelection({
                type: current?.type,
                previousSelected: selected,
                nextSelected: next,
              }),
            })}
            submitted={false}
            showSubmitActions={false}
          />
          <div className="pager sticky-pager">
            <button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              <ArrowLeft size={16} />
              上一题
            </button>
            <span>
              {index + 1} / {session.total}
            </span>
            <button
              type="button"
              onClick={() => setIndex(Math.min(session.total - 1, index + 1))}
              disabled={index === session.total - 1}
            >
              下一题
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      {notice && <p className="notice">{notice}</p>}
    </section>
  );
}

function SequentialPractice({ onRefreshStats }) {
  const [progress, setProgress] = useState(null);
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState([]);
  const [result, setResult] = useState(null);
  const [jumpValue, setJumpValue] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function applySequentialQuestion(payload) {
    setQuestion(payload.done ? null : payload);
    setSelected(payload.selected || []);
    setResult(payload.answer ? payload : null);
  }

  async function loadProgress() {
    const progressPayload = await api("/api/sequential/progress");
    setProgress(progressPayload);
    return progressPayload;
  }

  async function loadPosition(position) {
    setError("");
    setNotice("");
    setSelected([]);
    setResult(null);
    const [progressPayload, questionPayload] = await Promise.all([
      api("/api/sequential/progress"),
      api(`/api/sequential/question/${position}`),
    ]);
    setProgress(progressPayload);
    applySequentialQuestion(questionPayload);
  }

  async function loadNext() {
    setError("");
    setNotice("");
    setSelected([]);
    setResult(null);
    const progressPayload = await loadProgress();
    if (!progressPayload.next_position) {
      setQuestion(null);
      return;
    }
    const questionPayload = await api(`/api/sequential/question/${progressPayload.next_position}`);
    applySequentialQuestion(questionPayload);
  }

  useEffect(() => {
    loadNext().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (!question || isTextInputTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goSequential(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goSequential(1);
        return;
      }
      if (event.key === "Enter" && selected.length && !result) {
        event.preventDefault();
        submit();
        return;
      }
      const letter = event.key.toUpperCase();
      if (!result && question.options.some((option) => option.letter === letter)) {
        event.preventDefault();
        if (question.type === "multiple") {
          const next = new Set(selected);
          if (next.has(letter)) next.delete(letter);
          else next.add(letter);
          setSelected([...next].sort());
        } else {
          setSelected([letter]);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [question, selected, result, progress]);

  async function submit() {
    if (!question) return;
    setError("");
    setNotice("");
    setBusyAction("submit");
    try {
      const payload = await api(`/api/sequential/${question.id}/answer`, {
        method: "POST",
        body: JSON.stringify({ selected }),
      });
      setResult(payload);
      setQuestion(payload);
      setSelected(payload.selected || selected);
      await loadProgress();
      onRefreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction("");
    }
  }

  async function reset() {
    if (!window.confirm("确认重置顺序刷题记录？")) return;
    setError("");
    setNotice("");
    setBusyAction("reset");
    try {
      await api("/api/sequential/reset", { method: "POST" });
      onRefreshStats();
      await loadNext();
      setNotice("顺序刷题记录已重置。");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction("");
    }
  }

  async function goSequential(delta) {
    if (!question) return;
    const nextPosition = question.position + delta;
    if (nextPosition < 1 || (progress && nextPosition > progress.total)) return;
    try {
      await loadPosition(nextPosition);
    } catch (err) {
      setError(err.message);
    }
  }

  async function jumpToPosition(event) {
    event.preventDefault();
    if (!progress) return;
    const target = Number.parseInt(jumpValue, 10);
    if (!Number.isInteger(target) || target < 1 || target > progress.total) {
      setError(`请输入 1-${progress.total} 之间的题号`);
      return;
    }
    try {
      await loadPosition(target);
    } catch (err) {
      setError(err.message);
    }
  }

  async function continueUnpracticed() {
    try {
      await loadNext();
      setNotice("已跳到下一道未刷题。");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="mode-panel">
      <div className="toolbar">
        <div>
          <h2>顺序刷题</h2>
          <p>按题库顺序推进，提交后立即显示答案和解析；可用上一题、下一题回看，重新进入会跳到未刷题。</p>
        </div>
        <button className="secondary danger" type="button" onClick={reset} disabled={busyAction === "reset"}>
          <RotateCcw size={18} />
          {busyAction === "reset" ? "重置中" : "重置记录"}
        </button>
      </div>

      {progress && (
        <div className="progress-row">
          <span>
            已刷 {progress.practiced} / {progress.total}
          </span>
          <progress value={progress.practiced} max={progress.total} />
          <div className="progress-actions">
            <form className="jump-form" onSubmit={jumpToPosition}>
              <input
                aria-label="跳转题号"
                inputMode="numeric"
                min="1"
                max={progress.total}
                placeholder="题号"
                type="number"
                value={jumpValue}
                onChange={(event) => setJumpValue(event.target.value)}
              />
              <button type="submit">跳转</button>
            </form>
            <button className="secondary" type="button" onClick={continueUnpracticed} disabled={!progress.next_position}>
              <Play size={18} />
              继续未刷
            </button>
          </div>
        </div>
      )}

      {question ? (
        <>
          <QuestionView
            question={question}
            selected={selected}
            setSelected={setSelected}
            onSubmit={submit}
            result={result}
            submitting={busyAction === "submit"}
          />
          {result && (
            <div className="question-actions after-answer">
              <button
                className="primary"
                type="button"
                onClick={() => goSequential(1)}
                disabled={Boolean(progress && question.position === progress.total)}
              >
                <ArrowRight size={18} />
                下一题
              </button>
              <button className="secondary" type="button" onClick={continueUnpracticed} disabled={!progress?.next_position}>
                <Play size={18} />
                继续未刷
              </button>
            </div>
          )}
          <div className="pager sticky-pager">
            <button type="button" onClick={() => goSequential(-1)} disabled={question.position === 1}>
              <ArrowLeft size={16} />
              上一题
            </button>
            <span>
              {question.position} / {progress?.total || 0}
            </span>
            <button
              type="button"
              onClick={() => goSequential(1)}
              disabled={Boolean(progress && question.position === progress.total)}
            >
              下一题
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <CheckCircle2 size={28} />
          顺序刷题已完成，可重置记录后重新开始。
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}
    </section>
  );
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function CompactResult({ item, showAnswer = false, onFavoriteChanged, revealable = false, onMastered }) {
  const [expanded, setExpanded] = useState(showAnswer);
  const [masteryBusy, setMasteryBusy] = useState(false);
  const canReveal = Boolean(item.answer?.length || item.explanation);
  async function markMastered() {
    if (!onMastered || masteryBusy) return;
    setMasteryBusy(true);
    try {
      await onMastered(item);
    } finally {
      setMasteryBusy(false);
    }
  }
  return (
    <article className="compact-question">
      <div className="question-meta">
        <span>第 {item.position} 题</span>
        <span>{item.type_label || TYPE_LABELS[item.type]}</span>
        <span>{item.difficulty}</span>
      </div>
      <p>{item.question}</p>
      {revealable && canReveal && (
        <button className="table-action reveal-action" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起解析" : "查看解析"}
        </button>
      )}
      {expanded && item.answer && (
        <p className="compact-answer">
          {item.selected ? `你的答案：${item.selected?.join("") || "-"} / ` : ""}
          正确答案：{item.answer?.join("") || "-"}
        </p>
      )}
      {expanded && item.answer_text && <p className="compact-answer">答案内容：{item.answer_text}</p>}
      {expanded && item.explanation && <p className="compact-explain">{item.explanation}</p>}
      {expanded && item.source && (
        <p className="source">
          来源：{item.source.file}，{item.source.page}
        </p>
      )}
      <div className="compact-actions">
        <FavoriteButton questionId={item.id} initial={Boolean(item.favorited)} onChanged={onFavoriteChanged} />
        {onMastered && (
          <button className="secondary mastered-action" type="button" onClick={markMastered} disabled={masteryBusy}>
            <CheckCircle2 size={16} />
            {masteryBusy ? "处理中" : "已掌握"}
          </button>
        )}
      </div>
    </article>
  );
}

const EMPTY_QUESTION_FORM = {
  subject: "演出市场政策与经纪实务",
  section: "",
  type: "single",
  difficulty: "中上",
  question: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  option_e: "",
  answer: "A",
  answer_text: "",
  explanation: "",
  source_file: "管理员维护题",
  source_page: "后台录入",
  source_excerpt: "",
  knowledge_point: "",
};

const EMPTY_PRACTICE_SET_FORM = {
  name: "",
  description: "",
  single_count: 2,
  multiple_count: 1,
  judgement_count: 1,
  subject: "",
  difficulty: "",
  is_published: true,
};

function questionToForm(question) {
  const optionMap = Object.fromEntries((question.options || []).map((option) => [option.letter, option.text]));
  return {
    subject: question.subject || "",
    section: question.section || "",
    type: question.type || "single",
    difficulty: question.difficulty || "中上",
    question: question.question || "",
    option_a: optionMap.A || "",
    option_b: optionMap.B || "",
    option_c: optionMap.C || "",
    option_d: optionMap.D || "",
    option_e: optionMap.E || "",
    answer: (question.answer || []).join(""),
    answer_text: question.answer_text || "",
    explanation: question.explanation || "",
    source_file: question.source?.file || "管理员维护题",
    source_page: question.source?.page || "后台录入",
    source_excerpt: question.source?.excerpt || "",
    knowledge_point: question.knowledge_point || "",
  };
}

const EMPTY_LEARNING_FILTERS = {
  type: "",
  subject: "",
  difficulty: "",
  keyword: "",
};

function buildLearningQuery(page, filters) {
  const params = new URLSearchParams({ page: String(page), page_size: "10" });
  if (filters.type) params.set("type", filters.type);
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  return params.toString();
}

function LearningFilters({ filters, onChange, onReset, subjects }) {
  return (
    <div className="learning-filters">
      <select value={filters.type} onChange={(event) => onChange("type", event.target.value)}>
        <option value="">全部题型</option>
        <option value="single">单选</option>
        <option value="multiple">多选</option>
        <option value="judgement">判断</option>
      </select>
      <select value={filters.subject} onChange={(event) => onChange("subject", event.target.value)}>
        <option value="">全部科目</option>
        {subjects.map((subject) => (
          <option key={subject} value={subject}>
            {subject}
          </option>
        ))}
      </select>
      <select value={filters.difficulty} onChange={(event) => onChange("difficulty", event.target.value)}>
        <option value="">全部难度</option>
        <option value="中上">中上</option>
        <option value="较难">较难</option>
        <option value="非常难">非常难</option>
      </select>
      <label className="search-box">
        <Search size={16} />
        <input
          placeholder="搜索题干、章节、知识点"
          value={filters.keyword}
          onChange={(event) => onChange("keyword", event.target.value)}
        />
      </label>
      <button className="table-action" type="button" onClick={onReset}>
        重置筛选
      </button>
    </div>
  );
}

function LearningEmptyState({ title, description }) {
  return (
    <div className="learning-empty-state">
      <CheckCircle2 size={22} />
      <div>
        <b>{title}</b>
        <p>{description}</p>
      </div>
    </div>
  );
}

function LearningDetailView({
  title,
  description,
  payload,
  filters,
  onFilterChange,
  onResetFilters,
  subjects,
  page,
  setPage,
  onBack,
  onReload,
  onFavoriteChanged = onReload,
  showAnswer,
  revealable,
  onMastered,
  emptyTitle = "暂无题目",
  emptyDescription = "当前筛选条件下没有可复习的题目。",
}) {
  const totalPages = payload ? Math.max(1, Math.ceil(payload.total / payload.page_size)) : 1;
  return (
    <>
      <div className="subpage-heading">
        <div>
          <button className="table-action" type="button" onClick={onBack}>
            返回概览
          </button>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button className="secondary" type="button" onClick={onReload}>
          <BarChart3 size={18} />
          刷新
        </button>
      </div>
      <LearningFilters filters={filters} onChange={onFilterChange} onReset={onResetFilters} subjects={subjects} />
      <div className="section-heading">
        <h3>题目列表</h3>
        <span>{payload?.total ?? "--"} 题</span>
      </div>
      <div className="compact-list">
        {(payload?.items || []).map((item) => (
          <CompactResult
            key={`${item.id}-${item.answered_at || item.created_at || item.position}`}
            item={item}
            showAnswer={showAnswer}
            revealable={revealable}
            onFavoriteChanged={onFavoriteChanged}
            onMastered={onMastered}
          />
        ))}
        {payload && !payload.items.length && <LearningEmptyState title={emptyTitle} description={emptyDescription} />}
      </div>
      <div className="pager">
        <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
          上一页
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
          下一页
        </button>
      </div>
    </>
  );
}

function LearningTabs({ view, onChange, dashboard, analytics }) {
  const counts = {
    wrong: dashboard?.wrong_count,
    favorites: dashboard?.favorite_count,
    insights: analytics ? analytics.weak_points.length + analytics.weak_sections.length : undefined,
    history: dashboard?.recent?.length,
  };
  return (
    <div className="learning-tabs" aria-label="学习中心二级导航">
      {LEARNING_TABS.map((item) => (
        <button
          key={item.key}
          className={view === item.key ? "active" : ""}
          type="button"
          onClick={() => onChange(item.key)}
        >
          <span>{item.label}</span>
          <small>{counts[item.key] !== undefined ? `${counts[item.key]} 项` : item.description}</small>
        </button>
      ))}
    </div>
  );
}

function LearningCenterFrame({ view, setView, dashboard, analytics, onReload, onReset, resetting, children, error, notice }) {
  return (
    <section className="mode-panel learning-panel">
      <div className="toolbar">
        <div>
          <h2>学习中心</h2>
          <p>围绕总览、错题本、收藏题、薄弱点和学习记录分区复习，减少长页面中的来回查找。</p>
        </div>
        <div className="toolbar-actions">
          <button className="secondary" type="button" onClick={onReload}>
            <BarChart3 size={18} />
            刷新统计
          </button>
          <button className="secondary danger" type="button" onClick={onReset} disabled={resetting}>
            <RotateCcw size={18} />
            {resetting ? "重置中" : "重置学习数据"}
          </button>
        </div>
      </div>
      <LearningTabs view={view} onChange={setView} dashboard={dashboard} analytics={analytics} />
      {children}
      {error && <p className="error">{error}</p>}
      {notice && <p className="status-message">{notice}</p>}
    </section>
  );
}

function LearningInsightsView({ analytics }) {
  return (
    <div className="learning-grid">
      <div className="learning-block">
        <div className="section-heading">
          <h3>薄弱章节</h3>
          <span>{analytics?.weak_sections.length ?? 0} 项</span>
        </div>
        <div className="compact-list">
          {(analytics?.weak_sections || []).map((item) => (
            <div className="insight-row" key={`${item.subject}-${item.section}`}>
              <b>{item.section}</b>
              <span>{item.subject}</span>
              <span>
                正确率 {formatPercent(item.accuracy)}，{item.correct}/{item.answered}
              </span>
            </div>
          ))}
          {analytics && !analytics.weak_sections.length && <p className="muted">暂无足够答题记录</p>}
        </div>
      </div>
      <div className="learning-block">
        <div className="section-heading">
          <h3>复习建议</h3>
          <span>{analytics?.recommendations.length ?? 0} 条</span>
        </div>
        <div className="compact-list">
          {(analytics?.recommendations || []).map((item) => (
            <div className="insight-row" key={item.source}>
              <b>{item.title}</b>
              <span>{item.reason}</span>
              <span>建议题量 {item.count}</span>
            </div>
          ))}
          {analytics && !analytics.recommendations.length && <p className="muted">先完成几道题后生成推荐</p>}
        </div>
      </div>
      <div className="learning-block wide">
        <div className="section-heading">
          <h3>薄弱知识点</h3>
          <span>{analytics?.weak_points.length ?? 0} 项</span>
        </div>
        <div className="compact-list insight-grid">
          {(analytics?.weak_points || []).map((item) => (
            <div className="insight-row" key={item.knowledge_point}>
              <b>{item.knowledge_point}</b>
              <span>{item.section}</span>
              <span>
                正确率 {formatPercent(item.accuracy)}，{item.correct}/{item.answered}
              </span>
            </div>
          ))}
          {analytics && !analytics.weak_points.length && <p className="muted">暂无薄弱知识点</p>}
        </div>
      </div>
    </div>
  );
}

function LearningHistoryView({ dashboard }) {
  const recent = dashboard?.recent || [];
  return (
    <div className="learning-history">
      <div className="section-heading">
        <h3>学习记录</h3>
        <span>{recent.length} 条</span>
      </div>
      <div className="compact-list">
        {recent.map((item) => (
          <div className="history-row" key={`${item.question_id}-${item.answered_at}`}>
            <b>{item.correct ? "正确" : "错误"}</b>
            <span>{item.question}</span>
            <small>
              {TYPE_LABELS[item.type] || item.type} / {item.subject} / {item.mode}
            </small>
          </div>
        ))}
        {dashboard && !recent.length && <p className="muted">暂无学习记录</p>}
      </div>
    </div>
  );
}

function LearningCenter() {
  const [view, setView] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [learningStats, setLearningStats] = useState(null);
  const [wrong, setWrong] = useState(null);
  const [favorites, setFavorites] = useState(null);
  const [wrongPage, setWrongPage] = useState(1);
  const [favoritePage, setFavoritePage] = useState(1);
  const [wrongFilters, setWrongFilters] = useState(EMPTY_LEARNING_FILTERS);
  const [favoriteFilters, setFavoriteFilters] = useState(EMPTY_LEARNING_FILTERS);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [learningNotice, setLearningNotice] = useState("");

  async function loadLearningData() {
    setError("");
    try {
      const [dashboardPayload, analyticsPayload, statsPayload] = await Promise.all([
        api("/api/me/dashboard"),
        api("/api/me/analytics"),
        api("/api/stats"),
      ]);
      setDashboard(dashboardPayload);
      setAnalytics(analyticsPayload);
      setLearningStats(statsPayload);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadWrong(page = wrongPage, filters = wrongFilters) {
    setError("");
    try {
      const payload = await api(`/api/me/wrong-questions?${buildLearningQuery(page, filters)}`);
      setWrong(payload);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadFavorites(page = favoritePage, filters = favoriteFilters) {
    setError("");
    try {
      const payload = await api(`/api/me/favorites?${buildLearningQuery(page, filters)}`);
      setFavorites(payload);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadLearningData();
  }, []);

  useEffect(() => {
    if (view === "wrong") {
      loadWrong(wrongPage, wrongFilters);
    }
  }, [view, wrongPage, wrongFilters]);

  useEffect(() => {
    if (view === "favorites") {
      loadFavorites(favoritePage, favoriteFilters);
    }
  }, [view, favoritePage, favoriteFilters]);

  const subjects = useMemo(() => Object.keys(learningStats?.subject_counts || {}), [learningStats]);
  const isOverview = view === "overview";

  function updateWrongFilter(field, value) {
    setWrongFilters((prev) => ({ ...prev, [field]: value }));
    setWrongPage(1);
    setLearningNotice("");
  }

  function updateFavoriteFilter(field, value) {
    setFavoriteFilters((prev) => ({ ...prev, [field]: value }));
    setFavoritePage(1);
    setLearningNotice("");
  }

  async function resetLearningData() {
    if (!window.confirm("确认重置学习中心数据？这会清空当前账号的答题记录、错题统计、收藏、顺序进度和未完成随机练习。")) {
      return;
    }
    setError("");
    setResetting(true);
    try {
      await api("/api/me/learning/reset", { method: "POST" });
      setView("overview");
      setWrong(null);
      setFavorites(null);
      setWrongPage(1);
      setFavoritePage(1);
      setWrongFilters(EMPTY_LEARNING_FILTERS);
      setFavoriteFilters(EMPTY_LEARNING_FILTERS);
      await loadLearningData();
      setLearningNotice("学习中心数据已重置。");
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function markWrongMastered(item) {
    setError("");
    try {
      await api(`/api/me/wrong-questions/${item.id}/mastery`, {
        method: "POST",
        body: JSON.stringify({ mastered: true }),
      });
      await Promise.all([loadWrong(wrongPage, wrongFilters), loadLearningData()]);
      setLearningNotice("已标记为掌握，并从当前错题本移出。");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleFavoriteListChanged(favorited) {
    setLearningNotice(favorited ? "已加入收藏。" : "已取消收藏。");
    await Promise.all([loadFavorites(favoritePage, favoriteFilters), loadWrong(wrongPage, wrongFilters), loadLearningData()]);
  }

  if (view === "wrong") {
    return (
      <LearningCenterFrame
        view={view}
        setView={setView}
        dashboard={dashboard}
        analytics={analytics}
        onReload={loadLearningData}
        onReset={resetLearningData}
        resetting={resetting}
        error={error}
        notice={learningNotice}
      >
        <LearningDetailView
          title="错题本"
          description="按题型、科目、难度和关键词筛选错题，优先处理最近答错且仍未掌握的内容。"
          payload={wrong}
          filters={wrongFilters}
          onFilterChange={updateWrongFilter}
          onResetFilters={() => {
            setWrongFilters(EMPTY_LEARNING_FILTERS);
            setWrongPage(1);
          }}
          subjects={subjects}
          page={wrongPage}
          setPage={setWrongPage}
          onBack={() => setView("overview")}
          onReload={() => loadWrong(wrongPage, wrongFilters)}
          onFavoriteChanged={handleFavoriteListChanged}
          showAnswer
          revealable={false}
          onMastered={markWrongMastered}
          emptyTitle="当前没有错题"
          emptyDescription="继续刷题后，最近答错且未掌握的题会出现在这里。"
        />
      </LearningCenterFrame>
    );
  }

  if (view === "favorites") {
    return (
      <LearningCenterFrame
        view={view}
        setView={setView}
        dashboard={dashboard}
        analytics={analytics}
        onReload={loadLearningData}
        onReset={resetLearningData}
        resetting={resetting}
        error={error}
        notice={learningNotice}
      >
        <LearningDetailView
          title="我的收藏"
          description="集中管理主动标记的重点题，可按题型、科目、难度和关键词筛选。"
          payload={favorites}
          filters={favoriteFilters}
          onFilterChange={updateFavoriteFilter}
          onResetFilters={() => {
            setFavoriteFilters(EMPTY_LEARNING_FILTERS);
            setFavoritePage(1);
          }}
          subjects={subjects}
          page={favoritePage}
          setPage={setFavoritePage}
          onBack={() => setView("overview")}
          onReload={() => loadFavorites(favoritePage, favoriteFilters)}
          onFavoriteChanged={handleFavoriteListChanged}
          showAnswer={false}
          revealable
          emptyTitle="当前没有收藏题"
          emptyDescription="在刷题或复盘时点击收藏，本页会集中展示这些重点题。"
        />
      </LearningCenterFrame>
    );
  }

  if (view === "insights") {
    return (
      <LearningCenterFrame
        view={view}
        setView={setView}
        dashboard={dashboard}
        analytics={analytics}
        onReload={loadLearningData}
        onReset={resetLearningData}
        resetting={resetting}
        error={error}
        notice={learningNotice}
      >
        <LearningInsightsView analytics={analytics} />
      </LearningCenterFrame>
    );
  }

  if (view === "history") {
    return (
      <LearningCenterFrame
        view={view}
        setView={setView}
        dashboard={dashboard}
        analytics={analytics}
        onReload={loadLearningData}
        onReset={resetLearningData}
        resetting={resetting}
        error={error}
        notice={learningNotice}
      >
        <LearningHistoryView dashboard={dashboard} />
      </LearningCenterFrame>
    );
  }

  if (!isOverview) return null;

  return (
    <LearningCenterFrame
      view={view}
      setView={setView}
      dashboard={dashboard}
      analytics={analytics}
      onReload={loadLearningData}
      onReset={resetLearningData}
      resetting={resetting}
      error={error}
      notice={learningNotice}
    >

      {dashboard && (
        <>
          <div className="metric-grid">
            <div>
              <span>累计答题</span>
              <strong>{dashboard.answered}</strong>
            </div>
            <div>
              <span>正确率</span>
              <strong>{formatPercent(dashboard.accuracy)}</strong>
            </div>
            <div>
              <span>错题数</span>
              <strong>{dashboard.wrong_count}</strong>
            </div>
            <div>
              <span>收藏数</span>
              <strong>{dashboard.favorite_count}</strong>
            </div>
          </div>

          <div className="learning-focus-card">
            <span>今日建议</span>
            <strong>
              {dashboard.wrong_count
                ? `先处理 ${dashboard.wrong_count} 道错题`
                : analytics?.recommendations[0]?.title || "先完成一组练习"}
            </strong>
            <p>
              {dashboard.wrong_count
                ? "错题仍是最直接的提分入口，建议先进入错题本复盘并标记已掌握。"
                : analytics?.recommendations[0]?.reason || "完成几道题后，学习中心会生成更具体的薄弱点建议。"}
            </p>
          </div>

          <div className="learning-grid">
            <div className="learning-block">
              <h3>题型正确率</h3>
              {(dashboard.by_type.length ? dashboard.by_type : []).map((item) => (
                <div className="rate-row" key={item.type}>
                  <span>{item.type_label}</span>
                  <progress value={item.correct} max={Math.max(1, item.answered)} />
                  <b>{formatPercent(item.accuracy)}</b>
                </div>
              ))}
              {!dashboard.by_type.length && <p className="muted">暂无答题记录</p>}
            </div>
            <div className="learning-block">
              <h3>科目正确率</h3>
              {(dashboard.by_subject.length ? dashboard.by_subject : []).map((item) => (
                <div className="rate-row" key={item.subject}>
                  <span>{item.subject}</span>
                  <progress value={item.correct} max={Math.max(1, item.answered)} />
                  <b>{formatPercent(item.accuracy)}</b>
                </div>
              ))}
              {!dashboard.by_subject.length && <p className="muted">暂无答题记录</p>}
            </div>
          </div>
        </>
      )}

      <div className="learning-entry-grid">
        <button className="learning-entry-card" type="button" onClick={() => setView("wrong")}>
          <span>错题本</span>
          <strong>{dashboard?.wrong_count ?? "--"} 题</strong>
          <p>进入后按题型、科目、难度、关键词筛选，并查看答案解析。</p>
        </button>
        <button className="learning-entry-card" type="button" onClick={() => setView("favorites")}>
          <span>我的收藏</span>
          <strong>{dashboard?.favorite_count ?? "--"} 题</strong>
          <p>集中复习重点题，支持多条件筛选和取消收藏。</p>
        </button>
        <button className="learning-entry-card" type="button" onClick={() => setView("insights")}>
          <span>薄弱点</span>
          <strong>{analytics ? analytics.weak_points.length + analytics.weak_sections.length : "--"} 项</strong>
          <p>查看薄弱章节、薄弱知识点和复习建议。</p>
        </button>
        <button className="learning-entry-card" type="button" onClick={() => setView("history")}>
          <span>学习记录</span>
          <strong>{dashboard?.recent?.length ?? "--"} 条</strong>
          <p>回看最近作答，快速确认近期正确和错误分布。</p>
        </button>
      </div>

    </LearningCenterFrame>
  );
}

function AdminDashboard() {
  const [adminTab, setAdminTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedAdminUser, setSelectedAdminUser] = useState(null);
  const [practiceSets, setPracticeSets] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFilters, setAuditFilters] = useState(DEFAULT_AUDIT_FILTERS);
  const [questions, setQuestions] = useState(null);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [filters, setFilters] = useState(() => readStoredAdminQuestionFilters());
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingPracticeSetId, setEditingPracticeSetId] = useState(null);
  const [questionForm, setQuestionForm] = useState(EMPTY_QUESTION_FORM);
  const [questionFormErrors, setQuestionFormErrors] = useState([]);
  const [questionPreviewOpen, setQuestionPreviewOpen] = useState(false);
  const [practiceSetForm, setPracticeSetForm] = useState(EMPTY_PRACTICE_SET_FORM);
  const [practiceAvailability, setPracticeAvailability] = useState(null);
  const [practiceSetErrors, setPracticeSetErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [questionsRefresh, setQuestionsRefresh] = useState(0);
  const [baseRefresh, setBaseRefresh] = useState(0);
  const [error, setError] = useState("");
  const [adminNotice, setAdminNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function loadBase() {
      setError("");
      try {
        const [summaryPayload, usersPayload, practiceSetsPayload, auditPayload] = await Promise.all([
          api("/api/admin/summary"),
          api("/api/admin/users"),
          api("/api/admin/practice-sets"),
          api("/api/admin/audit-logs"),
        ]);
        if (!active) return;
        setSummary(summaryPayload);
        setUsers(usersPayload.items);
        setSelectedAdminUser((current) => (current ? usersPayload.items.find((item) => item.id === current.id) || null : null));
        setPracticeSets(practiceSetsPayload.items || []);
        setAuditLogs(auditPayload.items || []);
      } catch (err) {
        if (active) setError(err.message);
      }
    }
    loadBase();
    return () => {
      active = false;
    };
  }, [baseRefresh]);

  useEffect(() => {
    let active = true;
    async function loadQuestions() {
      setError("");
      const params = new URLSearchParams({ page: String(page), page_size: "20" });
      if (filters.type) params.set("type", filters.type);
      if (filters.subject) params.set("subject", filters.subject);
      if (filters.difficulty) params.set("difficulty", filters.difficulty);
      if (filters.status) params.set("status", filters.status);
      if (filters.origin) params.set("origin", filters.origin);
      if (filters.knowledgePoint.trim()) params.set("knowledge_point", filters.knowledgePoint.trim());
      if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
      if (filters.includeInactive || filters.status === "inactive") params.set("include_inactive", "true");
      try {
        const payload = await api(`/api/admin/questions?${params.toString()}`);
        if (active) setQuestions(payload);
      } catch (err) {
        if (active) setError(err.message);
      }
    }
    loadQuestions();
    return () => {
      active = false;
    };
  }, [filters, page, questionsRefresh]);

  useEffect(() => {
    if (adminTab !== "practiceSets") return undefined;
    let active = true;
    async function loadPracticeAvailability() {
      const params = new URLSearchParams();
      if (practiceSetForm.subject.trim()) params.set("subject", practiceSetForm.subject.trim());
      if (practiceSetForm.difficulty.trim()) params.set("difficulty", practiceSetForm.difficulty.trim());
      try {
        const payload = await api(`/api/admin/practice-sets/availability?${params.toString()}`);
        if (active) setPracticeAvailability(payload.counts);
      } catch (err) {
        if (active) setError(err.message);
      }
    }
    loadPracticeAvailability();
    return () => {
      active = false;
    };
  }, [adminTab, practiceSetForm.subject, practiceSetForm.difficulty, baseRefresh]);

  useEffect(() => {
    if (adminTab !== "audit") return undefined;
    let active = true;
    async function loadAuditLogs() {
      const params = new URLSearchParams();
      if (auditFilters.action) params.set("action", auditFilters.action);
      if (auditFilters.targetType) params.set("target_type", auditFilters.targetType);
      if (auditFilters.actor.trim()) params.set("actor", auditFilters.actor.trim());
      try {
        const payload = await api(`/api/admin/audit-logs?${params.toString()}`);
        if (active) setAuditLogs(payload.items || []);
      } catch (err) {
        if (active) setError(err.message);
      }
    }
    loadAuditLogs();
    return () => {
      active = false;
    };
  }, [adminTab, auditFilters, baseRefresh]);

  const subjects = useMemo(() => Object.keys(summary?.subject_counts || {}), [summary]);
  const totalPages = questions ? Math.max(1, Math.ceil(questions.total / questions.page_size)) : 1;
  const questionPreview = useMemo(() => buildAdminQuestionPreview(questionForm), [questionForm]);
  const questionOptionLetters = questionOptionLettersForType(questionForm.type);

  function updateFilter(field, value) {
    setFilters((prev) => {
      const next = { ...prev, [field]: value };
      storeAdminQuestionFilters(next);
      return next;
    });
    setPage(1);
    setSelectedQuestion(null);
  }

  function resetQuestionFilters() {
    setFilters(DEFAULT_ADMIN_QUESTION_FILTERS);
    storeAdminQuestionFilters(DEFAULT_ADMIN_QUESTION_FILTERS);
    setPage(1);
    setSelectedQuestion(null);
  }

  function updateAuditFilter(field, value) {
    setAuditFilters((prev) => ({ ...prev, [field]: value }));
  }

  function resetAuditFilters() {
    setAuditFilters(DEFAULT_AUDIT_FILTERS);
  }

  async function openQuestionDetail(questionId) {
    setError("");
    try {
      const payload = await api(`/api/admin/questions/${questionId}`);
      setSelectedQuestion(payload);
    } catch (err) {
      setError(err.message);
    }
  }

  function startCreateQuestion() {
    setEditingId(null);
    setQuestionForm(EMPTY_QUESTION_FORM);
    setQuestionFormErrors([]);
    setQuestionPreviewOpen(false);
    setFormOpen(true);
    setSelectedQuestion(null);
  }

  async function startEditQuestion(questionId) {
    setError("");
    try {
      const payload = await api(`/api/admin/questions/${questionId}`);
      setEditingId(questionId);
      setQuestionForm(questionToForm(payload));
      setQuestionFormErrors([]);
      setQuestionPreviewOpen(false);
      setFormOpen(true);
      setSelectedQuestion(payload);
    } catch (err) {
      setError(err.message);
    }
  }

  function updateQuestionForm(field, value) {
    setQuestionForm((prev) => ({ ...prev, [field]: value }));
    setQuestionFormErrors([]);
    setQuestionPreviewOpen(false);
  }

  function updateQuestionType(value) {
    setQuestionForm((prev) => normalizeAdminQuestionFormForType(prev, value));
    setQuestionFormErrors([]);
    setQuestionPreviewOpen(false);
  }

  async function submitQuestionForm(event) {
    event.preventDefault();
    setError("");
    const validationErrors = validateAdminQuestionForm(questionForm);
    if (validationErrors.length) {
      setQuestionFormErrors(validationErrors);
      setQuestionPreviewOpen(false);
      return;
    }
    setQuestionPreviewOpen(true);
  }

  async function confirmQuestionSave() {
    setError("");
    const validationErrors = validateAdminQuestionForm(questionForm);
    if (validationErrors.length) {
      setQuestionFormErrors(validationErrors);
      setQuestionPreviewOpen(false);
      return;
    }
    setSaving(true);
    try {
      const payload = await api(editingId ? `/api/admin/questions/${editingId}` : "/api/admin/questions", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(questionForm),
      });
      setSelectedQuestion(payload);
      setFormOpen(false);
      setQuestionFormErrors([]);
      setQuestionPreviewOpen(false);
      setAdminNotice(editingId ? "题目已保存。" : "题目已新增。");
      setQuestionsRefresh((key) => key + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleQuestionStatus(item) {
    setError("");
    try {
      await api(`/api/admin/questions/${item.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      if (selectedQuestion?.id === item.id) {
        setSelectedQuestion(null);
      }
      setAdminNotice(item.is_active ? "题目已停用。" : "题目已启用。");
      setQuestionsRefresh((key) => key + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportQuestionBank() {
    setError("");
    try {
      const payload = await api("/api/admin/questions-export?include_inactive=true");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "question-bank-export.json";
      setAdminNotice("题库导出已开始。");
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  function updatePracticeSetForm(field, value) {
    setPracticeSetForm((prev) => ({ ...prev, [field]: value }));
    setPracticeSetErrors([]);
  }

  function validatePracticeSetForm() {
    if (!practiceAvailability) return [];
    const requested = {
      single: Number(practiceSetForm.single_count),
      multiple: Number(practiceSetForm.multiple_count),
      judgement: Number(practiceSetForm.judgement_count),
    };
    const labels = { single: "单选", multiple: "多选", judgement: "判断" };
    return TYPE_ORDER.flatMap((type) =>
      requested[type] > practiceAvailability[type]
        ? [`${labels[type]}配置 ${requested[type]} 题，当前筛选条件下仅有 ${practiceAvailability[type]} 题。`]
        : []
    );
  }

  async function reloadPracticeSets() {
    const payload = await api("/api/admin/practice-sets");
    setPracticeSets(payload.items || []);
  }

  function startEditPracticeSet(item) {
    setEditingPracticeSetId(item.id);
    setPracticeSetForm({
      name: item.name,
      description: item.description || "",
      single_count: item.single_count,
      multiple_count: item.multiple_count,
      judgement_count: item.judgement_count,
      subject: item.subject || "",
      difficulty: item.difficulty || "",
      is_published: item.is_published,
    });
  }

  function resetPracticeSetForm() {
    setEditingPracticeSetId(null);
    setPracticeSetForm(EMPTY_PRACTICE_SET_FORM);
    setPracticeSetErrors([]);
  }

  async function submitPracticeSet(event) {
    event.preventDefault();
    setError("");
    const validationErrors = validatePracticeSetForm();
    if (validationErrors.length) {
      setPracticeSetErrors(validationErrors);
      return;
    }
    setSaving(true);
    try {
      await api(editingPracticeSetId ? `/api/admin/practice-sets/${editingPracticeSetId}` : "/api/admin/practice-sets", {
        method: editingPracticeSetId ? "PUT" : "POST",
        body: JSON.stringify({
          ...practiceSetForm,
          single_count: Number(practiceSetForm.single_count),
          multiple_count: Number(practiceSetForm.multiple_count),
          judgement_count: Number(practiceSetForm.judgement_count),
          subject: practiceSetForm.subject || null,
          difficulty: practiceSetForm.difficulty || null,
        }),
      });
      resetPracticeSetForm();
      await reloadPracticeSets();
      setAdminNotice(editingPracticeSetId ? "练习配置已保存。" : "练习配置已创建。");
      setBaseRefresh((key) => key + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function togglePracticeSet(item) {
    setError("");
    try {
      await api(`/api/admin/practice-sets/${item.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_published: !item.is_published }),
      });
      await reloadPracticeSets();
      setAdminNotice(item.is_published ? "练习配置已下架。" : "练习配置已发布。");
      setBaseRefresh((key) => key + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAdminUser(item, patch) {
    setError("");
    try {
      await api(`/api/admin/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setAdminNotice("用户信息已更新。");
      setBaseRefresh((key) => key + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  function confirmAdminUserPatch(item, patch, message) {
    if (!window.confirm(message)) return;
    updateAdminUser(item, patch);
  }

  async function resetAdminPassword(item) {
    const nextPassword = window.prompt(`为 ${item.username} 设置新密码（至少 6 位）`);
    if (!nextPassword) return;
    setError("");
    try {
      await api(`/api/admin/users/${item.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: nextPassword }),
      });
      setAdminNotice("用户密码已重置。");
      setBaseRefresh((key) => key + 1);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="mode-panel admin-panel">
      <div className="toolbar">
        <div>
          <h2>管理平台</h2>
          <p>支持题库检索、详情核查、新增、编辑、停用和导出，所有管理变更写入本地数据库。</p>
        </div>
        <Shield size={28} />
      </div>

      <div className="admin-tabs" aria-label="管理平台二级导航">
        {ADMIN_TABS.map((item) => (
          <button
            key={item.key}
            className={adminTab === item.key ? "active" : ""}
            type="button"
            onClick={() => setAdminTab(item.key)}
          >
            {item.label}
            <span>{item.description}</span>
          </button>
        ))}
      </div>

      {adminTab === "overview" && summary && (
        <>
          <div className="metric-grid">
            <div>
              <span>题库总量</span>
              <strong>{summary.question_total}</strong>
            </div>
            <div>
              <span>活跃用户</span>
              <strong>
                {summary.users.active} / {summary.users.total}
              </strong>
            </div>
            <div>
              <span>顺序记录</span>
              <strong>{summary.practice.sequential_records}</strong>
            </div>
            <div>
              <span>停用题目</span>
              <strong>{summary.inactive_question_total ?? 0}</strong>
            </div>
          </div>
          <div className="overview-grid">
            <button className="overview-card" type="button" onClick={() => setAdminTab("questions")}>
              <span>题库管理</span>
              <strong>{summary.question_total}</strong>
              <p>{summary.inactive_question_total ?? 0} 道停用题，支持检索、编辑、停用和导出。</p>
            </button>
            <button className="overview-card" type="button" onClick={() => setAdminTab("practiceSets")}>
              <span>练习配置</span>
              <strong>{practiceSets.length}</strong>
              <p>管理专项练习的题量、科目、难度和发布状态。</p>
            </button>
            <button className="overview-card" type="button" onClick={() => setAdminTab("users")}>
              <span>用户管理</span>
              <strong>
                {summary.users.active} / {summary.users.total}
              </strong>
              <p>查看账号状态、角色、顺序刷题记录和最近访问。</p>
            </button>
            <button className="overview-card" type="button" onClick={() => setAdminTab("audit")}>
              <span>操作审计</span>
              <strong>{auditLogs.length}</strong>
              <p>追踪最近的题库、配置和用户管理变更。</p>
            </button>
          </div>
        </>
      )}

      {adminTab === "questions" && (
      <div className="admin-section">
        <div className="section-heading">
          <h3>题库管理</h3>
          <div className="section-actions">
            <span>{questions?.total ?? "--"} 题</span>
            <button className="table-action" type="button" onClick={startCreateQuestion}>
              新增题目
            </button>
            <button className="table-action" type="button" onClick={exportQuestionBank}>
              导出
            </button>
          </div>
        </div>
        <div className="admin-filters">
          <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
            <option value="">全部题型</option>
            <option value="single">单选</option>
            <option value="multiple">多选</option>
            <option value="judgement">判断</option>
          </select>
          <select value={filters.subject} onChange={(event) => updateFilter("subject", event.target.value)}>
            <option value="">全部科目</option>
            {subjects.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </select>
          <select value={filters.difficulty} onChange={(event) => updateFilter("difficulty", event.target.value)}>
            <option value="">全部难度</option>
            {QUESTION_DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
          <select value={filters.origin} onChange={(event) => updateFilter("origin", event.target.value)}>
            <option value="">全部来源</option>
            <option value="base">基础题库</option>
            <option value="custom">新增题目</option>
          </select>
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="筛选知识点"
              value={filters.knowledgePoint}
              onChange={(event) => updateFilter("knowledgePoint", event.target.value)}
            />
          </label>
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="搜索题干、章节、知识点"
              value={filters.keyword}
              onChange={(event) => updateFilter("keyword", event.target.value)}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={filters.includeInactive}
              onChange={(event) => updateFilter("includeInactive", event.target.checked)}
            />
            显示停用题
          </label>
          <button className="table-action" type="button" onClick={resetQuestionFilters}>
            重置筛选
          </button>
        </div>
        {formOpen && (
          <form className="question-editor" onSubmit={submitQuestionForm}>
            <div className="section-heading">
              <h3>{editingId ? `编辑题目 ${editingId}` : "新增题目"}</h3>
              <button className="table-action" type="button" onClick={() => setFormOpen(false)}>
                取消
              </button>
            </div>
            {questionFormErrors.length > 0 && (
              <div className="form-errors" role="alert">
                <b>请先修正以下内容</b>
                <ul>
                  {questionFormErrors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="editor-grid">
              <label>
                科目
                <input value={questionForm.subject} onChange={(event) => updateQuestionForm("subject", event.target.value)} />
              </label>
              <label>
                章节
                <input value={questionForm.section} onChange={(event) => updateQuestionForm("section", event.target.value)} />
              </label>
              <label>
                题型
                <select value={questionForm.type} onChange={(event) => updateQuestionType(event.target.value)}>
                  <option value="single">单选</option>
                  <option value="multiple">多选</option>
                  <option value="judgement">判断</option>
                </select>
              </label>
              <label>
                难度
                <input value={questionForm.difficulty} onChange={(event) => updateQuestionForm("difficulty", event.target.value)} />
              </label>
            </div>
            <label>
              题干
              <textarea value={questionForm.question} onChange={(event) => updateQuestionForm("question", event.target.value)} />
            </label>
            <div className="editor-grid options-grid">
              {questionOptionLetters.map((letter) => (
                <label key={letter}>
                  选项 {letter.toUpperCase()}
                  <input
                    value={questionForm[`option_${letter}`]}
                    onChange={(event) => updateQuestionForm(`option_${letter}`, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="editor-grid">
              <label>
                答案
                <input value={questionForm.answer} onChange={(event) => updateQuestionForm("answer", event.target.value)} />
              </label>
              <label>
                知识点
                <input value={questionForm.knowledge_point} onChange={(event) => updateQuestionForm("knowledge_point", event.target.value)} />
              </label>
              <label>
                来源文件
                <input value={questionForm.source_file} onChange={(event) => updateQuestionForm("source_file", event.target.value)} />
              </label>
              <label>
                来源页码
                <input value={questionForm.source_page} onChange={(event) => updateQuestionForm("source_page", event.target.value)} />
              </label>
            </div>
            <label>
              答案内容
              <textarea value={questionForm.answer_text} onChange={(event) => updateQuestionForm("answer_text", event.target.value)} />
            </label>
            <label>
              解析
              <textarea value={questionForm.explanation} onChange={(event) => updateQuestionForm("explanation", event.target.value)} />
            </label>
            <label>
              来源摘录
              <textarea value={questionForm.source_excerpt} onChange={(event) => updateQuestionForm("source_excerpt", event.target.value)} />
            </label>
            {questionPreviewOpen && (
              <div className="save-preview" role="dialog" aria-label="题目保存前预览">
                <div className="section-heading">
                  <h3>保存前预览</h3>
                  <div className="section-actions">
                    <button className="table-action" type="button" onClick={() => setQuestionPreviewOpen(false)}>
                      继续修改
                    </button>
                    <button className="primary" type="button" onClick={confirmQuestionSave} disabled={saving}>
                      {saving ? "保存中" : "确认保存"}
                    </button>
                  </div>
                </div>
                <div className="question-meta">
                  <span>{questionPreview.typeLabel}</span>
                  <span>{questionPreview.difficulty}</span>
                  <span>{questionPreview.subject}</span>
                  <span>{questionPreview.knowledgePoint}</span>
                </div>
                <p className="detail-question">{questionPreview.question}</p>
                <div className="preview-options">
                  {questionPreview.options.map((option) => (
                    <div key={option.letter} className={questionPreview.answer.includes(option.letter) ? "answer-option" : ""}>
                      <b>{option.letter}</b>
                      <span>{option.text}</span>
                    </div>
                  ))}
                </div>
                <p>
                  <b>答案：</b>
                  {questionPreview.answer.join("")}，{questionPreview.answerText}
                </p>
                <p>
                  <b>解析：</b>
                  {questionPreview.explanation}
                </p>
                <p className="source">
                  来源：{questionPreview.sourceFile}，{questionPreview.sourcePage}
                </p>
              </div>
            )}
            <button className="primary" type="submit" disabled={saving}>
              {questionPreviewOpen ? "更新预览" : "预览并保存"}
            </button>
          </form>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>状态</th>
                <th>来源</th>
                <th>题型</th>
                <th>难度</th>
                <th>科目</th>
                <th>题干</th>
                <th>答案</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(questions?.items || []).map((item) => (
                <tr key={item.id}>
                  <td>{item.position}</td>
                  <td>{item.is_active ? "启用" : "停用"}</td>
                  <td>{item.origin === "custom" ? "新增" : "基础"}</td>
                  <td>{item.type_label}</td>
                  <td>{item.difficulty}</td>
                  <td>{item.subject}</td>
                  <td>{item.question}</td>
                  <td>{item.answer.join("")}</td>
                  <td>
                    <div className="row-actions">
                      <button className="table-action" type="button" onClick={() => openQuestionDetail(item.id)}>
                        查看
                      </button>
                      <button className="table-action" type="button" onClick={() => startEditQuestion(item.id)}>
                        编辑
                      </button>
                      <button className="table-action danger-action" type="button" onClick={() => toggleQuestionStatus(item)}>
                        {item.is_active ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedQuestion && (
          <div className="detail-panel">
            <div className="section-heading">
              <h3>题目详情</h3>
              <button className="table-action" type="button" onClick={() => setSelectedQuestion(null)}>
                关闭
              </button>
            </div>
            <div className="question-meta">
              <span>第 {selectedQuestion.position} 题</span>
              <span>{selectedQuestion.type_label}</span>
              <span>{selectedQuestion.difficulty}</span>
              <span>{selectedQuestion.subject}</span>
              <span>{selectedQuestion.is_active ? "启用" : "停用"}</span>
            </div>
            <p className="detail-question">{selectedQuestion.question}</p>
            <div className="detail-options">
              {selectedQuestion.options.map((option) => (
                <div key={option.letter} className={selectedQuestion.answer.includes(option.letter) ? "answer-option" : ""}>
                  <b>{option.letter}</b>
                  <span>{option.text}</span>
                </div>
              ))}
            </div>
            <p>
              <b>答案：</b>
              {selectedQuestion.answer.join("")}，{selectedQuestion.answer_text}
            </p>
            <p>
              <b>解析：</b>
              {selectedQuestion.explanation}
            </p>
            <p className="source">
              来源：{selectedQuestion.source.file}，{selectedQuestion.source.page}
            </p>
          </div>
        )}
        <div className="pager">
          <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
            上一页
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
            下一页
          </button>
        </div>
      </div>
      )}

      {adminTab === "practiceSets" && (
      <div className="admin-section">
        <div className="section-heading">
          <h3>{editingPracticeSetId ? `编辑练习配置 ${editingPracticeSetId}` : "练习配置"}</h3>
          <div className="section-actions">
            <span>{practiceSets.length} 个</span>
            {editingPracticeSetId && (
              <button className="table-action" type="button" onClick={resetPracticeSetForm}>
                取消编辑
              </button>
            )}
          </div>
        </div>
        {practiceAvailability && (
          <div className="availability-strip">
            <span>当前可用题量</span>
            <b>单选 {practiceAvailability.single}</b>
            <b>多选 {practiceAvailability.multiple}</b>
            <b>判断 {practiceAvailability.judgement}</b>
          </div>
        )}
        {practiceSetErrors.length > 0 && (
          <div className="form-errors" role="alert">
            <b>练习配置超出可用题量</b>
            <ul>
              {practiceSetErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <form className="practice-set-form" onSubmit={submitPracticeSet}>
          <label>
            名称
            <input
              required
              value={practiceSetForm.name}
              onChange={(event) => updatePracticeSetForm("name", event.target.value)}
            />
          </label>
          <label>
            单选
            <input
              min="0"
              type="number"
              value={practiceSetForm.single_count}
              onChange={(event) => updatePracticeSetForm("single_count", event.target.value)}
            />
          </label>
          <label>
            多选
            <input
              min="0"
              type="number"
              value={practiceSetForm.multiple_count}
              onChange={(event) => updatePracticeSetForm("multiple_count", event.target.value)}
            />
          </label>
          <label>
            判断
            <input
              min="0"
              type="number"
              value={practiceSetForm.judgement_count}
              onChange={(event) => updatePracticeSetForm("judgement_count", event.target.value)}
            />
          </label>
          <label>
            科目过滤
            <input
              placeholder="留空表示不限"
              value={practiceSetForm.subject}
              onChange={(event) => updatePracticeSetForm("subject", event.target.value)}
            />
          </label>
          <label>
            难度过滤
            <input
              placeholder="留空表示不限"
              value={practiceSetForm.difficulty}
              onChange={(event) => updatePracticeSetForm("difficulty", event.target.value)}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={practiceSetForm.is_published}
              onChange={(event) => updatePracticeSetForm("is_published", event.target.checked)}
            />
            发布
          </label>
          <button className="primary" type="submit" disabled={saving}>
            {editingPracticeSetId ? "保存修改" : "保存配置"}
          </button>
          <label className="practice-description">
            说明
            <input
              value={practiceSetForm.description}
              onChange={(event) => updatePracticeSetForm("description", event.target.value)}
            />
          </label>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>名称</th>
                <th>题量</th>
                <th>过滤</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {practiceSets.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.name}</td>
                  <td>
                    单 {item.single_count} / 多 {item.multiple_count} / 判 {item.judgement_count}
                  </td>
                  <td>
                    {item.subject || "不限科目"} / {item.difficulty || "不限难度"}
                  </td>
                  <td>{item.is_published ? "已发布" : "未发布"}</td>
                  <td>
                    <div className="row-actions">
                      <button className="table-action" type="button" onClick={() => startEditPracticeSet(item)}>
                        编辑
                      </button>
                      <button className="table-action" type="button" onClick={() => togglePracticeSet(item)}>
                        {item.is_published ? "下架" : "发布"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {adminTab === "users" && (
      <div className="admin-section">
        <div className="section-heading">
          <h3>用户管理</h3>
          <span>{users.length} 人</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>用户名</th>
                <th>显示名</th>
                <th>角色</th>
                <th>状态</th>
                <th>顺序已刷</th>
                <th>最近访问</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.username}</td>
                  <td>{item.display_name}</td>
                  <td>{item.role === "admin" ? "管理员" : "用户"}</td>
                  <td>{item.is_active ? "启用" : "停用"}</td>
                  <td>{item.practiced_count}</td>
                  <td>{item.last_seen_at || "-"}</td>
                  <td>
                    <div className="row-actions">
                      <button className="table-action" type="button" onClick={() => setSelectedAdminUser(item)}>
                        查看
                      </button>
                      <button
                        className="table-action"
                        type="button"
                        onClick={() =>
                          confirmAdminUserPatch(
                            item,
                            { role: item.role === "admin" ? "user" : "admin" },
                            `确认将 ${item.username} ${item.role === "admin" ? "设为普通用户" : "设为管理员"}？`
                          )
                        }
                      >
                        {item.role === "admin" ? "设为用户" : "设为管理员"}
                      </button>
                      <button
                        className="table-action danger-action"
                        type="button"
                        onClick={() =>
                          confirmAdminUserPatch(
                            item,
                            { is_active: !item.is_active },
                            `确认${item.is_active ? "停用" : "启用"}账号 ${item.username}？`
                          )
                        }
                      >
                        {item.is_active ? "停用" : "启用"}
                      </button>
                      <button className="table-action" type="button" onClick={() => resetAdminPassword(item)}>
                        重置密码
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedAdminUser && (
          <div className="detail-panel user-detail-panel">
            <div className="section-heading">
              <h3>用户详情</h3>
              <button className="table-action" type="button" onClick={() => setSelectedAdminUser(null)}>
                关闭
              </button>
            </div>
            <div className="user-detail-grid">
              <div>
                <span>用户名</span>
                <b>{selectedAdminUser.username}</b>
              </div>
              <div>
                <span>显示名</span>
                <b>{selectedAdminUser.display_name}</b>
              </div>
              <div>
                <span>角色</span>
                <b>{selectedAdminUser.role === "admin" ? "管理员" : "用户"}</b>
              </div>
              <div>
                <span>状态</span>
                <b>{selectedAdminUser.is_active ? "启用" : "停用"}</b>
              </div>
              <div>
                <span>顺序已刷</span>
                <b>{selectedAdminUser.practiced_count}</b>
              </div>
              <div>
                <span>最近访问</span>
                <b>{selectedAdminUser.last_seen_at || "-"}</b>
              </div>
              <div>
                <span>创建时间</span>
                <b>{selectedAdminUser.created_at}</b>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {adminTab === "audit" && (
      <div className="admin-section">
        <div className="section-heading">
          <h3>操作审计</h3>
          <span>{auditLogs.length} 条</span>
        </div>
        <div className="admin-filters audit-filters">
          <select value={auditFilters.action} onChange={(event) => updateAuditFilter("action", event.target.value)}>
            <option value="">全部动作</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <select value={auditFilters.targetType} onChange={(event) => updateAuditFilter("targetType", event.target.value)}>
            <option value="">全部对象</option>
            {AUDIT_TARGET_TYPES.map((targetType) => (
              <option key={targetType} value={targetType}>
                {targetType}
              </option>
            ))}
          </select>
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="筛选账号"
              value={auditFilters.actor}
              onChange={(event) => updateAuditFilter("actor", event.target.value)}
            />
          </label>
          <button className="table-action" type="button" onClick={resetAuditFilters}>
            重置筛选
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>账号</th>
                <th>动作</th>
                <th>对象</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((item) => (
                <tr key={item.id}>
                  <td>{item.created_at}</td>
                  <td>{item.actor_username}</td>
                  <td>{item.action}</td>
                  <td>
                    {item.target_type} / {item.target_id}
                  </td>
                  <td className="audit-detail">{formatAuditDetail(item.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {error && <p className="error">{error}</p>}
      {adminNotice && <p className="status-message">{adminNotice}</p>}
    </section>
  );
}

export default function App() {
  const [mode, setMode] = useState("random");
  const [refreshKey, setRefreshKey] = useState(0);
  const [user, setUser] = useState(() => readStoredAuth()?.user || null);
  const [authReady, setAuthReady] = useState(false);
  const stats = useStats(refreshKey);
  const subjectText = useMemo(() => {
    if (!stats) return "";
    return Object.entries(stats.subject_counts)
      .map(([name, count]) => `${name} ${count}`)
      .join(" / ");
  }, [stats]);

  useEffect(() => {
    const stored = readStoredAuth();
    if (!stored?.token) {
      setAuthReady(true);
      return;
    }
    api("/api/auth/me")
      .then((payload) => {
        const next = { ...stored, user: payload.user };
        storeAuth(next);
        setUser(payload.user);
      })
      .catch(() => {
        clearStoredAuth();
        setUser(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (mode === "admin" && user?.role !== "admin") {
      setMode("random");
    }
  }, [mode, user]);

  function handleAuthenticated(nextUser) {
    setUser(nextUser);
    setRefreshKey((key) => key + 1);
  }

  async function handleLogout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Local state still needs to be cleared when the server token is already expired.
    }
    clearStoredAuth();
    setUser(null);
    setMode("random");
    setRefreshKey((key) => key + 1);
  }

  return (
    <main>
      <header className="app-header">
        <div>
          <p className="eyebrow">本地刷题工具</p>
          <h1>🃏 小王刷题</h1>
        </div>
        <div className="header-side">
          <div className="stats-strip">
            <span>题库 {stats?.total ?? "--"} 题</span>
            <span>单选 {stats?.type_counts?.single ?? "--"}</span>
            <span>多选 {stats?.type_counts?.multiple ?? "--"}</span>
            <span>判断 {stats?.type_counts?.judgement ?? "--"}</span>
          </div>
          {user && (
            <div className="user-chip">
              <UserRound size={16} />
              <span>{user.display_name || user.username}</span>
              <button type="button" onClick={handleLogout} title="退出登录">
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </header>

      {!authReady ? (
        <section className="mode-panel">正在加载账号状态...</section>
      ) : !user ? (
        <AuthPanel onAuthenticated={handleAuthenticated} />
      ) : (
        <>
          <nav className="mode-tabs" aria-label="刷题模式">
            <button
              className={mode === "learning" ? "active" : ""}
              type="button"
              onClick={() => setMode("learning")}
            >
              <BookOpen size={18} />
              学习中心
            </button>
            <button className={mode === "random" ? "active" : ""} type="button" onClick={() => setMode("random")}>
              <Shuffle size={18} />
              随机刷题
            </button>
            <button
              className={mode === "sequential" ? "active" : ""}
              type="button"
              onClick={() => setMode("sequential")}
            >
              <ListRestart size={18} />
              顺序刷题
            </button>
            {user.role === "admin" && (
              <button className={mode === "admin" ? "active" : ""} type="button" onClick={() => setMode("admin")}>
                <Shield size={18} />
                管理平台
              </button>
            )}
          </nav>

          {stats && <p className="subject-line">{subjectText}</p>}

          {mode === "learning" && <LearningCenter />}
          {mode === "random" && <RandomPractice onRefreshStats={() => setRefreshKey((key) => key + 1)} />}
          {mode === "sequential" && <SequentialPractice onRefreshStats={() => setRefreshKey((key) => key + 1)} />}
          {mode === "admin" && user.role === "admin" && <AdminDashboard />}
        </>
      )}
    </main>
  );
}
