# Audio Translation

Record your voice or upload an audio file, let the app detect the spoken language, and translate it into any of 62 languages. You can listen to the translation, download it, share it by link, and find it again later in your history.

- **Record or upload**: record in the browser with your microphone (up to 10 minutes) or drop in an MP3, WAV, M4A, MP4, WEBM, OGG or FLAC file (up to 25 MB). Both options stay available at all times; recording or uploading again replaces the current clip.
- **Automatic language detection**: the detected language is disabled in the target dropdown, so you can't translate audio into the language it is already in. The API rejects that combination as well.
- **Searchable language picker** with native names (हिन्दी, 日本語, العربية …) and right-to-left rendering where needed.
- **Results on the page**: the original transcript and the translation are shown side by side. Picking another language re-translates the same transcript without uploading the audio again.
- **Play and download**: every translation has a built-in player (play/pause, seek, duration) for the spoken translation (OpenAI text-to-speech, `gpt-4o-mini-tts`), with an MP3 download button right beside it, so you can preview before downloading. A TXT download (original and translation) is also available.
- **Share**: creates a link to a read-only page (`/s/<id>`) where anyone can read, play and download the translation.
- **History**: every translation is saved in your browser (IndexedDB, last 50, separately for each account) and can be searched, played, downloaded, shared or deleted from the History panel.
- **Accounts**: people create their own account (username and password) or use **Continue with Google / GitHub**. Only signed-in users can translate, each account has limits on how often it can call OpenAI, and shared links stay public.

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
| History and its spoken audio | Your browser (IndexedDB, one database per account) | Only you, on that browser |
| Shared translations (text and MP3) | The server, under `data/` (SQLite and MP3 files) | Anyone with the link |
| Accounts (scrypt password hashes, linked Google/GitHub account ids) | The server, `data/users.db` | Only the admin, from the CLI |
| Session signing key | `SECRET_KEY`, or generated into `data/secret_key` | Nobody; keep it private |

## Sharing links and hosting

A share link points at the server that created it, so who can open it depends on where the app runs:

| Where the app runs | Who can open the link |
| --- | --- |
| `localhost` (default) | Only you, on this computer |
| Your network: `HOST=0.0.0.0`, then open `http://<your-PC-IP>:5001` | Devices on the same Wi-Fi/LAN (allow the port in Windows Firewall) |
| A tunnel such as `cloudflared tunnel --url http://localhost:5001` or `ngrok http 5001` | Anyone, while the tunnel is running |
| A public host (Render, Railway, Azure App Service, a VPS, …) | Anyone |

The app builds links from the address in your browser, so open it at the public address before creating links you want to send. On a public host, keep `data/` on persistent storage so links survive restarts and redeploys.

## Accounts and rate limits

### Ways to get an account

