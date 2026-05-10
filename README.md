Genz SoftSkills Training Platform

## Run locally (Backend)

```bash
cd Backend

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and fill in DATABASE_URL and GEMINI_API_KEY

# Start the server
uvicorn app.main:app --reload
```

Test the health endpoint:
```bash
curl http://localhost:8000/health
# {"status":"ok","app":"genz-softskills-api","env":"development","database":{"connected":true,"error":null}}
```

## Authentication

### Setup

1. **Get Supabase credentials** — open your project in the Supabase Dashboard and navigate to **Project Settings → API**:
   - Copy **Project URL** → `SUPABASE_URL`
   - Copy **anon / public** key → `SUPABASE_ANON_KEY`
   - Copy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` *(keep this secret — server-side only)*
   - Copy **JWT Secret** (under **JWT Settings**) → `SUPABASE_JWT_SECRET`

2. Add them to your `.env` file (see `.env.example` for the exact variable names).

3. **For local dev — disable email confirmation** so signup returns tokens immediately:
   Supabase Dashboard → **Authentication → Settings → Email Auth** → uncheck **"Enable email confirmations"**.
   *(Alternatively, confirm via the Supabase Dashboard: Authentication → Users → click the user → "Confirm user".)*

### How auth works

```
Browser / client
  │
  ├─ POST /api/v1/auth/signup  ──► Supabase Admin API creates auth.users row
  │                               Backend creates matching `users` profile row
  │                               Returns {access_token, refresh_token}
  │
  ├─ POST /api/v1/auth/signin  ──► Supabase verifies password
  │                               Returns {access_token, refresh_token}
  │
  └─ GET  /api/v1/auth/me      ──► Backend verifies JWT (HS256, SUPABASE_JWT_SECRET)
       Authorization: Bearer <token>   Extracts user_id from sub claim
                                       Auto-creates users row if missing (first login)
                                       Returns profile
```

Passwords are owned exclusively by Supabase — they are never stored or logged by this backend.

### curl examples

```bash
# Sign up
curl -s -X POST http://localhost:8000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"securepass123","display_name":"Test User"}'

# Sign in — copy access_token from the response
curl -s -X POST http://localhost:8000/api/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"securepass123"}'

# Get current user profile (replace <access_token>)
curl http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer <access_token>"

# Refresh tokens
curl -s -X POST http://localhost:8000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<refresh_token>"}'

# Sign out
curl -s -X POST http://localhost:8000/api/v1/auth/signout \
  -H "Authorization: Bearer <access_token>"

# Request password reset email
curl -s -X POST http://localhost:8000/api/v1/auth/password-reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Health check (includes auth config status)
curl http://localhost:8000/health
```

---

## Troubleshooting (Database)

| Error | Fix |
|---|---|
| `SSL connection required` | Already handled — `sslmode=require` is set in the engine config |
| `password authentication failed` | URL-encode special chars in your password: `%` → `%25`, `#` → `%23`, `@` → `%40` |
| `could not translate host name` | Direct connection is IPv6-only on free tier — use the **Session Pooler** URL from Supabase Dashboard → Database → Session pooler |
| `connection timeout` | Supabase may be blocking your IP — check Dashboard → Settings → Database → Network restrictions |