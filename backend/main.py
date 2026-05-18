from __future__ import annotations

import json
import hashlib
import hmac
import random
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "question_bank.json"
SAMPLE_DATA_PATH = ROOT / "data" / "question_bank.sample.json"
DB_PATH = ROOT / "data" / "app_state.sqlite"
DIST_DIR = ROOT / "frontend" / "dist"


class AnswerPayload(BaseModel):
    question_id: str
    selected: list[str] | str = Field(default_factory=list)


class SequentialAnswerPayload(BaseModel):
    selected: list[str] | str = Field(default_factory=list)


class RegisterPayload(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=40)


class LoginPayload(BaseModel):
    username: str
    password: str


class QuestionUpsertPayload(BaseModel):
    subject: str = Field(min_length=1, max_length=80)
    section: str = Field(min_length=1, max_length=120)
    type: str
    difficulty: str = Field(min_length=1, max_length=40)
    question: str = Field(min_length=3, max_length=1200)
    option_a: str = Field(min_length=1, max_length=800)
    option_b: str = Field(min_length=1, max_length=800)
    option_c: str = Field(default="", max_length=800)
    option_d: str = Field(default="", max_length=800)
    option_e: str = Field(default="", max_length=800)
    answer: str = Field(min_length=1, max_length=5)
    answer_text: str = Field(min_length=1, max_length=1200)
    explanation: str = Field(min_length=1, max_length=3000)
    source_file: str = Field(min_length=1, max_length=200)
    source_page: str = Field(min_length=1, max_length=120)
    source_excerpt: str = Field(min_length=1, max_length=2000)
    knowledge_point: str = Field(min_length=1, max_length=120)


class QuestionStatusPayload(BaseModel):
    is_active: bool


class PracticeSetPayload(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=500)
    single_count: int = Field(default=2, ge=0, le=200)
    multiple_count: int = Field(default=1, ge=0, le=200)
    judgement_count: int = Field(default=1, ge=0, le=200)
    subject: str | None = Field(default=None, max_length=80)
    difficulty: str | None = Field(default=None, max_length=40)
    is_published: bool = True


class PracticeSetStatusPayload(BaseModel):
    is_published: bool


class MasteryPayload(BaseModel):
    mastered: bool = True


class AdminUserUpdatePayload(BaseModel):
    display_name: str | None = Field(default=None, max_length=40)
    role: str | None = None
    is_active: bool | None = None


class PasswordResetPayload(BaseModel):
    password: str = Field(min_length=6, max_length=128)


def load_questions() -> list[dict[str, Any]]:
    source_path = DATA_PATH if DATA_PATH.exists() else SAMPLE_DATA_PATH
    if not source_path.exists():
        raise RuntimeError(
            "Question bank not found. Put your private bank at data/question_bank.json "
            "or keep data/question_bank.sample.json for local demo use."
        )
    with source_path.open("r", encoding="utf-8") as f:
        questions = json.load(f)
    return questions


QUESTIONS = load_questions()
QUESTION_BY_ID = {question["id"]: question for question in QUESTIONS}
QUESTION_POSITION = {question["id"]: index for index, question in enumerate(QUESTIONS, start=1)}
SESSION_TTL_DAYS = 14
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123456"
DEFAULT_DEMO_USERNAME = "demo"
DEFAULT_DEMO_PASSWORD = "demo123456"
QUESTION_TYPE_LABELS = {"single": "单选", "multiple": "多选", "judgement": "判断"}
QUESTION_TYPE_LABELS_FULL = {"single": "单项选择题", "multiple": "多项选择题", "judgement": "判断题"}
BASE_QUESTION_IDS = {question["id"] for question in QUESTIONS}


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 120_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, iterations_text, salt_hex, digest_hex = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_payload(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
    }


def get_user_by_username(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM users WHERE lower(username) = lower(?)",
        (username.strip(),),
    ).fetchone()


def create_user(
    conn: sqlite3.Connection,
    username: str,
    password: str,
    role: str = "user",
    display_name: str | None = None,
) -> sqlite3.Row:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO users(username, password_hash, display_name, role, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        """,
        (username.strip(), hash_password(password), display_name or username.strip(), role, now),
    )
    return get_user_by_username(conn, username)


def issue_session(conn: sqlite3.Connection, user_id: int) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=SESSION_TTL_DAYS)
    conn.execute(
        """
        INSERT INTO user_sessions(token_hash, user_id, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (token_hash(token), user_id, now.isoformat(), expires.isoformat(), now.isoformat()),
    )
    return token, expires.isoformat()


def _authorization_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def get_current_user(authorization: str | None = Header(default=None)) -> sqlite3.Row:
    token = _authorization_token(authorization)
    if not token:
        raise HTTPException(401, "请先登录")
    hashed = token_hash(token)
    with db() as conn:
        row = conn.execute(
            """
            SELECT users.*
            FROM user_sessions
            JOIN users ON users.id = user_sessions.user_id
            WHERE user_sessions.token_hash = ?
              AND user_sessions.expires_at > ?
              AND users.is_active = 1
            """,
            (hashed, utc_now()),
        ).fetchone()
        if row is None:
            raise HTTPException(401, "登录已失效，请重新登录")
        conn.execute(
            "UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?",
            (utc_now(), hashed),
        )
        conn.commit()
        return row


def get_optional_user(authorization: str | None = Header(default=None)) -> sqlite3.Row | None:
    if not _authorization_token(authorization):
        return None
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None


def require_admin(user: sqlite3.Row = Depends(get_current_user)) -> sqlite3.Row:
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


def validate_username(username: str) -> str:
    normalized = username.strip()
    if not normalized:
        raise HTTPException(400, "用户名不能为空")
    if any(char.isspace() for char in normalized):
        raise HTTPException(400, "用户名不能包含空格")
    if not all(char.isalnum() or char in "_.-" for char in normalized):
        raise HTTPException(400, "用户名只能包含字母、数字、下划线、点或短横线")
    return normalized


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        if get_user_by_username(conn, DEFAULT_ADMIN_USERNAME) is None:
            create_user(
                conn,
                DEFAULT_ADMIN_USERNAME,
                DEFAULT_ADMIN_PASSWORD,
                role="admin",
                display_name="管理员",
            )
        if get_user_by_username(conn, DEFAULT_DEMO_USERNAME) is None:
            create_user(
                conn,
                DEFAULT_DEMO_USERNAME,
                DEFAULT_DEMO_PASSWORD,
                role="user",
                display_name="演示用户",
            )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS practiced_questions (
                user_id INTEGER NOT NULL DEFAULT 1,
                question_id TEXT NOT NULL,
                practiced_at TEXT DEFAULT CURRENT_TIMESTAMP,
                selected_answer TEXT,
                PRIMARY KEY (user_id, question_id)
            )
            """
        )
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(practiced_questions)").fetchall()
        }
        practiced_pk = {
            row["name"]: row["pk"]
            for row in conn.execute("PRAGMA table_info(practiced_questions)").fetchall()
        }
        if "user_id" not in columns or practiced_pk.get("question_id") == 1:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS practiced_questions_new (
                    user_id INTEGER NOT NULL DEFAULT 1,
                    question_id TEXT NOT NULL,
                    practiced_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    selected_answer TEXT,
                    PRIMARY KEY (user_id, question_id)
                )
                """
            )
            existing_columns = columns
            selected_expr = "selected_answer" if "selected_answer" in existing_columns else "NULL"
            user_expr = "user_id" if "user_id" in existing_columns else "1"
            conn.execute(
                f"""
                INSERT OR IGNORE INTO practiced_questions_new(user_id, question_id, practiced_at, selected_answer)
                SELECT {user_expr}, question_id, practiced_at, {selected_expr}
                FROM practiced_questions
                """
            )
            conn.execute("DROP TABLE practiced_questions")
            conn.execute("ALTER TABLE practiced_questions_new RENAME TO practiced_questions")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS random_sessions (
                session_id TEXT,
                user_id INTEGER NOT NULL DEFAULT 1,
                question_id TEXT,
                position INTEGER,
                selected_answer TEXT,
                submitted_at TEXT,
                PRIMARY KEY (session_id, question_id)
            )
            """
        )
        random_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(random_sessions)").fetchall()
        }
        if "user_id" not in random_columns:
            conn.execute("ALTER TABLE random_sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS answer_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('random', 'sequential')),
                session_id TEXT,
                question_id TEXT NOT NULL,
                question_type TEXT NOT NULL,
                subject TEXT NOT NULL,
                section TEXT NOT NULL,
                selected_answer TEXT NOT NULL,
                correct INTEGER NOT NULL,
                answered_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_answer_records_user_time ON answer_records(user_id, answered_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_answer_records_user_question ON answer_records(user_id, question_id)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS question_favorites (
                user_id INTEGER NOT NULL,
                question_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, question_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS question_mastery (
                user_id INTEGER NOT NULL,
                question_id TEXT NOT NULL,
                mastered_at TEXT NOT NULL,
                PRIMARY KEY (user_id, question_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS managed_questions (
                question_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                origin TEXT NOT NULL CHECK(origin IN ('base', 'custom')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                updated_by INTEGER NOT NULL,
                FOREIGN KEY(updated_by) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS question_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id TEXT NOT NULL,
                action TEXT NOT NULL,
                actor_user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                payload TEXT,
                FOREIGN KEY(actor_user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS practice_sets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                single_count INTEGER NOT NULL DEFAULT 50,
                multiple_count INTEGER NOT NULL DEFAULT 30,
                judgement_count INTEGER NOT NULL DEFAULT 20,
                subject TEXT,
                difficulty TEXT,
                is_published INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                detail TEXT,
                FOREIGN KEY(actor_user_id) REFERENCES users(id)
            )
            """
        )
        conn.commit()


