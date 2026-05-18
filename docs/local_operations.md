# Local Operations

This project is designed to run locally. Public network exposure is intentionally not configured in the open-source version.

## Start

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_local.ps1
```

Default URL:

```text
http://127.0.0.1:8001/
```

## Default Accounts

```text
admin / admin123456
demo / demo123456
```

Change default passwords before real use.

## Runtime Data

Runtime data is written under `data/` and ignored by Git:

- `data/app_state.sqlite`
- `data/backups/`
- `data/*.log`

## Private Question Bank

Place your own private question bank at:

```text
data/question_bank.json
```

When that file is absent, the backend loads:

```text
data/question_bank.sample.json
```

## Backup

```powershell
.\.venv\Scripts\python.exe .\scripts\backup_database.py backup
```

## Restore

Restore overwrites the current local runtime database and requires explicit confirmation:

```powershell
.\.venv\Scripts\python.exe .\scripts\backup_database.py restore .\data\backups\app_state_YYYYMMDD_HHMMSS.sqlite --confirm-overwrite
```
