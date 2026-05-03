# Adaptive Coach — Frontend

React + Vite frontend for the AI soft-skill training platform.
Requires the FastAPI backend running on `localhost:8000`.

---

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local      # already set to http://localhost:8000
npm run dev                      # → http://localhost:5173
```

The backend must be running first:
```bash
cd Backend && uvicorn app.main:app --reload
```

---

## Folder structure

```
src/
├── lib/
│   ├── config.js               API base URL from env
│   ├── animations.js           Shared framer-motion variants
│   ├── api/
│   │   ├── client.js           Axios instance + token refresh interceptor
│   │   └── auth.js             Typed auth API functions
│   ├── auth/
│   │   ├── context.jsx         AuthProvider + useAuth() hook
│   │   ├── storage.js          localStorage token helpers
│   │   └── useProtectedRoute.js Redirect-to-signin hook
│   └── validation/
│       └── auth.js             Zod schemas for all auth forms
├── components/
│   ├── ui/
│   │   ├── logo.jsx            Gradient wordmark
│   │   ├── background-gradient.jsx  Animated orb backdrop
│   │   ├── auth-card.jsx       Glass card wrapper for auth pages
│   │   ├── animated-input.jsx  Input with label, error, password toggle
│   │   └── loading-button.jsx  Button with spinner state
│   └── auth/
│       └── auth-divider.jsx    "or" separator
├── pages/
│   ├── Landing.jsx             Public hero page
│   ├── auth/
│   │   ├── AuthLayout.jsx      Shared layout for all auth pages
│   │   ├── SignUp.jsx
│   │   ├── SignIn.jsx
│   │   ├── ForgotPassword.jsx
│   │   ├── VerifyEmail.jsx
│   │   └── AuthCallback.jsx    Handles Supabase email link redirects
│   └── app/
│       ├── AppLayout.jsx       Protected layout with top nav
│       └── Dashboard.jsx       Post-login home
└── App.jsx                     Router + AuthProvider + Toaster
```

---

## Auth flow

```
User visits /signup or /signin
        │
        ▼
Supabase Auth (via backend proxy)
        │  POST /api/v1/auth/signup or /signin
        │  ← { access_token, refresh_token, user }
        │
AuthProvider stores tokens in localStorage
AuthProvider sets user state
        │
        ▼
useProtectedRoute() on every /dashboard page
  → if !isAuthenticated → redirect /signin
  → if isLoading        → show skeleton

On 401 response from any API call:
  authClient interceptor → POST /api/v1/auth/refresh
  → success: retry original request with new token
  → failure: clearTokens() + redirect /signin
```

---

## How to use `useAuth()` in a new page

```jsx
import { useAuth } from '@/lib/auth/context';

export default function MyPage() {
  const { user, isAuthenticated, signOut } = useAuth();
  return <div>Hello {user?.display_name}</div>;
}
```

---

## How to make authenticated API calls

All calls through `authClient` automatically attach the Bearer token:

```jsx
import { authClient } from '@/lib/api/client';

// GET request (token attached automatically)
const profile = await authClient.get('/api/v1/auth/me').then(r => r.data);

// POST request
const result = await authClient.post('/api/v1/survey/submit', payload).then(r => r.data);
```

For existing analytics services, swap `api` (from `src/services/api.js`) for
`authClient` to get token injection with no other changes.

---

## How to add a new protected page

1. Create `src/pages/app/MyFeature.jsx`
2. Add the route inside the `<AppLayout />` group in `App.jsx`:

```jsx
<Route element={<AppLayout />}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/my-feature" element={<MyFeature />} />  {/* ← add here */}
</Route>
```

`AppLayout` calls `useProtectedRoute()` internally — no extra work needed.

---

## How to add a new public auth page

1. Create `src/pages/auth/MyPage.jsx`
2. Add inside the `<AuthLayout />` group in `App.jsx`:

```jsx
<Route element={<AuthLayout />}>
  <Route path="/my-page" element={<MyPage />} />
</Route>
```

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | FastAPI backend URL |
| `VITE_WS_URL` | `ws://localhost:8000` | WebSocket for MCA audio |
