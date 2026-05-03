Genz SoftSkills Training

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

## Troubleshooting (Database)

| Error | Fix |
|---|---|
| `SSL connection required` | Already handled — `sslmode=require` is set in the engine config |
| `password authentication failed` | URL-encode special chars in your password: `%` → `%25`, `#` → `%23`, `@` → `%40` |
| `could not translate host name` | Direct connection is IPv6-only on free tier — use the **Session Pooler** URL from Supabase Dashboard → Database → Session pooler |
| `connection timeout` | Supabase may be blocking your IP — check Dashboard → Settings → Database → Network restrictions |