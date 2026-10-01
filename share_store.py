"""Persistence for translations that users choose to share by link.

Only shared translations are stored (text in SQLite, spoken audio as MP3 files);
everything else the app processes stays in memory.
"""

import re
import secrets
import sqlite3
import threading
from collections.abc import Callable
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

SHARE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,32}$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    source_language TEXT,
    target_language TEXT NOT NULL,
    transcript TEXT NOT NULL,
    translation TEXT NOT NULL
)
"""


class ShareStore:
    def __init__(self, directory: Path):
        self._audio_dir = Path(directory) / "shares"
        self._audio_dir.mkdir(parents=True, exist_ok=True)
        self._db_path = Path(directory) / "shares.db"
        self._audio_locks: dict[str, threading.Lock] = {}
        self._audio_locks_guard = threading.Lock()
        with closing(self._connect()) as db:
            db.execute(_SCHEMA)
            db.commit()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._db_path)
        db.row_factory = sqlite3.Row
        return db

    def create(self, *, transcript: str, translation: str, source_language: str | None, target_language: str) -> dict:
        share = {
            "id": secrets.token_urlsafe(9),
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source_language": source_language,
            "target_language": target_language,
            "transcript": transcript,
            "translation": translation,
        }
        with closing(self._connect()) as db:
            db.execute(
                "INSERT INTO shares (id, created_at, source_language, target_language, transcript, translation) "
                "VALUES (:id, :created_at, :source_language, :target_language, :transcript, :translation)",
                share,
            )
            db.commit()
        return share

    def get(self, share_id: str) -> dict | None:
        if not SHARE_ID_PATTERN.match(share_id):
            return None
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
        return dict(row) if row else None

    def audio_path(self, share_id: str, generate: Callable[[], bytes]) -> Path:
        """Return the share's MP3, generating it on first request.

        `share_id` must come from `get()`, which validates it for use in a path.
        """
        path = self._audio_dir / f"{share_id}.mp3"
        if path.is_file():
            return path
        with self._audio_locks_guard:
            lock = self._audio_locks.setdefault(share_id, threading.Lock())
        with lock:  # concurrent first plays generate the audio only once
            if not path.is_file():
                partial = path.with_suffix(".partial")
                partial.write_bytes(generate())
                partial.replace(path)
        return path
