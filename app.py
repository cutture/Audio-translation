"""Flask backend for the Audio Translator.

Serves a small JSON API plus the built React frontend (frontend/dist):

    GET  /api/auth/me               who is signed in, plus the available sign-in options
    POST /api/auth/signup           JSON {username, password} -> creates an account and signs in
    POST /api/auth/login            JSON {username, password} -> starts a session
    POST /api/auth/logout           ends the session
    GET  /api/auth/oauth/<provider>/start      redirects to Google/GitHub to sign in
    GET  /api/auth/oauth/<provider>/callback   where the provider sends the user back
    GET  /api/config                supported languages, limits and model names
    POST /api/transcribe            multipart audio -> transcript + detected language      (signed in)
    POST /api/translate             JSON {text, source_language?, target_language}         (signed in)
    POST /api/speech                JSON {text, language} -> MP3 of the text read aloud    (signed in)
    POST /api/shares                JSON translation -> {id, url} share link               (signed in)
    GET  /api/shares/<id>           a shared translation                                   (public)
    GET  /api/shares/<id>/audio     its MP3 (?download=1 to save it)                       (public)
    GET  /s/<id>                    the share page (rendered by the frontend)

Accounts can also be managed from the command line: `flask --app app users --help`.
"""

import functools
import logging
import math
import os
import re
import secrets
import time
from datetime import timedelta
from pathlib import Path

import click
import openai
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, redirect, request, send_file, send_from_directory, session, url_for
from flask.sessions import SecureCookieSessionInterface
from flask_limiter import Limiter, RateLimitExceeded
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix

from languages import SUPPORTED_LANGUAGES, Language, get_language, resolve_detected_language
from oauth_login import OAuthLogin, OAuthLoginError
from share_store import ShareStore
from translation_service import (
    DEFAULT_DETECTION_MODEL,
    DEFAULT_SPEECH_MODEL,
    DEFAULT_SPEECH_VOICE,
    DEFAULT_TRANSCRIPTION_MODEL,
    DEFAULT_TRANSLATION_MODEL,
    Transcription,
    TranslationService,
)
from user_store import UsernameTaken, UserStore

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # OpenAI's upload limit for audio
MAX_RECORDING_SECONDS = 10 * 60
MAX_TEXT_CHARS = 50_000
MAX_SPEECH_CHARS = 20_000

# Override any of these with RATE_LIMIT_<NAME>, e.g. RATE_LIMIT_TRANSLATE="10 per minute; 100 per day".
DEFAULT_RATE_LIMITS = {
    "login": "5 per minute; 50 per day",  # per IP address, against password guessing
    "signup": "5 per hour; 20 per day",  # per IP address; only accounts actually created count
    "oauth": "20 per minute",  # per IP address
    "transcribe": "10 per minute; 200 per day",  # the rest are per signed-in user
    "translate": "30 per minute; 500 per day",
    "speech": "30 per minute; 500 per day",
    "share": "10 per minute; 100 per day",
    "share_audio": "30 per minute",  # per IP address; share pages are public
}

