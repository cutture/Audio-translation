"""Languages supported by the transcription + translation pipeline.

Whisper reliably transcribes (and detects) the languages below, and the
chat model can translate into all of them. This module is the single source
of truth for the language dropdown in the UI.
"""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Language:
    code: str  # ISO 639-1
    name: str
    native_name: str
    rtl: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


SUPPORTED_LANGUAGES: tuple[Language, ...] = (
    Language("af", "Afrikaans", "Afrikaans"),
    Language("ar", "Arabic", "العربية", rtl=True),
    Language("hy", "Armenian", "Հայերեն"),
    Language("az", "Azerbaijani", "Azərbaycan dili"),
    Language("be", "Belarusian", "Беларуская"),
    Language("bn", "Bengali", "বাংলা"),
    Language("bs", "Bosnian", "Bosanski"),
    Language("bg", "Bulgarian", "Български"),
    Language("ca", "Catalan", "Català"),
    Language("zh", "Chinese", "中文"),
    Language("hr", "Croatian", "Hrvatski"),
    Language("cs", "Czech", "Čeština"),
    Language("da", "Danish", "Dansk"),
    Language("nl", "Dutch", "Nederlands"),
    Language("en", "English", "English"),
    Language("et", "Estonian", "Eesti"),
    Language("fi", "Finnish", "Suomi"),
    Language("fr", "French", "Français"),
    Language("gl", "Galician", "Galego"),
    Language("de", "German", "Deutsch"),
    Language("el", "Greek", "Ελληνικά"),
    Language("gu", "Gujarati", "ગુજરાતી"),
    Language("he", "Hebrew", "עברית", rtl=True),
    Language("hi", "Hindi", "हिन्दी"),
    Language("hu", "Hungarian", "Magyar"),
    Language("is", "Icelandic", "Íslenska"),
    Language("id", "Indonesian", "Bahasa Indonesia"),
    Language("it", "Italian", "Italiano"),
    Language("ja", "Japanese", "日本語"),
    Language("kn", "Kannada", "ಕನ್ನಡ"),
    Language("kk", "Kazakh", "Қазақ тілі"),
    Language("ko", "Korean", "한국어"),
    Language("lv", "Latvian", "Latviešu"),
    Language("lt", "Lithuanian", "Lietuvių"),
    Language("mk", "Macedonian", "Македонски"),
    Language("ms", "Malay", "Bahasa Melayu"),
    Language("ml", "Malayalam", "മലയാളം"),
    Language("mi", "Maori", "Te Reo Māori"),
    Language("mr", "Marathi", "मराठी"),
    Language("ne", "Nepali", "नेपाली"),
    Language("no", "Norwegian", "Norsk"),
    Language("fa", "Persian", "فارسی", rtl=True),
    Language("pl", "Polish", "Polski"),
    Language("pt", "Portuguese", "Português"),
    Language("pa", "Punjabi", "ਪੰਜਾਬੀ"),
    Language("ro", "Romanian", "Română"),
    Language("ru", "Russian", "Русский"),
    Language("sr", "Serbian", "Српски"),
    Language("sk", "Slovak", "Slovenčina"),
    Language("sl", "Slovenian", "Slovenščina"),
    Language("es", "Spanish", "Español"),
    Language("sw", "Swahili", "Kiswahili"),
    Language("sv", "Swedish", "Svenska"),
    Language("tl", "Tagalog", "Tagalog"),
    Language("ta", "Tamil", "தமிழ்"),
    Language("te", "Telugu", "తెలుగు"),
    Language("th", "Thai", "ไทย"),
    Language("tr", "Turkish", "Türkçe"),
    Language("uk", "Ukrainian", "Українська"),
    Language("ur", "Urdu", "اردو", rtl=True),
    Language("vi", "Vietnamese", "Tiếng Việt"),
    Language("cy", "Welsh", "Cymraeg"),
)

_BY_CODE = {lang.code: lang for lang in SUPPORTED_LANGUAGES}
_BY_NAME = {lang.name.lower(): lang for lang in SUPPORTED_LANGUAGES}

# Whisper reports the detected language as a lowercase English name and
# sometimes uses an alternative name for a language we support.
_WHISPER_ALIASES = {
    "castilian": "es",
    "flemish": "nl",
    "mandarin": "zh",
    "moldavian": "ro",
    "moldovan": "ro",
    "nynorsk": "no",
    "panjabi": "pa",
    "valencian": "ca",
}


def get_language(code: str | None) -> Language | None:
    if not code:
        return None
    return _BY_CODE.get(code.strip().lower())


def resolve_detected_language(code: str | None = None, name: str | None = None) -> dict | None:
    """Map a detected language (ISO code and/or English name) to our catalogue.

    Either value may be a code or a name ("hi", "hindi"). Languages we don't
    list are still returned, with ``code`` set to None, so the UI can show
    what was heard.
    """
    keys = [value.strip().lower() for value in (code, name) if value and value.strip()]
    if not keys:
        return None
    for key in keys:
        lang = _BY_CODE.get(key) or _BY_NAME.get(key) or _BY_CODE.get(_WHISPER_ALIASES.get(key, ""))
        if lang:
            return {**lang.to_dict(), "supported": True}
    display = (name or code).strip().title()
    return {"code": None, "name": display, "native_name": display, "rtl": False, "supported": False}
