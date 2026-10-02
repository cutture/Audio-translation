import pytest

from app import create_app
from conftest import PASSWORD, create_user, run_cli, sign_in
from oauth_login import OAuthLogin
from user_store import UserStore

PROTECTED = [
    ("post", "/api/transcribe"),
    ("post", "/api/translate"),
    ("post", "/api/speech"),
    ("post", "/api/shares"),
]


# --- signing in and out ------------------------------------------------------

def test_session_describes_the_sign_in_options(anon_client):
    assert anon_client.get("/api/auth/me").get_json() == {
        "user": None, "signup_enabled": True, "providers": [], "setup_required": False,
    }


def test_setup_is_required_only_when_nobody_can_sign_up(service, tmp_path):
    app = create_app(service, data_dir=tmp_path, config={"ALLOW_SIGNUPS": False}, oauth_login=OAuthLogin(env={}))
    client = app.test_client()
    assert client.get("/api/auth/me").get_json()["setup_required"] is True

    create_user(app, "alice")

    assert client.get("/api/auth/me").get_json()["setup_required"] is False


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_openai_endpoints_require_sign_in(anon_client, service, method, path):
    res = getattr(anon_client, method)(path, json={"text": "hi", "language": "en", "target_language": "en"})

    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "unauthorized"
    assert service.calls == []


def test_public_pages_and_share_links_need_no_account(app, client, anon_client):
    share_id = client.post(
        "/api/shares", json={"transcript": "Hi", "translation": "नमस्ते", "target_language": "hi"}
    ).get_json()["id"]

    assert anon_client.get("/api/config").status_code == 200
    assert anon_client.get("/api/shares/" + share_id).status_code == 200
    audio = anon_client.get("/api/shares/" + share_id + "/audio")
    assert audio.status_code == 200
    audio.close()


def test_sign_in_then_out(app, anon_client):
    create_user(app, "alice")

    res = sign_in(anon_client, "Alice")  # usernames are case-insensitive

    assert res.status_code == 200
    assert res.get_json() == {"user": {"username": "alice"}}
    assert anon_client.get("/api/auth/me").get_json()["user"] == {"username": "alice"}
    assert anon_client.post("/api/translate", json={"text": "hi", "target_language": "fr"}).status_code == 200

    assert anon_client.post("/api/auth/logout").status_code == 200
    assert anon_client.get("/api/auth/me").get_json()["user"] is None
    assert anon_client.post("/api/translate", json={"text": "hi", "target_language": "fr"}).status_code == 401


@pytest.mark.parametrize(("username", "password"), [("alice", "wrong-password"), ("nobody", PASSWORD)])
def test_bad_credentials_get_the_same_answer(app, anon_client, username, password):
    create_user(app, "alice")

    res = sign_in(anon_client, username, password)

    assert res.status_code == 401
    assert res.get_json()["error"] == {"code": "invalid_credentials", "message": "Incorrect username or password."}


@pytest.mark.parametrize("payload", [{}, {"username": "alice"}, {"username": "", "password": ""}, {"username": 1, "password": 2}])
def test_sign_in_requires_both_fields(anon_client, payload):
    res = anon_client.post("/api/auth/login", json=payload)

    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "missing_credentials"


def test_session_cookie_is_protected(app, anon_client):
    create_user(app, "alice")

    cookie = sign_in(anon_client, "alice").headers["Set-Cookie"]

    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie
    assert "Expires=" in cookie  # survives a browser restart


def test_changing_a_password_signs_out_existing_sessions(app, anon_client):
    create_user(app, "alice")
    sign_in(anon_client, "alice")

    result = run_cli(app, "users", "set-password", "alice", "--password", "a-brand-new-secret")

    assert result.exit_code == 0, result.output
    assert anon_client.get("/api/auth/me").get_json()["user"] is None
    assert sign_in(anon_client, "alice").status_code == 401
    assert sign_in(anon_client, "alice", "a-brand-new-secret").status_code == 200


