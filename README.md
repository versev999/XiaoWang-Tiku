# Xiao Wang Practice

Xiao Wang Practice is a local React + FastAPI question practice app. It provides account login, random practice, sequential practice, answer review, favorites, wrong-question review, learning analytics, and an admin panel for maintaining questions and practice sets.

This public repository contains only the practice tool. It does not include any private or exam-specific question bank. A small demo question bank is provided at `data/question_bank.sample.json` so the app can run after cloning.

## Features

- Account system: register, login, logout, session token, user/admin roles.
- Practice modes: random practice, difficulty filter, sequential practice, previous/next navigation, jump to question, draft persistence, and final scoring.
- Learning center: dashboard, wrong questions, favorites, weak areas, recent answer history, and reset learning data.
- Admin panel: user management, question filtering, question create/edit/disable, practice set configuration, and audit logs.
- Local operations: SQLite runtime data, local backup/restore script, and one-command production start script.

## Data Policy

Private question banks are intentionally ignored by Git:

- `data/question_bank.json`
- `data/question_bank.csv`
- `data/*.xlsx`
- `data/app_state.sqlite`
- `data/backups/`

To use your own question bank, place it at `data/question_bank.json`. If that file is missing, the backend falls back to the public demo file `data/question_bank.sample.json`.

## Local Setup

```powershell
cd D:\Projects\research\xiaowang-practice-public
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
cd .\frontend
npm install
npm run build
cd ..
powershell -ExecutionPolicy Bypass -File .\scripts\start_local.ps1
```

Open:

```text
http://127.0.0.1:8001/
```

Default accounts:

```text
admin / admin123456
demo / demo123456
```

Change default passwords before real use.

## Development Checks

```powershell
node .\scripts\check_random_selection_logic.mjs
node .\scripts\check_admin_question_validation.mjs
node .\scripts\check_admin_v04_structure.mjs
node .\scripts\check_learning_center_v05_structure.mjs
.\.venv\Scripts\python.exe -m py_compile .\backend\main.py .\backend\public_main.py .\scripts\backup_database.py
cd .\frontend
npm run build
```

## License

MIT
