# Audio Translation

Record your voice or upload an audio file, let the app detect the spoken language, and translate it into any of 62 languages. You can listen to the translation, download it, share it by link, and find it again later in your history.

- **Record or upload**: record in the browser with your microphone (up to 10 minutes) or drop in an MP3, WAV, M4A, MP4, WEBM, OGG or FLAC file (up to 25 MB). Both options stay available at all times; recording or uploading again replaces the current clip.
- **Automatic language detection**: the detected language is disabled in the target dropdown, so you can't translate audio into the language it is already in. The API rejects that combination as well.
- **Searchable language picker** with native names (हिन्दी, 日本語, العربية …) and right-to-left rendering where needed.
- **Results on the page**: the original transcript and the translation are shown side by side. Picking another language re-translates the same transcript without uploading the audio again.
- **Play and download**: every translation has a built-in player (play/pause, seek, duration) for the spoken translation (OpenAI text-to-speech, `gpt-4o-mini-tts`), with an MP3 download button right beside it, so you can preview before downloading. A TXT download (original and translation) is also available.
- **Share**: creates a link to a read-only page (`/s/<id>`) where anyone can read, play and download the translation.
- **History**: every translation is saved in your browser (IndexedDB, last 50) and can be searched, played, downloaded, shared or deleted from the History panel.

## How it works

```
Browser (React)                       Flask API                             OpenAI
───────────────                       ─────────                             ──────
record / upload ──► POST /api/transcribe ──► whisper-1 (verbose_json)       → transcript
                                         └─► gpt-4.1-mini                    → language of the transcript
choose target   ──► POST /api/translate  ──► gpt-4.1                         → translation
Play / MP3      ──► POST /api/speech     ──► gpt-4o-mini-tts                 → MP3
Share           ──► POST /api/shares     ──► saved in data/ ─► /s/<id> page (audio generated on first play)
```

- Audio is transcribed in its **original language** and then translated directly into the target, rather than going through English first and losing meaning along the way.
- Whisper's own audio-based language label is unreliable for accented speech (the sample recording, which is in English, is labelled "Bengali"). The language is therefore identified from the transcript text, with Whisper's label kept only as a fallback.
- Uploaded audio is handled in memory and never written to disk. The client's filename is used only for its extension.
- Spoken audio is generated on the first play (or download) and then cached in the browser, so previewing, replaying and downloading cost a single API call. Long texts are spoken in sentence-sized chunks.
- `GET /api/config` is the single source of truth for the supported languages (`languages.py`).

### What is stored where

| Data | Where | Who can see it |
| --- | --- | --- |
| Your audio | Nowhere: processed in memory, sent to OpenAI | – |
| History and its spoken audio | Your browser (IndexedDB) | Only you, on that browser |
| Shared translations (text and MP3) | The server, under `data/` (SQLite and MP3 files) | Anyone with the link |

## Sharing links and hosting

A share link points at the server that created it, so who can open it depends on where the app runs:

| Where the app runs | Who can open the link |
| --- | --- |
| `localhost` (default) | Only you, on this computer |
| Your network: `HOST=0.0.0.0`, then open `http://<your-PC-IP>:5001` | Devices on the same Wi-Fi/LAN (allow the port in Windows Firewall) |
| A tunnel such as `cloudflared tunnel --url http://localhost:5001` or `ngrok http 5001` | Anyone, while the tunnel is running |
| A public host (Render, Railway, Azure App Service, a VPS, …) | Anyone |

The app builds links from the address in your browser, so open it at the public address before creating links you want to send. On a public host, keep `data/` on persistent storage so links survive restarts and redeploys.

## Project layout

```
app.py                  Flask app: JSON API + serves the built frontend
translation_service.py  OpenAI calls (transcribe, identify language, translate, speak)
share_store.py          Storage for shared translations (SQLite + MP3 files)
languages.py            Supported languages and detected-language mapping
tests/                  pytest suite (OpenAI is faked, no network)
frontend/               React 19 + TypeScript + Vite + Tailwind CSS + Headless UI
  src/App.tsx               Page layout and state wiring
  src/state.ts              Reducer for clip → detection → translation
  src/hooks/useRecorder.ts  MediaRecorder-based microphone recording
  src/hooks/useHistory.ts   Translation history (IndexedDB)
  src/lib/                  Speech cache, shared audio player, downloads, clipboard
  src/components/           AudioInput, LanguagePicker, ResultCard, TranslationActions,
                            HistoryDrawer, SharedTranslationPage, …
```

## Setup

Requires Python 3.11+ and Node.js 20+.

```bash
python -m venv audiotrans
audiotrans\Scripts\activate          # macOS/Linux: source audiotrans/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env               # macOS/Linux: cp .env.example .env, then add OPENAI_API_KEY
npm --prefix frontend install
```

## Run

**Production-style (one server):** build the frontend once, then Flask serves everything at http://localhost:5001.

```bash
npm --prefix frontend run build
python app.py
```

**Development (hot reload):** run the API and the Vite dev server side by side, then open http://localhost:5173. Vite proxies `/api` to Flask.

```bash
python app.py
npm --prefix frontend run dev
```

Microphone recording needs a secure context: `localhost` works, but any other host must be served over HTTPS. Tunnels and most hosting platforms provide HTTPS.

## Test

```bash
python -m pytest
npm --prefix frontend run typecheck
```

## Configuration

Set these in `.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | – | Required |
| `OPENAI_TRANSCRIPTION_MODEL` | `whisper-1` | Speech to text (must support `verbose_json`) |
| `OPENAI_DETECTION_MODEL` | `gpt-4.1-mini` | Identifies the transcript's language |
| `OPENAI_TRANSLATION_MODEL` | `gpt-4.1` | Translation |
| `OPENAI_SPEECH_MODEL` | `gpt-4o-mini-tts` | Text to speech (`tts-1` and `tts-1-hd` also work) |
| `OPENAI_SPEECH_VOICE` | `marin` | Voice, e.g. `alloy`, `coral`, `nova`, `cedar` |
| `DATA_DIR` | `./data` | Where shared translations are stored |
| `PORT` / `HOST` | `5001` / `127.0.0.1` | Server address (`HOST=0.0.0.0` to allow other devices) |
| `FLASK_DEBUG` | off | Set to `1` for auto-reload (never in production) |

## Deploying

`python app.py` uses Flask's development server. For a real deployment, run it behind a WSGI server (for example `waitress-serve --port=5001 app:app` on Windows, or gunicorn on Linux) with HTTPS. Add authentication or rate limiting before exposing it publicly, because every request spends OpenAI credits and anyone can create share links.
