"""Flask backend for the Audio Translator.

Serves a small JSON API plus the built React frontend (frontend/dist):

    GET  /api/config                supported languages, limits and model names
    POST /api/transcribe            multipart audio -> transcript + detected language
    POST /api/translate             JSON {text, source_language?, target_language} -> translation
    POST /api/speech                JSON {text, language} -> MP3 of the text read aloud
    POST /api/shares                JSON translation -> {id, url} share link
    GET  /api/shares/<id>           a shared translation
    GET  /api/shares/<id>/audio     its MP3 (?download=1 to save it)
    GET  /s/<id>                    the share page (rendered by the frontend)
"""

import logging
import os
import re
from pathlib import Path

import openai
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from languages import SUPPORTED_LANGUAGES, Language, get_language, resolve_detected_language
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

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # OpenAI's upload limit for audio
MAX_RECORDING_SECONDS = 10 * 60
MAX_TEXT_CHARS = 50_000
MAX_SPEECH_CHARS = 20_000

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


def create_app(service: TranslationService | None = None, data_dir: Path | None = None) -> Flask:
    app = Flask(__name__, static_folder=str(FRONTEND_DIST), static_url_path="")
    # Leave headroom for multipart overhead; the audio itself is checked against MAX_AUDIO_BYTES.
    app.config["MAX_CONTENT_LENGTH"] = MAX_AUDIO_BYTES + 512 * 1024

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
    lazy = {"service": service, "shares": None}

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
            lazy["shares"] = ShareStore(data_dir or DATA_DIR)
        return lazy["shares"]

    def find_share(share_id: str) -> dict:
        share = get_shares().get(share_id)
        if share is None:
            raise ApiError(404, "not_found", "This shared translation doesn't exist.")
        return share

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
    def speech():
        payload = json_body()
        text = text_field(payload, "text", MAX_SPEECH_CHARS, "text to read aloud")
        language = required_language(payload, "language")
        audio = get_service().speak(text, language)
        # Not cached anywhere on the server; the browser keeps its own copy.
        return Response(audio, mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})

    @app.post("/api/shares")
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

    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return error_response(err.status, err.code, err.message)

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
