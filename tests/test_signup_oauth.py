import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from app import create_app
from conftest import PASSWORD, create_user, run_cli, sign_in
from oauth_login import PROVIDERS, OAuthLogin, Provider, github_profile, google_profile
from user_store import username_from_hint

# --- sign-up --------------------------------------------------------------------


def sign_up(client, username, password=PASSWORD):
    return client.post("/api/auth/signup", json={"username": username, "password": password})


def test_sign_up_creates_an_account_and_signs_in(app, anon_client):
    res = sign_up(anon_client, "new.user")

    assert res.status_code == 201
    assert res.get_json() == {"user": {"username": "new.user"}}
    assert anon_client.get("/api/auth/me").get_json()["user"] == {"username": "new.user"}
    assert anon_client.post("/api/translate", json={"text": "hi", "target_language": "fr"}).status_code == 200
    # The same credentials work for signing in later.
    anon_client.post("/api/auth/logout")
    assert sign_in(anon_client, "new.user").status_code == 200


@pytest.mark.parametrize(
    ("username", "password", "status", "code", "message"),
    [
        ("ab", PASSWORD, 400, "invalid_account", "Usernames must be"),
        ("has space", PASSWORD, 400, "invalid_account", "Usernames must be"),
        ("newbie", "short", 400, "invalid_account", "at least 8 characters"),
        ("newbie1234", "NEWBIE1234", 400, "invalid_account", "isn't your username"),
        ("Tester", PASSWORD, 409, "username_taken", "already taken"),
    ],
)
def test_sign_up_validates_accounts(app, anon_client, username, password, status, code, message):
    create_user(app, "tester")

    res = sign_up(anon_client, username, password)

    assert res.status_code == status
    error = res.get_json()["error"]
    assert error["code"] == code
    assert message in error["message"]


def test_sign_up_can_be_turned_off(service, tmp_path):
    app = create_app(service, data_dir=tmp_path, config={"ALLOW_SIGNUPS": False}, oauth_login=OAuthLogin(env={}))
    client = app.test_client()

    res = sign_up(client, "newbie")

    assert res.status_code == 403
    assert res.get_json()["error"]["code"] == "signup_disabled"
    assert client.get("/api/auth/me").get_json()["signup_enabled"] is False


