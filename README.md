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
# Edit .env and fill in DATABASE_URL and ANTHROPIC_API_KEY

# Start the server
uvicorn app.main:app --reload
```

Test the health endpoint:
```bash
curl http://localhost:8000/health
# {"status":"ok","app":"adaptive-training-backend","env":"development"}
```