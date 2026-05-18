from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "app_state.sqlite"
BACKUP_DIR = ROOT / "data" / "backups"


def backup() -> Path:
    if not DB_PATH.exists():
        raise SystemExit(f"database not found: {DB_PATH}")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"app_state_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sqlite"
    shutil.copy2(DB_PATH, target)
    return target


def restore(source: Path, confirm: bool) -> Path:
    source = source.resolve()
    if not source.exists():
        raise SystemExit(f"backup file not found: {source}")
    if source.suffix.lower() != ".sqlite":
        raise SystemExit("restore source must be a .sqlite file")
    if not confirm:
        raise SystemExit("restore requires --confirm-overwrite")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, DB_PATH)
    return DB_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup or restore the local quiz app SQLite database.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("backup")
    restore_parser = subparsers.add_parser("restore")
    restore_parser.add_argument("source", type=Path)
    restore_parser.add_argument("--confirm-overwrite", action="store_true")
    args = parser.parse_args()

    if args.command == "backup":
        print(backup())
    elif args.command == "restore":
        print(restore(args.source, args.confirm_overwrite))


if __name__ == "__main__":
    main()
