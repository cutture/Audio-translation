"""Sign-in with external accounts (OAuth 2.0 / OpenID Connect) via Authlib.

A provider is enabled when its credentials are set, e.g. GOOGLE_CLIENT_ID and
GOOGLE_CLIENT_SECRET. Authlib handles the state parameter (CSRF), PKCE and the
OpenID Connect nonce and ID-token checks.
"""

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import requests
from authlib.integrations.flask_client import OAuth, OAuthError
from flask import Flask, request


@dataclass(frozen=True)
class OAuthProfile:
    subject: str  # the provider's permanent account id
    username_hint: str
    email: str | None = None


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    settings: dict  # Authlib registration: endpoints and scopes
    profile: Callable[[object, dict], OAuthProfile]


class OAuthLoginError(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason  # "cancelled" or "failed"


def google_profile(_client, token: dict) -> OAuthProfile:
    claims = token["userinfo"]  # verified ID-token claims
    email = claims.get("email") if claims.get("email_verified") else None
    return OAuthProfile(
        subject=str(claims["sub"]),
        username_hint=email or claims.get("name") or "",
        email=email,
    )


def github_profile(client, token: dict) -> OAuthProfile:
    response = client.get("user", token=token)
    response.raise_for_status()
    user = response.json()
    return OAuthProfile(subject=str(user["id"]), username_hint=user.get("login") or "", email=user.get("email"))


PROVIDERS: dict[str, Provider] = {
    "google": Provider(
        id="google",
        name="Google",
        settings={
            "server_metadata_url": "https://accounts.google.com/.well-known/openid-configuration",
            "client_kwargs": {"scope": "openid email profile", "code_challenge_method": "S256"},
        },
        profile=google_profile,
    ),
    "github": Provider(
        id="github",
        name="GitHub",
        settings={
            "authorize_url": "https://github.com/login/oauth/authorize",
            "access_token_url": "https://github.com/login/oauth/access_token",
            "api_base_url": "https://api.github.com/",
            "client_kwargs": {"scope": "read:user user:email"},
        },
        profile=github_profile,
    ),
}


class OAuthLogin:
    def __init__(self, providers: Mapping[str, Provider] = PROVIDERS, env: Mapping[str, str] = os.environ):
        self._candidates = providers
        self._env = env
        self._oauth = OAuth()
        self._enabled: dict[str, Provider] = {}

    def init_app(self, app: Flask) -> None:
        self._oauth.init_app(app)
        for provider in self._candidates.values():
            prefix = provider.id.upper()
            client_id = self._env.get(f"{prefix}_CLIENT_ID", "").strip()
            client_secret = self._env.get(f"{prefix}_CLIENT_SECRET", "").strip()
            if client_id and client_secret:
                self._oauth.register(provider.id, client_id=client_id, client_secret=client_secret, **provider.settings)
                self._enabled[provider.id] = provider

    def available(self) -> list[dict]:
        return [{"id": provider.id, "name": provider.name} for provider in self._enabled.values()]

    def has(self, provider_id: str) -> bool:
        return provider_id in self._enabled

    def redirect(self, provider_id: str, redirect_uri: str):
        """Send the browser to the provider's sign-in page."""
        return self._oauth.create_client(provider_id).authorize_redirect(redirect_uri)

    def complete(self, provider_id: str) -> OAuthProfile:
        """Finish sign-in on the callback: check state, exchange the code, read the profile."""
        if request.args.get("error"):
            raise OAuthLoginError("cancelled" if request.args["error"] == "access_denied" else "failed")
        client = self._oauth.create_client(provider_id)
        try:
            token = client.authorize_access_token()
            return self._enabled[provider_id].profile(client, token)
        except (OAuthError, requests.RequestException, KeyError, TypeError, ValueError) as err:
            raise OAuthLoginError("failed") from err
