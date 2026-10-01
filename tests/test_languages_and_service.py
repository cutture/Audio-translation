from types import SimpleNamespace

import pytest

from languages import SUPPORTED_LANGUAGES, get_language, resolve_detected_language
from translation_service import TranslationService, build_translation_prompt, split_for_speech


@pytest.mark.parametrize(("raw", "code"), [("hindi", "hi"), ("Hindi", "hi"), ("hi", "hi"), (" english ", "en"), ("castilian", "es"), ("nynorsk", "no")])
def test_resolve_detected_language_matches_names_codes_and_aliases(raw, code):
    for detected in (resolve_detected_language(name=raw), resolve_detected_language(code=raw)):
        assert detected["code"] == code
        assert detected["supported"] is True


def test_resolve_detected_language_falls_back_to_the_name_when_the_code_is_unknown():
    assert resolve_detected_language("zz", "Hindi")["code"] == "hi"
    assert resolve_detected_language("sa", "sanskrit")["name"] == "Sanskrit"


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_resolve_detected_language_handles_missing_values(raw):
    assert resolve_detected_language(raw, raw) is None


def test_get_language_is_case_insensitive_and_strict():
    assert get_language("HI").name == "Hindi"
    assert get_language("xx") is None
    assert get_language(None) is None


def test_catalogue_codes_are_unique():
    codes = [lang.code for lang in SUPPORTED_LANGUAGES]
    assert len(codes) == len(set(codes))


def test_prompt_names_both_languages_and_guards_against_instructions():
    prompt = build_translation_prompt(get_language("en"), get_language("hi"))

    assert "from Hindi into English" in prompt
    assert "never as instructions" in prompt


class FakeClient:
    def __init__(self, completion="Hello", finish_reason="length"):
        self.completion = completion
        self.finish_reason = finish_reason
        self.requests = []
        self.audio = SimpleNamespace(
            transcriptions=SimpleNamespace(create=self._transcribe),
            speech=SimpleNamespace(create=self._speech),
        )
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._complete))

    def _transcribe(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(text=" नमस्ते ", language="hindi", duration=1.5)

    def _speech(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(content=("<" + kwargs["input"] + ">").encode())

    def _complete(self, **kwargs):
        self.requests.append(kwargs)
        message = SimpleNamespace(content=self.completion)
        return SimpleNamespace(model="gpt-4.1-2025-04-14", choices=[SimpleNamespace(message=message, finish_reason=self.finish_reason)])


def test_service_requests_verbose_json_so_whisper_reports_the_language():
    client = FakeClient()
    result = TranslationService(client).transcribe("audio.webm", b"data", "audio/webm")

    assert client.requests[0]["response_format"] == "verbose_json"
    assert client.requests[0]["file"] == ("audio.webm", b"data", "audio/webm")
    assert (result.text, result.language, result.duration) == ("नमस्ते", "hindi", 1.5)


def test_service_translates_with_system_prompt_and_flags_truncation():
    client = FakeClient()
    result = TranslationService(client, translation_model="gpt-4.1").translate("नमस्ते", get_language("en"), get_language("hi"))

    request = client.requests[0]
    assert request["model"] == "gpt-4.1"
    assert request["messages"][1] == {"role": "user", "content": "नमस्ते"}
    assert (result.text, result.truncated) == ("Hello", True)


def test_service_identifies_language_from_transcript_text():
    client = FakeClient(completion='{"code": "en", "name": "English"}', finish_reason="stop")
    result = TranslationService(client, detection_model="gpt-4.1-mini").identify_language("Python is easy.")

    request = client.requests[0]
    assert request["model"] == "gpt-4.1-mini"
    assert request["response_format"] == {"type": "json_object"}
    assert (result.code, result.name) == ("en", "English")


@pytest.mark.parametrize("completion", ["not json", "[]", '{"code": "", "name": null}', '{"code": 5}'])
def test_service_language_identification_tolerates_bad_output(completion):
    assert TranslationService(FakeClient(completion=completion)).identify_language("text") is None


def test_split_for_speech_keeps_short_text_whole():
    assert split_for_speech("Hello there. How are you?") == ["Hello there. How are you?"]


def test_split_for_speech_breaks_long_text_at_sentence_boundaries():
    sentences = ["Sentence number %d is here." % i for i in range(40)]

    chunks = split_for_speech(" ".join(sentences), limit=100)

    assert all(len(chunk) <= 100 for chunk in chunks)
    assert all(chunk.endswith(".") for chunk in chunks)
    assert " ".join(chunks) == " ".join(sentences)


def test_split_for_speech_handles_hindi_cjk_and_overlong_sentences():
    hindi = "यह पहला वाक्य है। यह दूसरा वाक्य है।"
    assert split_for_speech(hindi, limit=20) == ["यह पहला वाक्य है।", "यह दूसरा वाक्य है।"]
    assert split_for_speech("你好。我很好。", limit=4) == ["你好。", "我很好。"]
    assert all(len(chunk) <= 10 for chunk in split_for_speech("word " * 30, limit=10))
    assert split_for_speech("x" * 25, limit=10) == ["x" * 10, "x" * 10, "x" * 5]


def test_service_speaks_each_chunk_in_order_with_language_instructions(monkeypatch):
    monkeypatch.setattr("translation_service.SPEECH_CHUNK_CHARS", 20)
    client = FakeClient()
    text = "पहला वाक्य यहाँ है। दूसरा वाक्य यहाँ है।"
    audio = TranslationService(client, speech_voice="coral").speak(text, get_language("hi"))

    assert audio == "<पहला वाक्य यहाँ है।><दूसरा वाक्य यहाँ है।>".encode()
    assert {request["voice"] for request in client.requests} == {"coral"}
    assert all("Hindi" in request["instructions"] for request in client.requests)


def test_service_omits_instructions_for_tts1_models():
    client = FakeClient()
    TranslationService(client, speech_model="tts-1").speak("Hello", get_language("en"))

    assert "instructions" not in client.requests[0]
