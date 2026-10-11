# EmpowerZ — GenZ SoftSkills Training Platform

**Project code:** R26-SE-010

EmpowerZ is an AI-powered soft-skills coaching platform for Gen-Z professionals. It combines real-time behavioural analysis, adaptive role-play and personalised learning paths, built around four modules:

| Module | What it does |
|---|---|
| **MCA** — Multimodal Coaching Assistant | Live coaching from webcam + microphone. MediaPipe face mesh (head pose, EAR/MAR) and audio features (pitch, volume, pace, clarity, speech emotion) are fused into real-time nudges over a WebSocket. Also runs the baseline assessment. |
| **RPE** — Role-Play Engine | Voice-based conversations with LLM-driven NPCs across conflict scenarios, with emotion/escalation tracking, a 3D talking-head avatar, TTS/STT and post-session feedback. |
| **APA** — Adaptive Pedagogy / Training Plans | Builds a personalised training plan from the OCEAN personality survey, baseline results and session history; adjusts difficulty dynamically and recommends scenarios. |
| **FSPA** — Feedback, Sentiment, Prediction & Analytics | Session metrics, feedback sentiment, skill scores, progress trends, blind-spot detection, predicted outcomes and LLM mentoring recommendations. |

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + Uvicorn (Python 3.12), SQLAlchemy 2.0, Alembic |
| Database / Auth | PostgreSQL via Supabase, Supabase Auth (JWT) |
| Frontend | React 18 + Vite 5, React Router 7, TailwindCSS + shadcn/ui, Framer Motion |
| Computer vision | MediaPipe Face Mesh (in the browser) |
| Audio / SER | librosa features, fine-tuned **wav2vec2** speech-emotion model (SVM and CNN paths kept as alternatives — see `Backend/app/models/affect_fusion/model_config.json`) |
| LLMs | Google Gemini, OpenAI, Groq |
| Speech | Google Cloud TTS (Chirp 3 HD), STT endpoints, TalkingHead avatar |
| DevOps | Docker, GitHub Actions, GHCR, Nginx |

---

## Repository layout

```
R26-SE-010/
├── Backend/                  FastAPI backend
│   ├── app/
│   │   ├── api/v1/           Route handlers: auth, mca/, rpe/, analytics/, pedagogy, training_plan, survey
│   │   ├── services/         Business logic (RPE, pedagogy, analytics, TTS …)
│   │   ├── models/           ORM models + ML artifacts (affect_fusion/, rpe/)
│   │   ├── schemas/          Pydantic request/response schemas
│   │   ├── contracts/        Shared data contracts between modules
│   │   ├── core/             Auth, LLM clients, rate limiter, Supabase client
│   │   └── main.py           FastAPI app entry point
│   ├── migrations/           Alembic migrations
│   ├── tests/                pytest suite
│   ├── docker-compose.yml    Local API + Postgres
│   └── requirements.txt
├── frontend/                 React + Vite SPA (pages, components, services, MediaPipe utils)
├── training/                 ML training pipelines (affect_fusion, rpe, feedback_analytics)
├── .github/workflows/        CI and deploy pipelines
├── docker-compose.prod.yml   Production stack (web + api + db)
└── nginx.conf                Reverse proxy config for the web container
```

---

## Getting started

### Prerequisites

- Python 3.12
- Node.js 18+
- A Supabase project (database + auth)
- API keys for Gemini (required), and optionally OpenAI, Groq and Google Cloud TTS

### 1. Backend

```bash
cd Backend

python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux

pip install -r requirements.txt

cp .env.example .env           # then fill in the values (see below)

alembic upgrade head           # apply database migrations
uvicorn app.main:app --reload --port 8000
```

Check it's running:

```bash
curl http://localhost:8000/health
```

Interactive API docs are at http://localhost:8000/docs.

Alternatively, run the API and a local Postgres with Docker:

```bash
cd Backend
docker compose up --build
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev                    # http://localhost:5173
```

### Environment variables

