import pytest
from werkzeug.security import generate_password_hash

from app import create_app
from oauth_login import OAuthLogin
from translation_service import IdentifiedLanguage, Transcription, Translation

PASSWORD = "correct-horse-battery"


class FakeService:
    transcription_model = "whisper-1"
    translation_model = "gpt-4.1"
    detection_model = "gpt-4.1-mini"
    speech_model = "gpt-4o-mini-tts"
    speech_voice = "marin"

    def __init__(self):
        self.transcription = Transcription("नमस्ते दुनिया", "hindi", 2.5)
        self.identified = IdentifiedLanguage("hi", "Hindi")
        self.identify_error = None
        self.translation = Translation("Hello world", "gpt-4.1-2025-04-14", False)
        self.error = None
        self.calls = []

    def transcribe(self, filename, data, content_type):
        self.calls.append(("transcribe", filename, data, content_type))
        if self.error:
            raise self.error
        return self.transcription

    def identify_language(self, text):
        self.calls.append(("identify", text))
        if self.identify_error:
            raise self.identify_error
        return self.identified

    def translate(self, text, target, source=None):
        self.calls.append(("translate", text, target, source))
        if self.error:
            raise self.error
        return self.translation

    def speak(self, text, language):
        self.calls.append(("speak", text, language.code))
        if self.error:
            raise self.error
        return b"ID3-fake-mp3"


def run_cli(app, *args, input=None):
    return app.test_cli_runner().invoke(args=list(args), input=input)


def create_user(app, username, password=PASSWORD):
    result = run_cli(app, "users", "create", username, "--password", password)
    assert result.exit_code == 0, result.output


def sign_in(client, username, password=PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch):
    # scrypt is deliberately slow; tests don't need that strength (checks read the method from the hash).
    monkeypatch.setattr(
        "user_store.generate_password_hash",
        lambda password: generate_password_hash(password, method="pbkdf2:sha256:1000"),
    )


@pytest.fixture
def service():
    return FakeService()


@pytest.fixture
def app(service, tmp_path):
    # Rate limiting is covered by its own tests; keep it out of the way elsewhere.
    return create_app(
        service,
        data_dir=tmp_path,
        config={"TESTING": True, "RATELIMIT_ENABLED": False},
        oauth_login=OAuthLogin(env={}),  # independent of any real OAuth credentials in .env
    )


@pytest.fixture
def anon_client(app):
    return app.test_client()


@pytest.fixture
def client(app):
    """A client signed in as 'tester'."""
    create_user(app, "tester")
    client = app.test_client()
    assert sign_in(client, "tester").status_code == 200
    return client