# Formats accepted by the OpenAI transcription API.
AUDIO_EXTENSIONS = {".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".oga", ".ogg", ".wav", ".webm"}
MIMETYPE_EXTENSIONS = {
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/mp4": ".mp4",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "video/webm": ".webm",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str):
    return jsonify(error={"code": code, "message": message}), status


def audio_extension(filename: str | None, mimetype: str | None) -> str | None:
    suffix = Path(filename or "").suffix.lower()
    if suffix in AUDIO_EXTENSIONS:
        return suffix
    return MIMETYPE_EXTENSIONS.get((mimetype or "").lower())


# --- request validation ------------------------------------------------------

def json_body() -> dict:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiError(400, "invalid_json", "Send a JSON body.")
    return payload


def text_field(payload: dict, name: str, max_chars: int, label: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, f"missing_{name}", f"Provide the {label}.")
    if len(value) > max_chars:
        raise ApiError(400, f"{name}_too_long", f"The {label} must be {max_chars:,} characters or fewer.")
    return value.strip()


def optional_language(payload: dict, name: str) -> Language | None:
    value = payload.get(name)
    return get_language(value) if isinstance(value, str) else None


def required_language(payload: dict, name: str) -> Language:
    language = optional_language(payload, name)
    if language is None:
        raise ApiError(400, "unsupported_language", "Choose a supported language.")
    return language


# --- sessions ------------------------------------------------------------------

class LazySecretSessionInterface(SecureCookieSessionInterface):
    """Resolves the signing key on first use, so importing the app never touches the disk."""

    def __init__(self, load_key):
        self._load_key = load_key

    def get_signing_serializer(self, app):
        if not app.secret_key:
            app.secret_key = self._load_key()
        return super().get_signing_serializer(app)


def load_or_create_secret_key(directory: Path) -> str:
    """Use SECRET_KEY if set; otherwise a random key kept in the data directory so
    sessions survive restarts."""
    path = Path(directory) / "secret_key"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(32)
    try:
        with path.open("x", encoding="utf-8") as file:
            file.write(key)
    except FileExistsError:  # another worker created it first
        return path.read_text(encoding="utf-8").strip()
    return key


def public_user(user: dict | None) -> dict | None:
    return {"username": user["username"]} if user else None


def credentials(payload: dict) -> tuple[str, str]:
    username, password = payload.get("username"), payload.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or not username.strip() or not password:
        raise ApiError(400, "missing_credentials", "Enter your username and password.")
    return username.strip(), password


def start_session(user: dict) -> None:
    session.clear()
    session.permanent = True
    session["uid"] = user["id"]
    session["sv"] = user["session_version"]


def login_required(view):
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if g.get("user") is None:
            raise ApiError(401, "unauthorized", "Please sign in to continue.")
        return view(*args, **kwargs)

    return wrapper


def describe_wait(seconds: int) -> str:
    if seconds < 90:
        return f"{seconds} second{'' if seconds == 1 else 's'}"
    if seconds < 90 * 60:
        return f"{round(seconds / 60)} minutes"
    return f"{round(seconds / 3600)} hours"


def create_app(
    service: TranslationService | None = None,
    data_dir: Path | None = None,
    config: dict | None = None,
    oauth_login: OAuthLogin | None = None,
) -> Flask:
    app = Flask(__name__, static_folder=str(FRONTEND_DIST), static_url_path="")
    data_dir = Path(data_dir) if data_dir else DATA_DIR
    app.config.update(
        # Leave headroom for multipart overhead; the audio itself is checked against MAX_AUDIO_BYTES.
        MAX_CONTENT_LENGTH=MAX_AUDIO_BYTES + 512 * 1024,
        SECRET_KEY=os.getenv("SECRET_KEY") or None,
        SESSION_COOKIE_NAME="audio_translator_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",  # the browser won't send it with cross-site POSTs (CSRF)
        SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE") == "1",  # set to 1 when served over HTTPS
        PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.getenv("SESSION_DAYS", "7"))),
        # Anyone can create an account unless this is turned off (then only the admin can, via the CLI).
        ALLOW_SIGNUPS=os.getenv("ALLOW_SIGNUPS", "1") != "0",
    )
    app.config.update(config or {})
    app.session_interface = LazySecretSessionInterface(lambda: load_or_create_secret_key(data_dir))

    # Behind a reverse proxy (most hosting platforms), trust its X-Forwarded-* headers so
    # rate limits see the visitor's IP address rather than the proxy's.
    trusted_proxies = int(os.getenv("TRUSTED_PROXIES", "0"))
    if trusted_proxies:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=trusted_proxies, x_proto=trusted_proxies, x_host=trusted_proxies)

    oauth_login = oauth_login or OAuthLogin()
    oauth_login.init_app(app)

    models = {
        "transcription": service.transcription_model if service
        else os.getenv("OPENAI_TRANSCRIPTION_MODEL", DEFAULT_TRANSCRIPTION_MODEL),
        "detection": service.detection_model if service
        else os.getenv("OPENAI_DETECTION_MODEL", DEFAULT_DETECTION_MODEL),
        "translation": service.translation_model if service
        else os.getenv("OPENAI_TRANSLATION_MODEL", DEFAULT_TRANSLATION_MODEL),
        "speech": service.speech_model if service
        else os.getenv("OPENAI_SPEECH_MODEL", DEFAULT_SPEECH_MODEL),
    }
    # Created lazily so the UI and /api/config work without a key, and importing
    # this module doesn't touch the disk.
    lazy = {"service": service, "shares": None, "users": None}

    def get_service() -> TranslationService:
        if lazy["service"] is None:
            api_key = os.getenv("OPENAI_API_KEY", "").strip()
            if not api_key:
                raise ApiError(500, "not_configured", "The server is missing OPENAI_API_KEY. Add it to .env and restart.")
            client = openai.OpenAI(api_key=api_key, timeout=120, max_retries=2)
            lazy["service"] = TranslationService(
                client,
                transcription_model=models["transcription"],
                translation_model=models["translation"],
                detection_model=models["detection"],
                speech_model=models["speech"],
                speech_voice=os.getenv("OPENAI_SPEECH_VOICE", DEFAULT_SPEECH_VOICE),
            )
        return lazy["service"]

    def get_shares() -> ShareStore:
        if lazy["shares"] is None:
            lazy["shares"] = ShareStore(data_dir)
        return lazy["shares"]

    def get_users() -> UserStore:
        if lazy["users"] is None:
            lazy["users"] = UserStore(data_dir)
        return lazy["users"]

    def find_share(share_id: str) -> dict:
        share = get_shares().get(share_id)
        if share is None:
            raise ApiError(404, "not_found", "This shared translation doesn't exist.")
        return share

    # Registered before the rate limiter so per-user limits know who is asking.
    @app.before_request
    def load_user():
        g.user = None
        if not request.path.startswith("/api/") or "uid" not in session:
            return
        user = get_users().get(session["uid"])
        # A changed password (or a deleted account) invalidates sessions issued before it.
        if user is None or user["session_version"] != session.get("sv"):
            session.clear()
            return
        g.user = user

    def user_key() -> str:
        return f"user:{g.user['id']}" if g.get("user") else get_remote_address()

    rate_limits = {name: os.getenv(f"RATE_LIMIT_{name.upper()}", default) for name, default in DEFAULT_RATE_LIMITS.items()}
    limiter = Limiter(
        key_func=get_remote_address,
        app=app,
        # memory:// is per process; use e.g. redis://localhost:6379 when running several workers.
        storage_uri=os.getenv("RATE_LIMIT_STORAGE_URI", "memory://"),
        strategy="moving-window",
        headers_enabled=True,
    )

    # --- auth ------------------------------------------------------------------

    @app.get("/api/auth/me")
    def me():
        signups = app.config["ALLOW_SIGNUPS"]
        return jsonify(
            user=public_user(g.user),
            signup_enabled=signups,
            providers=oauth_login.available(),
            # Nobody can get in until the admin creates the first account.
            setup_required=not signups and get_users().count() == 0,
        )

    @app.post("/api/auth/signup")
    @limiter.limit(rate_limits["signup"], deduct_when=lambda response: response.status_code == 201)
    def signup():
        if not app.config["ALLOW_SIGNUPS"]:
            raise ApiError(403, "signup_disabled", "New accounts can only be created by the administrator.")
        username, password = credentials(json_body())
        try:
            user = get_users().create(username, password)
        except UsernameTaken as err:
            raise ApiError(409, "username_taken", str(err)) from None
        except ValueError as err:
            raise ApiError(400, "invalid_account", str(err)) from None
        start_session(user)
        return jsonify(user=public_user(user)), 201

    @app.post("/api/auth/login")
    @limiter.limit(rate_limits["login"])
    def login():
        username, password = credentials(json_body())
        user = get_users().authenticate(username, password)
        if user is None:
            raise ApiError(401, "invalid_credentials", "Incorrect username or password.")
        start_session(user)
        return jsonify(user=public_user(user))

    @app.get("/api/auth/oauth/<provider>/start")
    @limiter.limit(rate_limits["oauth"])
    def oauth_start(provider: str):
        if not oauth_login.has(provider):
            raise ApiError(404, "not_found", "This sign-in method isn't available.")
        # Must match a redirect URI registered with the provider.
        return oauth_login.redirect(provider, url_for("oauth_callback", provider=provider, _external=True))

    @app.get("/api/auth/oauth/<provider>/callback")
    @limiter.limit(rate_limits["oauth"])
    def oauth_callback(provider: str):
        # The browser lands here, so problems are reported to the sign-in page, not as JSON.
        if not oauth_login.has(provider):
            return redirect("/?auth_error=oauth_unavailable")
        try:
            profile = oauth_login.complete(provider)
        except OAuthLoginError as err:
            app.logger.warning("%s sign-in failed: %r", provider, err.__cause__ or err)
            return redirect(f"/?auth_error=oauth_{err.reason}")

        users = get_users()
        # Matched on the provider's account id only, never on email, so an account
        # can't be taken over by someone registering a matching address elsewhere.
        user = users.find_by_identity(provider, profile.subject)
        if user is None:
            if not app.config["ALLOW_SIGNUPS"]:
                return redirect("/?auth_error=signup_disabled")
            user = users.create_from_identity(provider, profile.subject, profile.username_hint, profile.email)
        else:
            users.record_login(user["id"])
        start_session(user)
        return redirect("/")

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify(user=None)

    # --- translation -----------------------------------------------------------

    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    @app.get("/api/config")
    def config():
        return jsonify(
            languages=[lang.to_dict() for lang in SUPPORTED_LANGUAGES],
            limits={
                "max_upload_bytes": MAX_AUDIO_BYTES,
                "max_recording_seconds": MAX_RECORDING_SECONDS,
                "max_text_chars": MAX_TEXT_CHARS,
                "max_speech_chars": MAX_SPEECH_CHARS,
            },
            models=models,
        )

    @app.post("/api/transcribe")
    @limiter.limit(rate_limits["transcribe"], key_func=user_key)
    @login_required
    def transcribe():
        upload = request.files.get("file")
        if upload is None:
            raise ApiError(400, "missing_file", "Attach an audio file in the 'file' field.")
        extension = audio_extension(upload.filename, upload.mimetype)
        if extension is None:
            raise ApiError(415, "unsupported_media_type", "Unsupported audio format. Use MP3, WAV, M4A, MP4, WEBM, OGG or FLAC.")

        data = upload.read(MAX_AUDIO_BYTES + 1)
        if not data:
            raise ApiError(400, "empty_file", "The audio file is empty.")
        if len(data) > MAX_AUDIO_BYTES:
            raise ApiError(413, "file_too_large", "Audio files must be 25 MB or smaller.")

        svc = get_service()
        # The client's filename is never used for anything but its extension.
        transcription = svc.transcribe(f"audio{extension}", data, upload.mimetype or "application/octet-stream")
        if not transcription.text:
            raise ApiError(422, "no_speech", "We couldn't hear any speech in this audio. Try a clearer or longer recording.")

        return jsonify(
            transcript=transcription.text,
            detected_language=detect_language(svc, transcription),
            duration=transcription.duration,
            model=svc.transcription_model,
        )

    @app.post("/api/translate")
    @limiter.limit(rate_limits["translate"], key_func=user_key)
    @login_required
    def translate():
        payload = json_body()
        text = text_field(payload, "text", MAX_TEXT_CHARS, "text to translate")
        target = required_language(payload, "target_language")
        source = optional_language(payload, "source_language")
        if source and source.code == target.code:
            raise ApiError(400, "same_language", f"The audio is already in {target.name}. Choose a different target language.")

        translation = get_service().translate(text, target, source)
        return jsonify(
            translation=translation.text,
            source_language=source.to_dict() if source else None,
            target_language=target.to_dict(),
            model=translation.model,
            truncated=translation.truncated,
        )

    @app.post("/api/speech")
    @limiter.limit(rate_limits["speech"], key_func=user_key)
    @login_required
    def speech():
        payload = json_body()
        text = text_field(payload, "text", MAX_SPEECH_CHARS, "text to read aloud")
        language = required_language(payload, "language")
        audio = get_service().speak(text, language)
        # Not cached anywhere on the server; the browser keeps its own copy.
        return Response(audio, mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})

    # --- sharing -----------------------------------------------------------------

    @app.post("/api/shares")
    @limiter.limit(rate_limits["share"], key_func=user_key)
    @login_required
    def create_share():
        payload = json_body()
        transcript = text_field(payload, "transcript", MAX_TEXT_CHARS, "original transcript")
        translation = text_field(payload, "translation", MAX_TEXT_CHARS, "translation")
        target = required_language(payload, "target_language")
        source = optional_language(payload, "source_language")
        share = get_shares().create(
            transcript=transcript,
            translation=translation,
            source_language=source.code if source else None,
            target_language=target.code,
        )
        return jsonify(id=share["id"], url=f"/s/{share['id']}"), 201

    @app.get("/api/shares/<share_id>")
    def get_share(share_id: str):
        share = find_share(share_id)
        source = get_language(share["source_language"])
        return jsonify(
            id=share["id"],
            created_at=share["created_at"],
            transcript=share["transcript"],
            translation=share["translation"],
            source_language=source.to_dict() if source else None,
            target_language=stored_language(share["target_language"]).to_dict(),
            audio_url=f"/api/shares/{share['id']}/audio",
        )

    @app.get("/api/shares/<share_id>/audio")
    @limiter.limit(rate_limits["share_audio"])
    def get_share_audio(share_id: str):
        share = find_share(share_id)
        target = stored_language(share["target_language"])
        # Generated on first play, then served from disk to everyone who opens the link.
        path = get_shares().audio_path(share["id"], lambda: get_service().speak(share["translation"], target))
        slug = re.sub(r"[^a-z0-9]+", "-", target.name.lower()).strip("-")
        return send_file(
            path,
            mimetype="audio/mpeg",
            as_attachment=request.args.get("download") == "1",
            download_name=f"translation-{slug}-{share['id']}.mp3",
            conditional=True,  # supports range requests, so the audio is seekable
            max_age=86_400,
        )

    @app.get("/")
    @app.get("/s/<share_id>")
    def index(share_id: str | None = None):
        if not (FRONTEND_DIST / "index.html").is_file():
            return (
                "<h1>Frontend not built</h1><p>Run <code>npm run build</code> in <code>frontend/</code>, "
                "or start the dev server with <code>npm run dev</code> and open http://localhost:5173.</p>",
                503,
            )
        return send_from_directory(FRONTEND_DIST, "index.html")

    # --- errors ------------------------------------------------------------------

    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return error_response(err.status, err.code, err.message)

    @app.errorhandler(RateLimitExceeded)
    def handle_rate_limited(_err: RateLimitExceeded):
        current = limiter.current_limit
        retry_after = max(1, math.ceil(current.reset_at - time.time())) if current else 60
        response, status = error_response(
            429, "too_many_requests", f"Too many requests. Please wait {describe_wait(retry_after)} and try again."
        )
        response.headers["Retry-After"] = str(retry_after)
        return response, status

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_err):
        return error_response(413, "file_too_large", "Audio files must be 25 MB or smaller.")

    @app.errorhandler(openai.OpenAIError)
    def handle_openai_error(err: openai.OpenAIError):
        app.logger.warning("OpenAI request failed: %r", err)
        return error_response(*describe_openai_error(err))

    @app.errorhandler(HTTPException)
    def handle_http_error(err: HTTPException):
        if not request.path.startswith("/api/"):
            return err
        code = (err.name or "error").lower().replace(" ", "_")
        return error_response(err.code or 500, code, err.description or err.name)

    # --- account management (flask --app app users ...) ---------------------------

    @app.cli.group("users")
    def users_cli():
        """Manage who can sign in."""

    @users_cli.command("create")
    @click.argument("username")
    @click.password_option(help="The password; you are prompted for it (hidden) if omitted.")
    def create_user_command(username: str, password: str):
        """Create an account."""
        try:
            user = get_users().create(username, password)
        except ValueError as err:
            raise click.ClickException(str(err)) from None
        click.echo(f"Created user '{user['username']}'. They can now sign in.")

    @users_cli.command("list")
    def list_users_command():
        """List accounts."""
        users = get_users().list()
        if not users:
            click.echo("No users yet. Create one with: flask --app app users create <username>")
        for user in users:
            methods = (["password"] if user["password_hash"] else []) + (user["providers"] or "").split(",")
            last = f"last signed in {user['last_login_at']}" if user["last_login_at"] else "never signed in"
            click.echo(
                f"{user['username']:<24} {'+'.join(filter(None, methods)):<18} created {user['created_at']}   {last}"
            )

    @users_cli.command("set-password")
    @click.argument("username")
    @click.password_option(help="The new password; you are prompted for it (hidden) if omitted.")
    def set_password_command(username: str, password: str):
        """Change a password and sign the user out everywhere."""
        try:
            changed = get_users().set_password(username, password)
        except ValueError as err:
            raise click.ClickException(str(err)) from None
        if not changed:
            raise click.ClickException(f"No user named '{username}'.")
        click.echo(f"Password changed for '{username}'. Their existing sessions have been signed out.")

    @users_cli.command("delete")
    @click.argument("username")
    @click.confirmation_option(prompt="Delete this user? They will be signed out immediately.")
    def delete_user_command(username: str):
        """Delete an account."""
        if not get_users().delete(username):
            raise click.ClickException(f"No user named '{username}'.")
        click.echo(f"Deleted user '{username}'.")

    return app