**Backend (`Backend/.env`)**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Supabase **Session Pooler** URL) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Supabase project credentials (Project Settings → API) |
| `GEMINI_API_KEY`, `GEMINI_API_KEY_APM` | Gemini for MCA chat / RPE NPCs and for APA |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MENTORING_MODEL`, `LLM_MENTORING_TIMEOUT_S` | LLM mentoring recommendations (FSPA) |
| `GROQ_API_KEY` | Groq LLM provider |
| `GOOGLE_CLOUD_API_KEY` | Google Cloud TTS / STT |
| `APM_SERVICE_TOKEN`, `RPE_BASE_URL` | Service-to-service calls between RPE and APA |
| `FRONTEND_URL` | Allowed CORS origin |
| `APP_NAME`, `APP_ENV`, `DEBUG`, `SECRET_KEY` | App settings |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Used by the Docker Postgres container |

**Frontend (`frontend/.env`)**

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend URL, e.g. `http://localhost:8000` |
| `VITE_WS_URL` | WebSocket URL, e.g. `ws://localhost:8000` |
| `VITE_MEDIAPIPE_FACE_MESH_URL` | MediaPipe face mesh asset CDN |
| `VITE_AVATAR_URL` | 3D avatar model for RPE |
| `VITE_RPE_TTS_PROVIDER` | `managed` (Chirp 3 HD with fallbacks) or `google` |

> For local development, disable email confirmation in Supabase (**Authentication → Settings → Email Auth**) so sign-up returns tokens immediately.

### ML model artifacts

The speech-emotion models live in `Backend/app/models/affect_fusion/`. Which one is loaded is controlled by `model_config.json` (currently **wav2vec2**). Training scripts and notebooks for all models are in `training/`.

---

## API overview

All routes are served under `/api/v1` unless noted. Full, live documentation is at `/docs`.

| Prefix | Module | Highlights |
|---|---|---|
| `/auth` | Auth | `signup`, `signin`, `refresh`, `signout`, `me`, `password-reset` |
| `/mca` | MCA | `POST /chat/`, `WS /audio/audio-analysis` (JWT via `?token=`), `/sessions/*`, `POST /stt/transcribe` |
| `/rpe` | Role-Play Engine | `/scenarios/*`, `start-session`, `from-plan/{plan_id}`, `session-respond`, `session-summary/{id}`, `session-feedback/{id}`, `my-sessions` |
| `/apa` | Pedagogy / Training plans | `plan/generate`, `plan/me`, `session-feedback`, `live-signals`, `baseline/*`, `learner-profile/me`, training-plan reads |
| `/analytics` | FSPA | session metrics, feedback + sentiment, predictions, skill scores, progress trends, blind spots, reports, mentoring recommendations |
| `/survey` | Personality survey | OCEAN survey submit / fetch |
| `/api/gtts`, `/api/stt`, `/api/tts/speak` | Speech | TTS and STT helpers (outside `/v1`) |
| `/health` | — | Health check incl. database and auth config status |

---

## Testing

```bash
# Backend
cd Backend
pytest

# Frontend
cd frontend
npm run test
```

---

## CI/CD

- **CI** (`.github/workflows/ci.yml`) — runs on every pull request and on pushes to `main`: builds and tests the frontend, runs the backend pytest suite, and checks that both Docker images build.
- **Deploy** (`.github/workflows/deploy.yml`) — on pushes to `main`: runs CI, builds and pushes the `web` and `api` images to GitHub Container Registry, then SSHes into the VPS and starts them with `docker-compose.prod.yml`. If the new release isn't healthy, it rolls back to the previous image tag automatically. In production, Nginx serves the frontend and proxies the API. ML models and the Google Cloud TTS key are mounted from the server rather than baked into the image.

### Branching

Work happens on `feature/<issue>-<name>` branches, which merge into `dev` and then from `dev` into `main` via pull requests. Pushing to `main` deploys to production.

---

## Troubleshooting (database)

| Error | Fix |
|---|---|
| `SSL connection required` | Already handled — `sslmode=require` is set in the engine config |
| `password authentication failed` | URL-encode special characters in your password: `%` → `%25`, `#` → `%23`, `@` → `%40` |
| `could not translate host name` | The direct connection is IPv6-only on the free tier — use the **Session Pooler** URL from Supabase Dashboard → Database |
| `connection timeout` | Supabase may be blocking your IP — check Dashboard → Settings → Database → Network restrictions |