def test_only_created_accounts_count_towards_the_sign_up_limit(service, tmp_path, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_SIGNUP", "2 per hour")
    app = create_app(service, data_dir=tmp_path, oauth_login=OAuthLogin(env={}))
    client = app.test_client()

    assert sign_up(client, "x").status_code == 400  # mistakes don't use up the allowance
    assert sign_up(client, "first-user").status_code == 201
    assert sign_up(client, "second-user").status_code == 201

    blocked = sign_up(client, "third-user")
    assert blocked.status_code == 429
    assert blocked.get_json()["error"]["code"] == "too_many_requests"


# --- provider profiles ------------------------------------------------------------


def test_google_profile_uses_verified_email_only():
    verified = google_profile(None, {"userinfo": {"sub": "123", "email": "ann@gmail.com", "email_verified": True}})
    unverified = google_profile(None, {"userinfo": {"sub": "123", "email": "ann@gmail.com", "email_verified": False, "name": "Ann Lee"}})

    assert (verified.subject, verified.email, verified.username_hint) == ("123", "ann@gmail.com", "ann@gmail.com")
    assert (unverified.email, unverified.username_hint) == (None, "Ann Lee")


def test_github_profile_reads_the_user_api():
    response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id": 42, "login": "octocat", "email": None})
    client = SimpleNamespace(get=lambda path, token: response)

    profile = github_profile(client, {"access_token": "t"})

    assert (profile.subject, profile.username_hint, profile.email) == ("42", "octocat", None)


@pytest.mark.parametrize(
    ("hint", "expected"),
    [("octocat", "octocat"), ("ann.lee@gmail.com", "ann.lee"), ("Ann Lee", "Ann.Lee"), ("_x", "user"), ("名前", "user"), ("a" * 40, "a" * 32)],
)
def test_usernames_from_provider_details(hint, expected):
    assert username_from_hint(hint) == expected


def test_providers_are_enabled_only_with_credentials():
    login = OAuthLogin(env={"GITHUB_CLIENT_ID": "id", "GITHUB_CLIENT_SECRET": "secret", "GOOGLE_CLIENT_ID": "only-id"})
    create_app(oauth_login=login)

    assert login.available() == [{"id": "github", "name": "GitHub"}]


def test_unknown_providers_are_rejected(anon_client):
    assert anon_client.get("/api/auth/oauth/myspace/start").status_code == 404
    res = anon_client.get("/api/auth/oauth/myspace/callback?code=x")
    assert res.status_code == 302 and res.headers["Location"] == "/?auth_error=oauth_unavailable"


# --- the full OAuth flow, against a fake provider ----------------------------------


class FakeProvider:
    """A minimal OAuth 2.0 server with GitHub's shape: /token and /user."""

    def __init__(self):
        self.user = {"id": 4242, "login": "octocat", "email": "octo@example.com"}
        self.token_requests = []
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"])).decode()
                provider.token_requests.append(parse_qs(body))
                self._json({"access_token": "fake-token", "token_type": "bearer", "scope": "read:user"})

            def do_GET(self):
                if self.headers.get("Authorization") != "Bearer fake-token":
                    self._json({"message": "Bad credentials"}, 401)
                else:
                    self._json(provider.user)

            def _json(self, data, status=200):
                payload = json.dumps(data).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def login(self) -> OAuthLogin:
        spec = Provider(
            id="github",
            name="GitHub",
            settings={
                "authorize_url": f"{self.url}/authorize",
                "access_token_url": f"{self.url}/token",
                "api_base_url": f"{self.url}/",
                "client_kwargs": {"scope": "read:user user:email"},
            },
            profile=PROVIDERS["github"].profile,
        )
        return OAuthLogin(providers={"github": spec}, env={"GITHUB_CLIENT_ID": "client-1", "GITHUB_CLIENT_SECRET": "s3cret"})


@pytest.fixture
def provider():
    fake = FakeProvider()
    yield fake
    fake.server.shutdown()


def oauth_app(service, tmp_path, provider, **config):
    return create_app(service, data_dir=tmp_path, config={"RATELIMIT_ENABLED": False, **config}, oauth_login=provider.login())


def go_through_provider(client, code="auth-code"):
    """Start sign-in, then come back from the provider the way a browser would."""
    start = client.get("/api/auth/oauth/github/start")
    assert start.status_code == 302
    authorize = urlparse(start.headers["Location"])
    state = parse_qs(authorize.query)["state"][0]
    return start, client.get(f"/api/auth/oauth/github/callback?code={code}&state={state}")


def test_first_provider_sign_in_creates_an_account(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    client = app.test_client()

    start, callback = go_through_provider(client)

    query = parse_qs(urlparse(start.headers["Location"]).query)
    assert start.headers["Location"].startswith(f"{provider.url}/authorize?")
    assert query["client_id"] == ["client-1"]
    assert query["redirect_uri"] == ["http://localhost/api/auth/oauth/github/callback"]
    assert query["scope"] == ["read:user user:email"]

    assert callback.status_code == 302 and callback.headers["Location"] == "/"
    assert provider.token_requests[0]["code"] == ["auth-code"]
    assert client.get("/api/auth/me").get_json()["user"] == {"username": "octocat"}
    assert client.get("/api/auth/me").get_json()["providers"] == [{"id": "github", "name": "GitHub"}]
    assert "octocat" in run_cli(app, "users", "list").output and "github" in run_cli(app, "users", "list").output


def test_returning_provider_users_get_the_same_account(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    go_through_provider(app.test_client())
    provider.user["login"] = "renamed-on-github"  # usernames are kept; the account id is what matters

    client = app.test_client()
    go_through_provider(client)

    assert client.get("/api/auth/me").get_json()["user"] == {"username": "octocat"}
    assert "renamed" not in run_cli(app, "users", "list").output


def test_provider_accounts_never_take_over_existing_usernames(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    create_user(app, "octocat")
    client = app.test_client()

    go_through_provider(client)

    assert client.get("/api/auth/me").get_json()["user"] == {"username": "octocat-2"}


def test_provider_only_accounts_have_no_password(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    go_through_provider(app.test_client())

    assert sign_in(app.test_client(), "octocat", "").status_code == 400
    assert sign_in(app.test_client(), "octocat", "any-password").status_code == 401


def test_a_forged_state_is_rejected(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    client = app.test_client()
    client.get("/api/auth/oauth/github/start")

    res = client.get("/api/auth/oauth/github/callback?code=auth-code&state=forged")

    assert res.headers["Location"] == "/?auth_error=oauth_failed"
    assert provider.token_requests == []
    assert client.get("/api/auth/me").get_json()["user"] is None


def test_cancelling_at_the_provider_is_reported(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    client = app.test_client()
    client.get("/api/auth/oauth/github/start")

    res = client.get("/api/auth/oauth/github/callback?error=access_denied")

    assert res.headers["Location"] == "/?auth_error=oauth_cancelled"


def test_new_provider_accounts_respect_closed_sign_ups(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider, ALLOW_SIGNUPS=False)
    client = app.test_client()

    _, callback = go_through_provider(client)

    assert callback.headers["Location"] == "/?auth_error=signup_disabled"
    assert client.get("/api/auth/me").get_json()["user"] is None


def test_deleting_an_account_unlinks_the_provider(service, tmp_path, provider):
    app = oauth_app(service, tmp_path, provider)
    go_through_provider(app.test_client())
    assert run_cli(app, "users", "delete", "octocat", "--yes").exit_code == 0

    client = app.test_client()
    go_through_provider(client)

    # A fresh account, not a dangling link to the deleted one.
    assert client.get("/api/auth/me").get_json()["user"] == {"username": "octocat"}