def managed_question_map(include_inactive: bool = False) -> dict[str, dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM managed_questions").fetchall()
    mapped: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not include_inactive and not row["is_active"]:
            mapped[row["question_id"]] = {"is_active": False, "payload": None, "origin": row["origin"]}
            continue
        payload = json.loads(row["payload"])
        payload["id"] = row["question_id"]
        payload["is_active"] = bool(row["is_active"])
        payload["origin"] = row["origin"]
        mapped[row["question_id"]] = {
            "is_active": bool(row["is_active"]),
            "payload": payload,
            "origin": row["origin"],
        }
    return mapped


def all_questions(include_inactive: bool = False) -> list[dict[str, Any]]:
    managed = managed_question_map(include_inactive=include_inactive)
    questions: list[dict[str, Any]] = []
    for base_question in QUESTIONS:
        override = managed.get(base_question["id"])
        if override:
            if override["is_active"] or include_inactive:
                question = override["payload"] or (base_question | {"is_active": False, "origin": "base"})
                questions.append(question)
            continue
        questions.append(base_question | {"is_active": True, "origin": "base"})

    custom_questions = [
        item["payload"]
        for question_id, item in managed.items()
        if question_id not in BASE_QUESTION_IDS and (item["is_active"] or include_inactive) and item["payload"]
    ]
    questions.extend(sorted(custom_questions, key=lambda question: question["id"]))
    return questions


def question_by_id(question_id: str, include_inactive: bool = False) -> dict[str, Any] | None:
    for question in all_questions(include_inactive=include_inactive):
        if question["id"] == question_id:
            return question
    return None


def question_position_map(include_inactive: bool = False) -> dict[str, int]:
    return {
        question["id"]: index
        for index, question in enumerate(all_questions(include_inactive=include_inactive), start=1)
    }


def question_position(question_id: str, include_inactive: bool = False) -> int:
    positions = question_position_map(include_inactive=include_inactive)
    return positions.get(question_id, 0)


def next_custom_question_id(conn: sqlite3.Connection) -> str:
    rows = conn.execute(
        "SELECT question_id FROM managed_questions WHERE origin = 'custom' AND question_id LIKE 'C%'"
    ).fetchall()
    max_number = 0
    for row in rows:
        suffix = row["question_id"][1:]
        if suffix.isdigit():
            max_number = max(max_number, int(suffix))
    return f"C{max_number + 1:04d}"


def validate_question_data(data: dict[str, Any]) -> dict[str, Any]:
    question_type = data["type"].strip()
    if question_type not in QUESTION_TYPE_LABELS_FULL:
        raise HTTPException(400, "题型必须是 single、multiple 或 judgement")

    options = {
        "A": data["option_a"].strip(),
        "B": data["option_b"].strip(),
        "C": data.get("option_c", "").strip(),
        "D": data.get("option_d", "").strip(),
        "E": data.get("option_e", "").strip(),
    }
    available = {letter for letter, text in options.items() if text}
    answer = "".join(dict.fromkeys(data["answer"].replace(",", "").replace("，", "").upper()))
    if not answer or any(letter not in available for letter in answer):
        raise HTTPException(400, "答案必须对应已有选项")
    if question_type in {"single", "judgement"} and len(answer) != 1:
        raise HTTPException(400, "单选题和判断题只能有一个正确答案")
    if question_type == "multiple" and len(answer) < 2:
        raise HTTPException(400, "多选题至少需要两个正确答案")

    cleaned = {key: value.strip() if isinstance(value, str) else value for key, value in data.items()}
    cleaned["type"] = question_type
    cleaned["type_label"] = QUESTION_TYPE_LABELS_FULL[question_type]
    cleaned["answer"] = "".join(sorted(answer)) if question_type == "multiple" else answer
    cleaned["style_reference"] = "管理员维护题；保留题库来源和解析审计。"
    return cleaned


def build_question_payload(payload: QuestionUpsertPayload, question_id: str) -> dict[str, Any]:
    data = validate_question_data(payload.model_dump())
    data["id"] = question_id
    return data


def save_question_audit(
    conn: sqlite3.Connection,
    question_id: str,
    action: str,
    actor_user_id: int,
    payload: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO question_audit_logs(question_id, action, actor_user_id, created_at, payload)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            question_id,
            action,
            actor_user_id,
            utc_now(),
            json.dumps(payload, ensure_ascii=False) if payload is not None else None,
        ),
    )


def save_admin_audit(
    conn: sqlite3.Connection,
    actor_user_id: int,
    action: str,
    target_type: str,
    target_id: str | int,
    detail: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO admin_audit_logs(actor_user_id, action, target_type, target_id, created_at, detail)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            actor_user_id,
            action,
            target_type,
            str(target_id),
            utc_now(),
            json.dumps(detail, ensure_ascii=False) if detail is not None else None,
        ),
    )