def test_deleting_a_user_signs_them_out(app, anon_client):
    create_user(app, "alice")
    sign_in(anon_client, "alice")

    result = run_cli(app, "users", "delete", "alice", "--yes")

    assert result.exit_code == 0, result.output
    assert anon_client.get("/api/auth/me").get_json()["user"] is None


# --- user management CLI --------------------------------------------------------

def test_cli_creates_and_lists_users(app):
    result = run_cli(app, "users", "create", "alice", input=f"{PASSWORD}\n{PASSWORD}\n")  # prompted, hidden

    assert result.exit_code == 0, result.output
    assert "Created user 'alice'" in result.output
    listing = run_cli(app, "users", "list").output
    assert "alice" in listing and "never signed in" in listing


@pytest.mark.parametrize(
    ("username", "password", "message"),
    [
        ("al", PASSWORD, "Usernames must be"),
        ("alice smith", PASSWORD, "Usernames must be"),
        ("alice", "short", "at least 8 characters"),
    ],
)
def test_cli_rejects_invalid_accounts(app, username, password, message):
    result = run_cli(app, "users", "create", username, "--password", password)

    assert result.exit_code != 0
    assert message in result.output


def test_cli_rejects_duplicate_usernames(app):
    create_user(app, "alice")

    result = run_cli(app, "users", "create", "ALICE", "--password", PASSWORD)

    assert result.exit_code != 0
    assert "already taken" in result.output


def test_cli_reports_unknown_users(app):
    assert "No user named" in run_cli(app, "users", "delete", "ghost", "--yes").output
    assert "No user named" in run_cli(app, "users", "set-password", "ghost", "--password", PASSWORD).output


def test_passwords_are_stored_hashed(tmp_path):
    store = UserStore(tmp_path)
    store.create("alice", PASSWORD)

    stored = store.find("alice")["password_hash"]

    assert PASSWORD not in stored
    assert stored.startswith(("scrypt:", "pbkdf2:"))


# --- rate limiting ------------------------------------------------------------

@pytest.fixture
def limited_app(service, tmp_path, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_LOGIN", "3 per minute")
    monkeypatch.setenv("RATE_LIMIT_TRANSLATE", "2 per minute")
    return create_app(service, data_dir=tmp_path, config={"TESTING": True}, oauth_login=OAuthLogin(env={}))


def test_sign_in_attempts_are_rate_limited(limited_app):
    create_user(limited_app, "alice")
    client = limited_app.test_client()

    statuses = [sign_in(client, "alice", "wrong-password").status_code for _ in range(4)]

    assert statuses == [401, 401, 401, 429]
    blocked = sign_in(client, "alice")  # even the right password must wait
    assert blocked.status_code == 429
    error = blocked.get_json()["error"]
    assert error["code"] == "too_many_requests"
    assert "Please wait" in error["message"]
    assert 0 < int(blocked.headers["Retry-After"]) <= 60


def test_translation_limits_are_per_user(limited_app):
    for name in ("alice", "bob"):
        create_user(limited_app, name)
    alice, bob = limited_app.test_client(), limited_app.test_client()
    sign_in(alice, "alice")
    sign_in(bob, "bob")
    payload = {"text": "hi", "target_language": "fr"}

    statuses = [alice.post("/api/translate", json=payload).status_code for _ in range(3)]

    assert statuses == [200, 200, 429]
    assert bob.post("/api/translate", json=payload).status_code == 200
    assert alice.get("/api/config").status_code == 200  # other endpoints are unaffected


def test_rate_limits_report_remaining_quota(limited_app):
    create_user(limited_app, "alice")
    client = limited_app.test_client()
    sign_in(client, "alice")

    res = client.post("/api/translate", json={"text": "hi", "target_language": "fr"})

    assert res.headers["X-RateLimit-Limit"] == "2"
    assert res.headers["X-RateLimit-Remaining"] == "1"