def stored_language(code: str) -> Language:
    """A language saved with a share; tolerates codes later removed from the catalogue."""
    return get_language(code) or Language(code, code.upper(), code.upper())


def detect_language(svc: TranslationService, transcription: Transcription) -> dict | None:
    """Prefer the language of the transcript text; fall back to Whisper's own label."""
    try:
        identified = svc.identify_language(transcription.text)
    except openai.OpenAIError as err:
        logging.getLogger(__name__).warning("Language identification failed, using Whisper's label: %r", err)
        identified = None
    detected = resolve_detected_language(identified.code, identified.name) if identified else None
    return detected or resolve_detected_language(name=transcription.language)


def describe_openai_error(err: openai.OpenAIError) -> tuple[int, str, str]:
    if isinstance(err, openai.RateLimitError):
        return 429, "rate_limited", "OpenAI rate limit or quota reached. Please wait a moment and try again."
    if isinstance(err, (openai.AuthenticationError, openai.PermissionDeniedError)):
        return 502, "upstream_auth", "OpenAI rejected the server's API key. Check OPENAI_API_KEY in .env."
    if isinstance(err, openai.APITimeoutError):
        return 504, "upstream_timeout", "OpenAI took too long to respond. Please try again."
    if isinstance(err, openai.APIConnectionError):
        return 504, "upstream_unreachable", "Could not reach OpenAI. Check the server's internet connection."
    if isinstance(err, (openai.BadRequestError, openai.UnprocessableEntityError)):
        detail = err.body.get("message") if isinstance(err.body, dict) else None
        return 422, "upstream_rejected", f"OpenAI could not process this request{': ' + detail if detail else '.'}"
    return 502, "upstream_error", "The translation service failed. Please try again."


app = create_app()

if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5001")),
        debug=os.getenv("FLASK_DEBUG") == "1",
    )