def practice_set_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "single_count": row["single_count"],
        "multiple_count": row["multiple_count"],
        "judgement_count": row["judgement_count"],
        "subject": row["subject"],
        "difficulty": row["difficulty"],
        "is_published": bool(row["is_published"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def latest_wrong_records(conn: sqlite3.Connection, user_id: int, limit: int | None = None) -> list[sqlite3.Row]:
    limit_sql = "" if limit is None else "LIMIT ?"
    params: tuple[Any, ...] = (user_id,) if limit is None else (user_id, limit)
    return conn.execute(
        f"""
        SELECT answer_records.*
        FROM answer_records
        JOIN (
            SELECT question_id, MAX(id) AS latest_id
            FROM answer_records
            WHERE user_id = ?
            GROUP BY question_id
        ) latest ON latest.latest_id = answer_records.id
        LEFT JOIN question_mastery
          ON question_mastery.user_id = answer_records.user_id
         AND question_mastery.question_id = answer_records.question_id
        WHERE answer_records.correct = 0
          AND question_mastery.question_id IS NULL
        ORDER BY answer_records.id DESC
        {limit_sql}
        """,
        params,
    ).fetchall()


def latest_wrong_count(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute(
        """
        SELECT COUNT(*)
        FROM answer_records
        JOIN (
            SELECT question_id, MAX(id) AS latest_id
            FROM answer_records
            WHERE user_id = ?
            GROUP BY question_id
        ) latest ON latest.latest_id = answer_records.id
        LEFT JOIN question_mastery
          ON question_mastery.user_id = answer_records.user_id
         AND question_mastery.question_id = answer_records.question_id
        WHERE answer_records.correct = 0
          AND question_mastery.question_id IS NULL
        """,
        (user_id,),
    ).fetchone()[0]


def create_random_session_for_rule(
    user_id: int,
    counts: dict[str, int],
    subject: str | None = None,
    difficulty: str | None = None,
) -> dict[str, Any]:
    by_type: dict[str, list[dict[str, Any]]] = {"single": [], "multiple": [], "judgement": []}
    for question in all_questions():
        if subject and question["subject"] != subject:
            continue
        if difficulty and question["difficulty"] != difficulty:
            continue
        by_type[question["type"]].append(question)
    if sum(counts.values()) <= 0:
        raise HTTPException(400, "组卷题量必须大于 0")
    for q_type, count in counts.items():
        if len(by_type[q_type]) < count:
            raise HTTPException(400, f"{QUESTION_TYPE_LABELS[q_type]}题量不足，当前仅有{len(by_type[q_type])}题")

    rng = random.Random(secrets.randbits(64))
    selected: list[dict[str, Any]] = []
    for q_type in ("single", "multiple", "judgement"):
        if counts[q_type] > 0:
            selected.extend(rng.sample(by_type[q_type], counts[q_type]))

    session_id = secrets.token_urlsafe(12)
    with db() as conn:
        for position, question in enumerate(selected, start=1):
            conn.execute(
                """
                INSERT INTO random_sessions(session_id, user_id, question_id, position, selected_answer, submitted_at)
                VALUES (?, ?, ?, ?, NULL, NULL)
                """,
                (session_id, user_id, question["id"], position),
            )
        conn.commit()
    return {
        "session_id": session_id,
        "counts": counts,
        "total": len(selected),
        "questions": [public_question(question) | {"position": i} for i, question in enumerate(selected, start=1)],
    }


def create_session_from_question_pool(
    user_id: int,
    pool: list[dict[str, Any]],
    limit: int,
) -> dict[str, Any]:
    unique: dict[str, dict[str, Any]] = {question["id"]: question for question in pool}
    questions = list(unique.values())
    if not questions:
        raise HTTPException(400, "暂无可推荐题目")
    rng = random.Random(secrets.randbits(64))
    selected = rng.sample(questions, min(limit, len(questions)))
    selected.sort(key=lambda question: ({"single": 0, "multiple": 1, "judgement": 2}[question["type"]], question["id"]))
    counts = {"single": 0, "multiple": 0, "judgement": 0}
    session_id = secrets.token_urlsafe(12)
    with db() as conn:
        for position, question in enumerate(selected, start=1):
            counts[question["type"]] += 1
            conn.execute(
                """
                INSERT INTO random_sessions(session_id, user_id, question_id, position, selected_answer, submitted_at)
                VALUES (?, ?, ?, ?, NULL, NULL)
                """,
                (session_id, user_id, question["id"], position),
            )
        conn.commit()
    return {
        "session_id": session_id,
        "counts": counts,
        "total": len(selected),
        "questions": [public_question(question) | {"position": i} for i, question in enumerate(selected, start=1)],
    }


def question_matches_filters(
    question: dict[str, Any],
    question_type: str | None = None,
    subject: str | None = None,
    difficulty: str | None = None,
    keyword: str | None = None,
) -> bool:
    if question_type and question["type"] != question_type:
        return False
    if subject and question["subject"] != subject:
        return False
    if difficulty and question["difficulty"] != difficulty:
        return False
    if keyword and keyword.strip():
        needle = keyword.strip().lower()
        haystack = "\n".join(
            [
                question["question"],
                question["section"],
                question["knowledge_point"],
                question.get("source_excerpt", ""),
            ]
        ).lower()
        if needle not in haystack:
            return False
    return True


def normalize_selected(question: dict[str, Any], selected: list[str] | str) -> list[str]:
    if isinstance(selected, str):
        raw = [selected]
    else:
        raw = selected
    clean = []
    valid = {"A", "B", "C", "D", "E"}
    for item in raw:
        letter = str(item).strip().upper()
        if letter in valid and letter not in clean:
            clean.append(letter)
    if question["type"] == "multiple":
        return sorted(clean)
    return clean[:1]


def answer_letters(question: dict[str, Any]) -> list[str]:
    return sorted(list(question["answer"])) if question["type"] == "multiple" else [question["answer"]]


def is_correct(question: dict[str, Any], selected: list[str]) -> bool:
    return sorted(selected) == answer_letters(question)


def record_answer(
    conn: sqlite3.Connection,
    user_id: int,
    mode: str,
    question: dict[str, Any],
    selected: list[str],
    session_id: str | None = None,
) -> None:
    correct = is_correct(question, selected)
    conn.execute(
        """
        INSERT INTO answer_records(
            user_id,
            mode,
            session_id,
            question_id,
            question_type,
            subject,
            section,
            selected_answer,
            correct,
            answered_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            mode,
            session_id,
            question["id"],
            question["type"],
            question["subject"],
            question["section"],
            json.dumps(selected, ensure_ascii=False),
            1 if correct else 0,
            utc_now(),
        ),
    )
    if not correct:
        conn.execute(
            "DELETE FROM question_mastery WHERE user_id = ? AND question_id = ?",
            (user_id, question["id"]),
        )


def public_question(question: dict[str, Any]) -> dict[str, Any]:
    options = [
        {"letter": "A", "text": question["option_a"]},
        {"letter": "B", "text": question["option_b"]},
    ]
    if question["option_c"]:
        options.append({"letter": "C", "text": question["option_c"]})
    if question["option_d"]:
        options.append({"letter": "D", "text": question["option_d"]})
    if question["option_e"]:
        options.append({"letter": "E", "text": question["option_e"]})
    return {
        "id": question["id"],
        "subject": question["subject"],
        "section": question["section"],
        "type": question["type"],
        "type_label": question["type_label"],
        "difficulty": question["difficulty"],
        "style_tag": question.get("style_tag", "正向辨析"),
        "question": question["question"],
        "options": options,
        "knowledge_point": question["knowledge_point"],
    }


def result_payload(question: dict[str, Any], selected: list[str], position: int | None = None) -> dict[str, Any]:
    payload = public_question(question)
    payload.update(
        {
            "position": position,
            "selected": selected,
            "answer": answer_letters(question),
            "answer_text": question["answer_text"],
            "correct": is_correct(question, selected),
            "explanation": question["explanation"],
            "source": {
                "file": question["source_file"],
                "page": question["source_page"],
                "excerpt": question["source_excerpt"],
            },
        }
    )
    return payload


def admin_question_payload(question: dict[str, Any], position: int | None = None) -> dict[str, Any]:
    payload = public_question(question)
    payload.update(
        {
            "position": position or question_position(question["id"], include_inactive=True),
            "is_active": bool(question.get("is_active", True)),
            "origin": question.get("origin", "base"),
            "answer": answer_letters(question),
            "answer_text": question["answer_text"],
            "explanation": question["explanation"],
            "source": {
                "file": question["source_file"],
                "page": question["source_page"],
                "excerpt": question["source_excerpt"],
            },
        }
    )
    return payload


def sequential_question_payload(position: int, user_id: int) -> dict[str, Any]:
    current_questions = all_questions()
    if position < 1 or position > len(current_questions):
        raise HTTPException(404, "题号不存在")
    question = current_questions[position - 1]
    with db() as conn:
        row = conn.execute(
            "SELECT selected_answer FROM practiced_questions WHERE user_id = ? AND question_id = ?",
            (user_id, question["id"]),
        ).fetchone()
    if row:
        selected = json.loads(row["selected_answer"]) if row["selected_answer"] else []
        return result_payload(question, selected, position) | {"practiced": True}
    return public_question(question) | {"position": position, "practiced": False}


app = FastAPI(title="🃏 小王刷题")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.post("/api/auth/register")
def register(payload: RegisterPayload) -> dict[str, Any]:
    username = validate_username(payload.username)
    with db() as conn:
        if get_user_by_username(conn, username) is not None:
            raise HTTPException(409, "用户名已存在")
        user = create_user(conn, username, payload.password, display_name=payload.display_name)
        token, expires_at = issue_session(conn, user["id"])
        conn.commit()
    return {"token": token, "expires_at": expires_at, "user": user_payload(user)}


@app.post("/api/auth/login")
def login(payload: LoginPayload) -> dict[str, Any]:
    with db() as conn:
        user = get_user_by_username(conn, payload.username)
        if user is None or not user["is_active"] or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(401, "用户名或密码错误")
        token, expires_at = issue_session(conn, user["id"])
        conn.commit()
    return {"token": token, "expires_at": expires_at, "user": user_payload(user)}


@app.post("/api/auth/logout")
def logout(
    authorization: str | None = Header(default=None),
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    token = _authorization_token(authorization)
    if token:
        with db() as conn:
            conn.execute(
                "DELETE FROM user_sessions WHERE token_hash = ? AND user_id = ?",
                (token_hash(token), user["id"]),
            )
            conn.commit()
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": user_payload(user)}


@app.get("/api/stats")
def stats(user: sqlite3.Row | None = Depends(get_optional_user)) -> dict[str, Any]:
    current_questions = all_questions()
    type_counts: dict[str, int] = {}
    subject_counts: dict[str, int] = {}
    style_counts: dict[str, int] = {}
    for question in current_questions:
        type_counts[question["type"]] = type_counts.get(question["type"], 0) + 1
        subject_counts[question["subject"]] = subject_counts.get(question["subject"], 0) + 1
        style_tag = question.get("style_tag", "正向辨析")
        style_counts[style_tag] = style_counts.get(style_tag, 0) + 1
    with db() as conn:
        practiced = (
            conn.execute(
                "SELECT COUNT(*) FROM practiced_questions WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0]
            if user
            else 0
        )
    return {
        "total": len(current_questions),
        "type_counts": type_counts,
        "subject_counts": subject_counts,
        "style_counts": style_counts,
        "sequential": {"practiced": practiced, "remaining": len(current_questions) - practiced},
    }


@app.post("/api/random/start")
def start_random(
    single: int = Query(default=2, ge=1, le=200),
    multiple: int = Query(default=1, ge=1, le=200),
    judgement: int = Query(default=1, ge=1, le=200),
    difficulty: str | None = Query(default=None, max_length=40),
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    requested = {"single": single, "multiple": multiple, "judgement": judgement}
    normalized_difficulty = difficulty.strip() if difficulty else None
    return create_random_session_for_rule(user["id"], requested, difficulty=normalized_difficulty)


@app.post("/api/random/{session_id}/answer")
def save_random_answer(
    session_id: str,
    payload: AnswerPayload,
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    question = question_by_id(payload.question_id)
    if not question:
        raise HTTPException(404, "题目不存在")
    selected = normalize_selected(question, payload.selected)
    with db() as conn:
        row = conn.execute(
            """
            SELECT position, selected_answer, submitted_at
            FROM random_sessions
            WHERE session_id = ? AND question_id = ? AND user_id = ?
            """,
            (session_id, payload.question_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "该题不属于当前随机练习")
        if row["submitted_at"]:
            raise HTTPException(400, "该随机练习已交卷，不能再修改答案")
        conn.execute(
            """
            UPDATE random_sessions
            SET selected_answer = ?
            WHERE session_id = ? AND question_id = ? AND user_id = ?
            """,
            (
                json.dumps(selected, ensure_ascii=False) if selected else None,
                session_id,
                payload.question_id,
                user["id"],
            ),
        )
        conn.commit()
    return {"ok": True, "question_id": payload.question_id, "selected": selected, "answered": bool(selected)}


@app.post("/api/random/{session_id}/finish")
def finish_random(session_id: str, user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT question_id, position, selected_answer, submitted_at
            FROM random_sessions
            WHERE session_id = ? AND user_id = ?
            ORDER BY position
            """,
            (session_id, user["id"]),
        ).fetchall()
        if not rows:
            raise HTTPException(404, "随机练习不存在")

        results = []
        score = 0
        missing_positions: list[int] = []
        now = utc_now()
        summary_by_type: dict[str, dict[str, Any]] = {
            q_type: {"type": q_type, "type_label": label, "total": 0, "correct": 0}
            for q_type, label in QUESTION_TYPE_LABELS.items()
        }
        for row in rows:
            question = question_by_id(row["question_id"], include_inactive=True)
            if question is None:
                continue
            selected = json.loads(row["selected_answer"]) if row["selected_answer"] else []
            if not selected:
                missing_positions.append(row["position"])
            result = result_payload(question, selected, row["position"])
            is_right = 1 if result["correct"] else 0
            score += is_right
            summary_by_type[question["type"]]["total"] += 1
            summary_by_type[question["type"]]["correct"] += is_right
            results.append(result)
            if not row["submitted_at"]:
                record_answer(conn, user["id"], "random", question, selected, session_id=session_id)
        conn.execute(
            """
            UPDATE random_sessions
            SET submitted_at = COALESCE(submitted_at, ?)
            WHERE session_id = ? AND user_id = ?
            """,
            (now, session_id, user["id"]),
        )
        conn.commit()
    return {
        "session_id": session_id,
        "total": len(results),
        "score": score,
        "missing_count": len(missing_positions),
        "missing_positions": missing_positions,
        "summary_by_type": [item for item in summary_by_type.values() if item["total"]],
        "results": results,
    }


@app.get("/api/random/active")
def active_random_session(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        session_row = conn.execute(
            """
            SELECT session_id, MAX(rowid) AS latest_rowid
            FROM random_sessions
            WHERE user_id = ?
            GROUP BY session_id
            HAVING SUM(CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END) > 0
            ORDER BY latest_rowid DESC
            LIMIT 1
            """,
            (user["id"],),
        ).fetchone()
        if session_row is None:
            return {"active": False}
        rows = conn.execute(
            """
            SELECT question_id, position, selected_answer, submitted_at
            FROM random_sessions
            WHERE user_id = ? AND session_id = ?
            ORDER BY position
            """,
            (user["id"], session_row["session_id"]),
        ).fetchall()
    questions = []
    selected_answers: dict[str, list[str]] = {}
    answered: dict[str, bool] = {}
    submitted: dict[str, bool] = {}
    counts = {"single": 0, "multiple": 0, "judgement": 0}
    next_unanswered_position: int | None = None
    for row in rows:
        question = question_by_id(row["question_id"], include_inactive=True)
        if question is None:
            continue
        counts[question["type"]] += 1
        questions.append(public_question(question) | {"position": row["position"]})
        if row["selected_answer"]:
            selected_answers[row["question_id"]] = json.loads(row["selected_answer"])
            answered[row["question_id"]] = True
        elif next_unanswered_position is None:
            next_unanswered_position = row["position"]
        if row["submitted_at"]:
            submitted[row["question_id"]] = True
    return {
        "active": True,
        "session_id": session_row["session_id"],
        "counts": counts,
        "total": len(questions),
        "questions": questions,
        "selected_answers": selected_answers,
        "answered": answered,
        "answered_count": len(answered),
        "submitted": submitted,
        "submitted_count": len(submitted),
        "next_unanswered_position": next_unanswered_position,
        "next_unsubmitted_position": next_unanswered_position,
    }


@app.get("/api/practice-sets")
def list_published_practice_sets(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM practice_sets
            WHERE is_published = 1
            ORDER BY id DESC
            """
        ).fetchall()
    return {"items": [practice_set_payload(row) for row in rows]}


@app.post("/api/practice-sets/{practice_set_id}/start")
def start_practice_set(
    practice_set_id: int,
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM practice_sets WHERE id = ? AND is_published = 1",
            (practice_set_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "练习配置不存在或未发布")
    counts = {
        "single": row["single_count"],
        "multiple": row["multiple_count"],
        "judgement": row["judgement_count"],
    }
    payload = create_random_session_for_rule(user["id"], counts, row["subject"], row["difficulty"])
    payload["practice_set"] = practice_set_payload(row)
    return payload


@app.get("/api/sequential/progress")
def sequential_progress(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    current_questions = all_questions()
    with db() as conn:
        practiced_rows = conn.execute(
            "SELECT question_id FROM practiced_questions WHERE user_id = ?",
            (user["id"],),
        ).fetchall()
    practiced = {row["question_id"] for row in practiced_rows}
    return {
        "total": len(current_questions),
        "practiced": len(practiced),
        "remaining": len(current_questions) - len(practiced),
        "next_id": next((question["id"] for question in current_questions if question["id"] not in practiced), None),
        "next_position": next(
            (index for index, question in enumerate(current_questions, start=1) if question["id"] not in practiced),
            None,
        ),
    }


@app.get("/api/sequential/next")
def sequential_next(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    current_questions = all_questions()
    with db() as conn:
        practiced_rows = conn.execute(
            "SELECT question_id FROM practiced_questions WHERE user_id = ?",
            (user["id"],),
        ).fetchall()
    practiced = {row["question_id"] for row in practiced_rows}
    for index, question in enumerate(current_questions, start=1):
        if question["id"] not in practiced:
            return public_question(question) | {"position": index}
    return {"done": True, "message": "顺序刷题已全部完成"}


@app.get("/api/sequential/question/{position}")
def get_sequential_question(
    position: int,
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    return sequential_question_payload(position, user["id"])


@app.post("/api/sequential/{question_id}/answer")
def submit_sequential_answer(
    question_id: str,
    payload: SequentialAnswerPayload,
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    question = question_by_id(question_id)
    if not question:
        raise HTTPException(404, "题目不存在")
    selected = normalize_selected(question, payload.selected)
    if not selected:
        raise HTTPException(400, "请至少选择一个选项")
    with db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO practiced_questions(user_id, question_id, practiced_at, selected_answer)
            VALUES (?, ?, ?, ?)
            """,
            (
                user["id"],
                question_id,
                datetime.now(timezone.utc).isoformat(),
                json.dumps(selected, ensure_ascii=False),
            ),
        )
        record_answer(conn, user["id"], "sequential", question, selected)
        conn.commit()
    return result_payload(question, selected, question_position(question_id)) | {"practiced": True}


@app.post("/api/sequential/reset")
def reset_sequential(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        conn.execute("DELETE FROM practiced_questions WHERE user_id = ?", (user["id"],))
        conn.commit()
    return {"ok": True, "message": "顺序刷题记录已重置"}


@app.post("/api/me/learning/reset")
def reset_learning_data(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        counts = {
            "answer_records": conn.execute(
                "SELECT COUNT(*) FROM answer_records WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0],
            "favorites": conn.execute(
                "SELECT COUNT(*) FROM question_favorites WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0],
            "mastery": conn.execute(
                "SELECT COUNT(*) FROM question_mastery WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0],
            "sequential_records": conn.execute(
                "SELECT COUNT(*) FROM practiced_questions WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0],
            "random_session_rows": conn.execute(
                "SELECT COUNT(*) FROM random_sessions WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0],
        }
        conn.execute("DELETE FROM answer_records WHERE user_id = ?", (user["id"],))
        conn.execute("DELETE FROM question_favorites WHERE user_id = ?", (user["id"],))
        conn.execute("DELETE FROM question_mastery WHERE user_id = ?", (user["id"],))
        conn.execute("DELETE FROM practiced_questions WHERE user_id = ?", (user["id"],))
        conn.execute("DELETE FROM random_sessions WHERE user_id = ?", (user["id"],))
        conn.commit()
    return {"ok": True, "message": "学习中心数据已重置", "deleted": counts}


@app.get("/api/me/dashboard")
def learning_dashboard(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    current_total = len(all_questions())
    with db() as conn:
        totals = conn.execute(
            """
            SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
            FROM answer_records
            WHERE user_id = ?
            """,
            (user["id"],),
        ).fetchone()
        type_rows = conn.execute(
            """
            SELECT question_type, COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
            FROM answer_records
            WHERE user_id = ?
            GROUP BY question_type
            ORDER BY question_type
            """,
            (user["id"],),
        ).fetchall()
        subject_rows = conn.execute(
            """
            SELECT subject, COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
            FROM answer_records
            WHERE user_id = ?
            GROUP BY subject
            ORDER BY answered DESC
            """,
            (user["id"],),
        ).fetchall()
        recent_rows = conn.execute(
            """
            SELECT question_id, mode, question_type, subject, correct, answered_at
            FROM answer_records
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 8
            """,
            (user["id"],),
        ).fetchall()
        wrong_count = latest_wrong_count(conn, user["id"])
        favorite_count = conn.execute(
            "SELECT COUNT(*) FROM question_favorites WHERE user_id = ?",
            (user["id"],),
        ).fetchone()[0]
        practiced_count = conn.execute(
            "SELECT COUNT(*) FROM practiced_questions WHERE user_id = ?",
            (user["id"],),
        ).fetchone()[0]

    answered = totals["answered"]
    correct = totals["correct"]
    return {
        "answered": answered,
        "correct": correct,
        "accuracy": round(correct / answered, 4) if answered else 0,
        "wrong_count": wrong_count,
        "favorite_count": favorite_count,
        "sequential": {
            "practiced": practiced_count,
            "remaining": current_total - practiced_count,
            "total": current_total,
        },
        "by_type": [
            {
                "type": row["question_type"],
                "type_label": QUESTION_TYPE_LABELS.get(row["question_type"], row["question_type"]),
                "answered": row["answered"],
                "correct": row["correct"],
                "accuracy": round(row["correct"] / row["answered"], 4) if row["answered"] else 0,
            }
            for row in type_rows
        ],
        "by_subject": [
            {
                "subject": row["subject"],
                "answered": row["answered"],
                "correct": row["correct"],
                "accuracy": round(row["correct"] / row["answered"], 4) if row["answered"] else 0,
            }
            for row in subject_rows
        ],
        "recent": [
            {
                "question_id": row["question_id"],
                "question": (question_by_id(row["question_id"], include_inactive=True) or {}).get(
                    "question",
                    row["question_id"],
                ),
                "mode": row["mode"],
                "type": row["question_type"],
                "subject": row["subject"],
                "correct": bool(row["correct"]),
                "answered_at": row["answered_at"],
            }
            for row in recent_rows
        ],
    }


@app.get("/api/me/analytics")
def learning_analytics(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        section_rows = conn.execute(
            """
            SELECT subject, section, COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
            FROM answer_records
            WHERE user_id = ?
            GROUP BY subject, section
            HAVING answered >= 1
            ORDER BY (1.0 * correct / answered) ASC, answered DESC
            LIMIT 12
            """,
            (user["id"],),
        ).fetchall()
        knowledge_rows = conn.execute(
            """
            SELECT question_id, COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
            FROM answer_records
            WHERE user_id = ?
            GROUP BY question_id
            HAVING answered >= 1
            ORDER BY (1.0 * correct / answered) ASC, answered DESC
            LIMIT 80
            """,
            (user["id"],),
        ).fetchall()
        wrong_ids = [row["question_id"] for row in latest_wrong_records(conn, user["id"], limit=30)]
        favorite_ids = [
            row["question_id"]
            for row in conn.execute(
                "SELECT question_id FROM question_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
                (user["id"],),
            ).fetchall()
        ]

    weak_knowledge: dict[str, dict[str, Any]] = {}
    for row in knowledge_rows:
        question = question_by_id(row["question_id"], include_inactive=True)
        if question is None:
            continue
        key = question["knowledge_point"]
        bucket = weak_knowledge.setdefault(
            key,
            {
                "knowledge_point": key,
                "subject": question["subject"],
                "section": question["section"],
                "answered": 0,
                "correct": 0,
                "question_ids": [],
            },
        )
        bucket["answered"] += row["answered"]
        bucket["correct"] += row["correct"]
        bucket["question_ids"].append(row["question_id"])
    weak_points = []
    for item in weak_knowledge.values():
        accuracy = item["correct"] / item["answered"] if item["answered"] else 0
        weak_points.append(item | {"accuracy": round(accuracy, 4)})
    weak_points.sort(key=lambda item: (item["accuracy"], -item["answered"]))

    recommendations = []
    if wrong_ids:
        recommendations.append({"source": "wrong", "title": "错题复练", "count": len(wrong_ids), "reason": "优先重做最近答错的题"})
    if weak_points:
        recommendations.append(
            {
                "source": "weak",
                "title": "薄弱知识点专项",
                "count": min(30, sum(len(item["question_ids"]) for item in weak_points[:5])),
                "reason": "围绕正确率最低的知识点补强",
            }
        )
    if favorite_ids:
        recommendations.append({"source": "favorite", "title": "收藏题复习", "count": len(favorite_ids), "reason": "复习主动标记的重要题"})

    return {
        "weak_sections": [
            {
                "subject": row["subject"],
                "section": row["section"],
                "answered": row["answered"],
                "correct": row["correct"],
                "accuracy": round(row["correct"] / row["answered"], 4) if row["answered"] else 0,
            }
            for row in section_rows
        ],
        "weak_points": weak_points[:10],
        "recommendations": recommendations,
    }


@app.post("/api/me/recommendations/start")
def start_recommended_practice(
    source: str = Query(default="wrong"),
    limit: int = Query(default=20, ge=1, le=100),
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    current_by_id = {question["id"]: question for question in all_questions()}
    with db() as conn:
        if source == "wrong":
            ids = [row["question_id"] for row in latest_wrong_records(conn, user["id"], limit=limit)]
        elif source == "favorite":
            ids = [
                row["question_id"]
                for row in conn.execute(
                    "SELECT question_id FROM question_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                    (user["id"], limit),
                ).fetchall()
            ]
        elif source == "weak":
            rows = conn.execute(
                """
                SELECT question_id, COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
                FROM answer_records
                WHERE user_id = ?
                GROUP BY question_id
                ORDER BY (1.0 * correct / answered) ASC, answered DESC
                LIMIT ?
                """,
                (user["id"], limit),
            ).fetchall()
            ids = [row["question_id"] for row in rows]
        else:
            raise HTTPException(400, "推荐来源必须是 wrong、weak 或 favorite")
    pool = [current_by_id[question_id] for question_id in ids if question_id in current_by_id]
    payload = create_session_from_question_pool(user["id"], pool, limit)
    payload["recommendation"] = {"source": source}
    return payload


@app.get("/api/me/wrong-questions")
def wrong_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=5, le=100),
    question_type: str | None = Query(default=None, alias="type"),
    subject: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    with db() as conn:
        rows = latest_wrong_records(conn, user["id"])
        favorite_ids = {
            row["question_id"]
            for row in conn.execute(
                "SELECT question_id FROM question_favorites WHERE user_id = ?",
                (user["id"],),
            ).fetchall()
        }
    items = []
    for row in rows:
        question = question_by_id(row["question_id"], include_inactive=True)
        if question is None:
            continue
        if not question_matches_filters(question, question_type, subject, difficulty, keyword):
            continue
        selected = json.loads(row["selected_answer"])
        items.append(
            result_payload(question, selected, question_position(question["id"], include_inactive=True))
            | {"mode": row["mode"], "answered_at": row["answered_at"], "favorited": question["id"] in favorite_ids}
        )
    total = len(items)
    return {"page": page, "page_size": page_size, "total": total, "items": items[offset : offset + page_size]}


@app.get("/api/me/favorites")
def favorite_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=5, le=100),
    question_type: str | None = Query(default=None, alias="type"),
    subject: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    with db() as conn:
        rows = conn.execute(
            """
            SELECT question_id, created_at
            FROM question_favorites
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user["id"],),
        ).fetchall()
    items = []
    for row in rows:
        question = question_by_id(row["question_id"], include_inactive=True)
        if question is None:
            continue
        if not question_matches_filters(question, question_type, subject, difficulty, keyword):
            continue
        items.append(
            public_question(question)
            | {
                "position": question_position(question["id"], include_inactive=True),
                "favorited": True,
                "created_at": row["created_at"],
                "answer": answer_letters(question),
                "answer_text": question["answer_text"],
                "explanation": question["explanation"],
                "source": {
                    "file": question["source_file"],
                    "page": question["source_page"],
                    "excerpt": question["source_excerpt"],
                },
            }
        )
    total = len(items)
    return {"page": page, "page_size": page_size, "total": total, "items": items[offset : offset + page_size]}


@app.post("/api/me/wrong-questions/{question_id}/mastery")
def mark_wrong_question_mastery(
    question_id: str,
    payload: MasteryPayload,
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, Any]:
    if question_by_id(question_id, include_inactive=True) is None:
        raise HTTPException(404, "题目不存在")
    with db() as conn:
        if payload.mastered:
            conn.execute(
                """
                INSERT OR REPLACE INTO question_mastery(user_id, question_id, mastered_at)
                VALUES (?, ?, ?)
                """,
                (user["id"], question_id, utc_now()),
            )
        else:
            conn.execute(
                "DELETE FROM question_mastery WHERE user_id = ? AND question_id = ?",
                (user["id"], question_id),
            )
        conn.commit()
    return {"ok": True, "question_id": question_id, "mastered": payload.mastered}


@app.post("/api/me/favorites/{question_id}")
def add_favorite(question_id: str, user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    if question_by_id(question_id, include_inactive=True) is None:
        raise HTTPException(404, "题目不存在")
    with db() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO question_favorites(user_id, question_id, created_at)
            VALUES (?, ?, ?)
            """,
            (user["id"], question_id, utc_now()),
        )
        conn.commit()
    return {"ok": True, "question_id": question_id, "favorited": True}


@app.delete("/api/me/favorites/{question_id}")
def remove_favorite(question_id: str, user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    with db() as conn:
        conn.execute(
            "DELETE FROM question_favorites WHERE user_id = ? AND question_id = ?",
            (user["id"], question_id),
        )
        conn.commit()
    return {"ok": True, "question_id": question_id, "favorited": False}


@app.get("/api/admin/summary")
def admin_summary(admin: sqlite3.Row = Depends(require_admin)) -> dict[str, Any]:
    current_questions = all_questions()
    inactive_total = len(all_questions(include_inactive=True)) - len(current_questions)
    type_counts: dict[str, int] = {}
    subject_counts: dict[str, int] = {}
    for question in current_questions:
        type_counts[question["type"]] = type_counts.get(question["type"], 0) + 1
        subject_counts[question["subject"]] = subject_counts.get(question["subject"], 0) + 1
    with db() as conn:
        users_total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        users_active = conn.execute("SELECT COUNT(*) FROM users WHERE is_active = 1").fetchone()[0]
        practiced_total = conn.execute("SELECT COUNT(*) FROM practiced_questions").fetchone()[0]
        random_session_total = conn.execute(
            "SELECT COUNT(DISTINCT session_id) FROM random_sessions"
        ).fetchone()[0]
        random_answer_total = conn.execute(
            "SELECT COUNT(*) FROM random_sessions WHERE submitted_at IS NOT NULL"
        ).fetchone()[0]
    return {
        "question_total": len(current_questions),
        "inactive_question_total": inactive_total,
        "type_counts": type_counts,
        "subject_counts": subject_counts,
        "users": {"total": users_total, "active": users_active},
        "practice": {
            "sequential_records": practiced_total,
            "random_sessions": random_session_total,
            "random_answers": random_answer_total,
        },
        "admin": user_payload(admin),
    }


@app.get("/api/admin/users")
def admin_users(admin: sqlite3.Row = Depends(require_admin)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT
                users.id,
                users.username,
                users.display_name,
                users.role,
                users.is_active,
                users.created_at,
                COUNT(DISTINCT practiced_questions.question_id) AS practiced_count,
                MAX(user_sessions.last_seen_at) AS last_seen_at
            FROM users
            LEFT JOIN practiced_questions ON practiced_questions.user_id = users.id
            LEFT JOIN user_sessions ON user_sessions.user_id = users.id
            GROUP BY users.id
            ORDER BY users.id
            """
        ).fetchall()
    return {
        "items": [
            {
                "id": row["id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "role": row["role"],
                "is_active": bool(row["is_active"]),
                "created_at": row["created_at"],
                "last_seen_at": row["last_seen_at"],
                "practiced_count": row["practiced_count"],
            }
            for row in rows
        ]
    }


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(
    user_id: int,
    payload: AdminUserUpdatePayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "用户不存在")
        if payload.role is not None and payload.role not in {"user", "admin"}:
            raise HTTPException(400, "角色必须是 user 或 admin")
        if user_id == admin["id"] and payload.is_active is False:
            raise HTTPException(400, "不能停用当前登录的管理员账号")
        next_display_name = payload.display_name.strip() if payload.display_name else row["display_name"]
        next_role = payload.role if payload.role is not None else row["role"]
        next_active = row["is_active"] if payload.is_active is None else (1 if payload.is_active else 0)
        conn.execute(
            """
            UPDATE users
            SET display_name = ?, role = ?, is_active = ?
            WHERE id = ?
            """,
            (next_display_name, next_role, next_active, user_id),
        )
        if not next_active:
            conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
        save_admin_audit(
            conn,
            admin["id"],
            "update_user",
            "user",
            user_id,
            {"display_name": next_display_name, "role": next_role, "is_active": bool(next_active)},
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        conn.commit()
    return {"user": user_payload(updated)}


@app.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_user_password(
    user_id: int,
    payload: PasswordResetPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "用户不存在")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(payload.password), user_id),
        )
        conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
        save_admin_audit(conn, admin["id"], "reset_password", "user", user_id)
        conn.commit()
    return {"ok": True, "user_id": user_id}


@app.get("/api/admin/audit-logs")
def admin_audit_logs(
    limit: int = Query(default=80, ge=1, le=200),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    with db() as conn:
        admin_rows = conn.execute(
            """
            SELECT
                admin_audit_logs.id,
                admin_audit_logs.action,
                admin_audit_logs.target_type,
                admin_audit_logs.target_id,
                admin_audit_logs.created_at,
                admin_audit_logs.detail,
                users.username AS actor_username
            FROM admin_audit_logs
            LEFT JOIN users ON users.id = admin_audit_logs.actor_user_id
            ORDER BY admin_audit_logs.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        question_rows = conn.execute(
            """
            SELECT
                question_audit_logs.id,
                question_audit_logs.question_id,
                question_audit_logs.action,
                question_audit_logs.created_at,
                question_audit_logs.payload,
                users.username AS actor_username
            FROM question_audit_logs
            LEFT JOIN users ON users.id = question_audit_logs.actor_user_id
            ORDER BY question_audit_logs.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    items = [
        {
            "id": f"admin-{row['id']}",
            "action": row["action"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "actor_username": row["actor_username"] or "-",
            "created_at": row["created_at"],
            "detail": json.loads(row["detail"]) if row["detail"] else None,
        }
        for row in admin_rows
    ]
    items.extend(
        {
            "id": f"question-{row['id']}",
            "action": row["action"],
            "target_type": "question",
            "target_id": row["question_id"],
            "actor_username": row["actor_username"] or "-",
            "created_at": row["created_at"],
            "detail": json.loads(row["payload"]) if row["payload"] else None,
        }
        for row in question_rows
    )
    if action:
        items = [item for item in items if item["action"] == action]
    if target_type:
        items = [item for item in items if item["target_type"] == target_type]
    if actor and actor.strip():
        needle = actor.strip().lower()
        items = [item for item in items if needle in item["actor_username"].lower()]
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return {"items": items[:limit]}


@app.get("/api/admin/practice-sets")
def admin_practice_sets(admin: sqlite3.Row = Depends(require_admin)) -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM practice_sets ORDER BY id DESC").fetchall()
    return {"items": [practice_set_payload(row) for row in rows]}


@app.get("/api/admin/practice-sets/availability")
def admin_practice_set_availability(
    subject: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    counts = {"single": 0, "multiple": 0, "judgement": 0}
    normalized_subject = subject.strip() if subject else None
    normalized_difficulty = difficulty.strip() if difficulty else None
    for question in all_questions():
        if normalized_subject and question["subject"] != normalized_subject:
            continue
        if normalized_difficulty and question["difficulty"] != normalized_difficulty:
            continue
        counts[question["type"]] += 1
    return {"subject": normalized_subject, "difficulty": normalized_difficulty, "counts": counts}


@app.post("/api/admin/practice-sets")
def admin_create_practice_set(
    payload: PracticeSetPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    counts_total = payload.single_count + payload.multiple_count + payload.judgement_count
    if counts_total <= 0:
        raise HTTPException(400, "练习配置题量必须大于 0")
    now = utc_now()
    with db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO practice_sets(
                name,
                description,
                single_count,
                multiple_count,
                judgement_count,
                subject,
                difficulty,
                is_published,
                created_at,
                updated_at,
                created_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name.strip(),
                payload.description.strip(),
                payload.single_count,
                payload.multiple_count,
                payload.judgement_count,
                payload.subject.strip() if payload.subject else None,
                payload.difficulty.strip() if payload.difficulty else None,
                1 if payload.is_published else 0,
                now,
                now,
                admin["id"],
            ),
        )
        row = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (cursor.lastrowid,)).fetchone()
        save_admin_audit(conn, admin["id"], "create_practice_set", "practice_set", cursor.lastrowid, payload.model_dump())
        conn.commit()
    return practice_set_payload(row)


@app.put("/api/admin/practice-sets/{practice_set_id}")
def admin_update_practice_set(
    practice_set_id: int,
    payload: PracticeSetPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    counts_total = payload.single_count + payload.multiple_count + payload.judgement_count
    if counts_total <= 0:
        raise HTTPException(400, "练习配置题量必须大于 0")
    with db() as conn:
        row = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (practice_set_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "练习配置不存在")
        conn.execute(
            """
            UPDATE practice_sets
            SET name = ?,
                description = ?,
                single_count = ?,
                multiple_count = ?,
                judgement_count = ?,
                subject = ?,
                difficulty = ?,
                is_published = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                payload.name.strip(),
                payload.description.strip(),
                payload.single_count,
                payload.multiple_count,
                payload.judgement_count,
                payload.subject.strip() if payload.subject else None,
                payload.difficulty.strip() if payload.difficulty else None,
                1 if payload.is_published else 0,
                utc_now(),
                practice_set_id,
            ),
        )
        updated = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (practice_set_id,)).fetchone()
        save_admin_audit(conn, admin["id"], "update_practice_set", "practice_set", practice_set_id, payload.model_dump())
        conn.commit()
    return practice_set_payload(updated)


@app.patch("/api/admin/practice-sets/{practice_set_id}/status")
def admin_update_practice_set_status(
    practice_set_id: int,
    payload: PracticeSetStatusPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (practice_set_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "练习配置不存在")
        conn.execute(
            "UPDATE practice_sets SET is_published = ?, updated_at = ? WHERE id = ?",
            (1 if payload.is_published else 0, utc_now(), practice_set_id),
        )
        updated = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (practice_set_id,)).fetchone()
        save_admin_audit(
            conn,
            admin["id"],
            "publish_practice_set" if payload.is_published else "unpublish_practice_set",
            "practice_set",
            practice_set_id,
            {"is_published": payload.is_published},
        )
        conn.commit()
    return practice_set_payload(updated)


@app.get("/api/admin/questions")
def admin_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=5, le=100),
    question_type: str | None = Query(default=None, alias="type"),
    subject: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    origin: str | None = Query(default=None),
    status: str | None = Query(default=None),
    knowledge_point: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    filtered = all_questions(include_inactive=include_inactive)
    if question_type:
        filtered = [question for question in filtered if question["type"] == question_type]
    if subject:
        filtered = [question for question in filtered if question["subject"] == subject]
    if difficulty:
        filtered = [question for question in filtered if question["difficulty"] == difficulty]
    if origin in {"base", "custom"}:
        filtered = [question for question in filtered if question.get("origin") == origin]
    if status == "active":
        filtered = [question for question in filtered if question.get("is_active")]
    if status == "inactive":
        filtered = [question for question in filtered if not question.get("is_active")]
    if knowledge_point and knowledge_point.strip():
        needle = knowledge_point.strip().lower()
        filtered = [question for question in filtered if needle in question["knowledge_point"].lower()]
    if keyword and keyword.strip():
        needle = keyword.strip().lower()
        filtered = [
            question
            for question in filtered
            if needle
            in "\n".join(
                [
                    question["question"],
                    question["section"],
                    question["knowledge_point"],
                    question["source_excerpt"],
                ]
            ).lower()
        ]
    total = len(filtered)
    start = (page - 1) * page_size
    page_items = filtered[start : start + page_size]
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [admin_question_payload(question) for question in page_items],
    }


@app.get("/api/admin/questions/{question_id}")
def admin_question_detail(
    question_id: str,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    question = question_by_id(question_id, include_inactive=True)
    if question is None:
        raise HTTPException(404, "题目不存在")
    return admin_question_payload(question)


@app.post("/api/admin/questions")
def admin_create_question(
    payload: QuestionUpsertPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    with db() as conn:
        question_id = next_custom_question_id(conn)
        question = build_question_payload(payload, question_id)
        now = utc_now()
        conn.execute(
            """
            INSERT INTO managed_questions(question_id, payload, is_active, origin, created_at, updated_at, updated_by)
            VALUES (?, ?, 1, 'custom', ?, ?, ?)
            """,
            (question_id, json.dumps(question, ensure_ascii=False), now, now, admin["id"]),
        )
        save_question_audit(conn, question_id, "create", admin["id"], question)
        save_admin_audit(conn, admin["id"], "create_question", "question", question_id)
        conn.commit()
    return admin_question_payload(question | {"origin": "custom", "is_active": True})


@app.put("/api/admin/questions/{question_id}")
def admin_update_question(
    question_id: str,
    payload: QuestionUpsertPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    existing = question_by_id(question_id, include_inactive=True)
    if existing is None:
        raise HTTPException(404, "题目不存在")
    origin = "base" if question_id in BASE_QUESTION_IDS else "custom"
    question = build_question_payload(payload, question_id)
    now = utc_now()
    with db() as conn:
        row = conn.execute(
            "SELECT created_at, is_active FROM managed_questions WHERE question_id = ?",
            (question_id,),
        ).fetchone()
        created_at = row["created_at"] if row else now
        is_active = row["is_active"] if row else 1
        conn.execute(
            """
            INSERT INTO managed_questions(question_id, payload, is_active, origin, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(question_id) DO UPDATE SET
                payload = excluded.payload,
                is_active = excluded.is_active,
                origin = excluded.origin,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (
                question_id,
                json.dumps(question, ensure_ascii=False),
                is_active,
                origin,
                created_at,
                now,
                admin["id"],
            ),
        )
        save_question_audit(conn, question_id, "update", admin["id"], question)
        save_admin_audit(conn, admin["id"], "update_question", "question", question_id)
        conn.commit()
    return admin_question_payload(question | {"origin": origin, "is_active": bool(is_active)})


@app.patch("/api/admin/questions/{question_id}/status")
def admin_update_question_status(
    question_id: str,
    payload: QuestionStatusPayload,
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    existing = question_by_id(question_id, include_inactive=True)
    if existing is None:
        raise HTTPException(404, "题目不存在")
    origin = "base" if question_id in BASE_QUESTION_IDS else "custom"
    question = existing | {"id": question_id}
    now = utc_now()
    with db() as conn:
        row = conn.execute(
            "SELECT created_at FROM managed_questions WHERE question_id = ?",
            (question_id,),
        ).fetchone()
        created_at = row["created_at"] if row else now
        conn.execute(
            """
            INSERT INTO managed_questions(question_id, payload, is_active, origin, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(question_id) DO UPDATE SET
                is_active = excluded.is_active,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (
                question_id,
                json.dumps(question, ensure_ascii=False),
                1 if payload.is_active else 0,
                origin,
                created_at,
                now,
                admin["id"],
            ),
        )
        save_question_audit(
            conn,
            question_id,
            "activate" if payload.is_active else "deactivate",
            admin["id"],
            {"is_active": payload.is_active},
        )
        save_admin_audit(
            conn,
            admin["id"],
            "activate_question" if payload.is_active else "deactivate_question",
            "question",
            question_id,
            {"is_active": payload.is_active},
        )
        conn.commit()
    return admin_question_payload(question | {"is_active": payload.is_active, "origin": origin})


@app.get("/api/admin/questions-export")
def admin_export_questions(
    include_inactive: bool = Query(default=False),
    admin: sqlite3.Row = Depends(require_admin),
) -> dict[str, Any]:
    items = [admin_question_payload(question) for question in all_questions(include_inactive=include_inactive)]
    return {"total": len(items), "items": items}
