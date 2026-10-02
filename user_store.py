"""User accounts. People sign up themselves (username + password), sign in with an
external provider (Google, GitHub, ...), or are created by the admin from the CLI."""

import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from functools import cache
from pathlib import Path

from werkzeug.security import check_password_hash, generate_password_hash

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$")
USERNAME_RULES = "Usernames must be 3-32 characters: letters, numbers, '.', '_' or '-', starting with a letter or number."
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 256

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,  -- empty for accounts that only sign in with a provider
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS oauth_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,  -- the provider's permanent account id
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
);
"""


class UsernameTaken(ValueError):
    pass


@cache
def _dummy_hash() -> str:
    return generate_password_hash("timing-equaliser")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate_username(username: str) -> str:
    username = username.strip()
    if not USERNAME_PATTERN.match(username):
        raise ValueError(USERNAME_RULES)
    return username


def validate_password(password: str, username: str | None = None) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Passwords must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError(f"Passwords must be at most {MAX_PASSWORD_LENGTH} characters.")
    if username and password.strip().lower() == username.strip().lower():
        raise ValueError("Choose a password that isn't your username.")


def username_from_hint(hint: str) -> str:
    """A valid username derived from a provider login, name or email address."""
    local_part = hint.split("@")[0]
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "", local_part.replace(" ", ".")).lstrip("._-")[:32]
    return cleaned if len(cleaned) >= 3 else "user"


class UserStore:
    """Usernames are case-insensitive. `session_version` changes whenever a user's
    password changes, which invalidates every session issued before."""

    def __init__(self, directory: Path):
        Path(directory).mkdir(parents=True, exist_ok=True)
        self._db_path = Path(directory) / "users.db"
        with closing(self._connect()) as db:
            db.executescript(_SCHEMA)
            db.commit()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._db_path)
        db.row_factory = sqlite3.Row
        return db

    def count(self) -> int:
        with closing(self._connect()) as db:
            return db.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def create(self, username: str, password: str) -> dict:
        username = validate_username(username)
        validate_password(password, username)
        try:
            with closing(self._connect()) as db:
                db.execute(
                    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, generate_password_hash(password), _now()),
                )
                db.commit()
        except sqlite3.IntegrityError:
            raise UsernameTaken(f"The username '{username}' is already taken.") from None
        return self.find(username)

    def create_from_identity(self, provider: str, subject: str, username_hint: str, email: str | None) -> dict:
        """Create an account for a first-time provider sign-in, picking a free username."""
        base = username_from_hint(username_hint)
        for attempt in range(1, 100):
            suffix = "" if attempt == 1 else f"-{attempt}"
            candidate = base[: 32 - len(suffix)] + suffix
            try:
                with closing(self._connect()) as db:
                    cursor = db.execute(
                        "INSERT INTO users (username, password_hash, created_at) VALUES (?, '', ?)",
                        (candidate, _now()),
                    )
                    db.execute(
                        "INSERT INTO oauth_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)",
                        (provider, subject, cursor.lastrowid, email, _now()),
                    )
                    db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_now(), cursor.lastrowid))
                    db.commit()
                return self.get(cursor.lastrowid)
            except sqlite3.IntegrityError as err:
                if "oauth_identities" in str(err):  # created by a concurrent sign-in
                    return self.find_by_identity(provider, subject)
                # The username is taken; try the next suffix.
        raise RuntimeError("Could not find a free username.")

    def find(self, username: str) -> dict | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
        return dict(row) if row else None

    def find_by_identity(self, provider: str, subject: str) -> dict | None:
        with closing(self._connect()) as db:
            row = db.execute(
                "SELECT users.* FROM users JOIN oauth_identities ON oauth_identities.user_id = users.id "
                "WHERE oauth_identities.provider = ? AND oauth_identities.subject = ?",
                (provider, subject),
            ).fetchone()
        return dict(row) if row else None

    def get(self, user_id: int) -> dict | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def list(self) -> list[dict]:
        """Accounts with `providers`, a comma-separated list of linked sign-in providers."""
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT users.*, GROUP_CONCAT(oauth_identities.provider) AS providers FROM users "
                "LEFT JOIN oauth_identities ON oauth_identities.user_id = users.id "
                "GROUP BY users.id ORDER BY users.username"
            )
            return [dict(row) for row in rows]

    def record_login(self, user_id: int) -> None:
        with closing(self._connect()) as db:
            db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_now(), user_id))
            db.commit()

    def authenticate(self, username: str, password: str) -> dict | None:
        user = self.find(username) if len(password) <= MAX_PASSWORD_LENGTH else None
        if user is None or not user["password_hash"]:
            # Hash anyway so response times don't reveal which usernames exist
            # (or which accounts only sign in with a provider).
            check_password_hash(_dummy_hash(), password[:MAX_PASSWORD_LENGTH])
            return None
        if not check_password_hash(user["password_hash"], password):
            return None
        self.record_login(user["id"])
        return user

    def set_password(self, username: str, password: str) -> bool:
        """Change a password and sign the user out of every existing session."""
        validate_password(password, username)
        with closing(self._connect()) as db:
            cursor = db.execute(
                "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE username = ?",
                (generate_password_hash(password), username.strip()),
            )
            db.commit()
        return cursor.rowcount > 0

    def delete(self, username: str) -> bool:
        with closing(self._connect()) as db:
            row = db.execute("SELECT id FROM users WHERE username = ?", (username.strip(),)).fetchone()
            if row is None:
                return False
            db.execute("DELETE FROM oauth_identities WHERE user_id = ?", (row["id"],))
            db.execute("DELETE FROM users WHERE id = ?", (row["id"],))
            db.commit()
        return True