| How | Where | Notes |
| --- | --- | --- |
| **Create account** | Sign-in page → *Create account* tab | Username (3–32 characters) and password (8+ characters, not the username). Signs you straight in. |
| **Continue with Google / GitHub** | Sign-in page | The first sign-in creates an account (username taken from the Google email or GitHub login, with `-2`, `-3`… if it's taken). Later sign-ins match the provider's permanent account id, never the email, so an account can't be taken over by someone else registering a matching address. |
| **Admin CLI** | Server terminal | `flask --app app users create alice` (see below). |

Set `ALLOW_SIGNUPS=0` to switch off self-service sign-up. Only the admin can then create accounts, and Google/GitHub sign-ins only work for accounts that already exist. Because every account can spend OpenAI credits within its rate limits, consider turning sign-up off, or keeping the limits low, on a public server.

### Setting up Google and GitHub sign-in

Each button appears once its two values are in `.env`. Restart the server after adding them. The **redirect / callback URL** must match the address you open the app at, exactly:

```
http://localhost:5001/api/auth/oauth/google/callback
http://localhost:5001/api/auth/oauth/github/callback
```

For a hosted app use its public address instead, e.g. `https://translate.example.com/api/auth/oauth/google/callback`. If you use the Vite dev server, it's `http://localhost:5173/...`.

**Google**
1. Open [Google Cloud Console → APIs & Services](https://console.cloud.google.com/apis/credentials) and create (or pick) a project.
2. *OAuth consent screen*: choose **External**, fill in the app name and your email, and add yourself under *Test users* while the app is in testing.
3. *Credentials → Create credentials → OAuth client ID*. Application type **Web application**. Under *Authorized redirect URIs*, add the Google callback URL above.
4. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**GitHub**
1. Open [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) → **New OAuth App**.
2. Homepage URL: `http://localhost:5001`. Authorization callback URL: the GitHub callback URL above.
3. Register, then **Generate a new client secret**.
4. Copy the client ID and secret into `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

### Admin commands

With the virtual environment activated, from the project folder:

| Command | What it does |
| --- | --- |
| `flask --app app users create alice` | Creates an account (prompts for the password twice, hidden) |
| `flask --app app users list` | Lists accounts, how they sign in (`password`, `google`, `github`) and their last sign-in |
| `flask --app app users set-password alice` | Sets a new password and **signs alice out everywhere**; also gives Google/GitHub-only accounts a password |
| `flask --app app users delete alice` | Deletes the account and its Google/GitHub links; any open session ends immediately |

Usernames are case-insensitive. Sessions are signed, `HttpOnly`, `SameSite=Lax` cookies that last `SESSION_DAYS` (7 by default) and renew while the app is in use. Set `SESSION_COOKIE_SECURE=1` when the app is served over HTTPS.

### Rate limits

| Action | Default limit | Counted per |
| --- | --- | --- |
| Sign in | 5 per minute, 50 per day | IP address (slows down password guessing) |
| Create account | 5 per hour, 20 per day | IP address (only accounts actually created count) |
| Google / GitHub sign-in | 20 per minute | IP address |
| Transcribe audio | 10 per minute, 200 per day | Account |
| Translate | 30 per minute, 500 per day | Account |
| Play / download speech | 30 per minute, 500 per day | Account |
| Create share links | 10 per minute, 100 per day | Account |
| Play shared audio (public) | 30 per minute | IP address |

Change any of them in `.env`, e.g. `RATE_LIMIT_TRANSLATE=10 per minute; 100 per day`. When a limit is hit, the API answers `429` with a `Retry-After` header, and the app shows *"Too many requests. Please wait N seconds and try again."* Responses also carry `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers.

Counters live in memory, so they reset when the server restarts. If you run several worker processes, point them at a shared store with `RATE_LIMIT_STORAGE_URI=redis://localhost:6379`. Behind a reverse proxy, set `TRUSTED_PROXIES` (usually `1`) so limits see visitors' IP addresses rather than the proxy's.

### Testing accounts, sign-in and rate limits

1. **Install and restart.** Run `pip install -r requirements.txt` (adds Authlib and Flask-Limiter), then restart `python app.py`. The frontend in `frontend/dist` is already built; rebuild with `npm --prefix frontend run build` after pulling changes.
2. **Create an account in the UI.** Open http://localhost:5001 → **Create account** tab. Type mismatched passwords: *"The passwords don't match."* Fix them and submit: you're signed in as the new user.
3. **Validation.** Sign out (account menu, top right) and try to create the same username in different capitals (*"…is already taken"*), a 2-character username, or a 5-character password.
4. **Sign in / out.** Sign in on the **Sign in** tab; a wrong password gives *"Incorrect username or password."* Refresh: you stay signed in.
5. **Google / GitHub.** Configure at least one provider (see above), restart, and click **Continue with Google** (or GitHub). After approving, you land in the app signed in with a username taken from your Google/GitHub account. `flask --app app users list` shows it with `google`/`github`. Sign out and continue with the same provider again: you get the same account back. Cancel on the provider's page and you return to sign-in with *"Sign-in was cancelled."*
6. **Per-account history.** Translate something, sign out, sign in as someone else: their History is separate.
7. **Translation limit.** Add `RATE_LIMIT_TRANSLATE=2 per minute` to `.env` and restart. Translate three times: the third shows *"Too many requests. Please wait … seconds"*. Another account isn't affected. Remove the line afterwards.
8. **Sign-in limit.** Enter a wrong password 6 times within a minute: the 6th attempt is blocked, even with the right password.
9. **Sign out everywhere.** While signed in, run `flask --app app users set-password <name>`, then upload, translate or play something: you're back at sign-in with *"Your session has ended."*
10. **Closed sign-up.** Add `ALLOW_SIGNUPS=0` and restart: the *Create account* tab disappears, and a Google/GitHub account that isn't registered yet is refused with *"No account is linked to that sign-in…"*. Remove the line afterwards.
11. **Share links stay public.** Open a share link in a private window: it works without signing in, while http://localhost:5001 asks you to sign in.
12. **Automated tests.** `python -m pytest` runs 124 tests. They include the full Google/GitHub flow (state check, code exchange, profile, account creation) against a fake provider started by the tests, so no real Google/GitHub account is needed.

## Project layout

```
app.py                  Flask app: JSON API + serves the built frontend
translation_service.py  OpenAI calls (transcribe, identify language, translate, speak)
share_store.py          Storage for shared translations (SQLite + MP3 files)
user_store.py           Accounts and linked Google/GitHub identities (SQLite, scrypt password hashes)
oauth_login.py          Google / GitHub sign-in (Authlib): providers, redirect, callback
languages.py            Supported languages and detected-language mapping
tests/                  pytest suite (OpenAI is faked, no network)
frontend/               React 19 + TypeScript + Vite + Tailwind CSS + Headless UI
  src/App.tsx               Page layout and state wiring
  src/state.ts              Reducer for clip → detection → translation
  src/hooks/useRecorder.ts  MediaRecorder-based microphone recording
  src/hooks/useHistory.ts   Translation history (IndexedDB)
  src/lib/                  Speech cache, shared audio player, downloads, clipboard
  src/components/           AuthGate, AuthPage, UserMenu, AudioInput, LanguagePicker,
                            ResultCard, TranslationActions, HistoryDrawer, SharedTranslationPage, …
```

## Setup

Requires Python 3.11+ and Node.js 20+.

```bash
python -m venv audiotrans
audiotrans\Scripts\activate          # macOS/Linux: source audiotrans/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env               # macOS/Linux: cp .env.example .env, then add OPENAI_API_KEY
npm --prefix frontend install
flask --app app users create <your-name>   # the first account; see "Accounts" below
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
| `DATA_DIR` | `./data` | Where accounts, shared translations and the generated session key are stored |
| `PORT` / `HOST` | `5001` / `127.0.0.1` | Server address (`HOST=0.0.0.0` to allow other devices) |
| `FLASK_DEBUG` | off | Set to `1` for auto-reload (never in production) |
| `ALLOW_SIGNUPS` | `1` | `0` lets only the admin create accounts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | Enables **Continue with Google** |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | – | Enables **Continue with GitHub** |
| `SECRET_KEY` | generated into `DATA_DIR` | Signs session cookies; set a long random value in production |
| `SESSION_DAYS` | `7` | How long a sign-in lasts without use |
| `SESSION_COOKIE_SECURE` | off | Set to `1` when served over HTTPS |
| `TRUSTED_PROXIES` | `0` | Number of reverse proxies in front of the app |
| `RATE_LIMIT_LOGIN`, `_SIGNUP`, `_OAUTH`, `_TRANSCRIBE`, `_TRANSLATE`, `_SPEECH`, `_SHARE`, `_SHARE_AUDIO` | see [Rate limits](#rate-limits) | e.g. `10 per minute; 100 per day` |
| `RATE_LIMIT_STORAGE_URI` | `memory://` | Shared counter store for several workers, e.g. `redis://…` |

## Deploying

`python app.py` uses Flask's development server. For a real deployment, run it behind a WSGI server (for example `waitress-serve --port=5001 app:app` on Windows, or gunicorn on Linux) with HTTPS, and set `SECRET_KEY`, `SESSION_COOKIE_SECURE=1` and `TRUSTED_PROXIES` as appropriate. Register the public `https://…/api/auth/oauth/<provider>/callback` URLs with Google/GitHub. Keep `DATA_DIR` on persistent storage so accounts and shared links survive redeploys.
