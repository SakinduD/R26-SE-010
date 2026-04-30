Frontend (React + Tailwind) scaffold

Quick start

1. cd frontend
2. npm install
3. npm run dev

Notes
- This scaffolds a Vite React (JS) app with Tailwind configured.
- Pages live under `src/pages` with grouped folders (example: `src/pages/admin/dashboard`).
- Reusable components live under `src/components` with grouped folders (example: `src/components/admin`).

Project structure (important folders)

- `src/pages`: Top-level page routes grouped by feature/area.
- `src/components`: Reusable UI components (grouped, e.g. `admin`, `ui`).
- `src/services`: API and network helpers (see below).

Services folder

All API calls and network helpers are centralized under `src/services` to keep side-effect logic separated from UI code. This makes components easier to test and reuse.

Typical files added here:

- `src/services/api.js`: An `axios` instance configured with the app base URL and sensible defaults.
- `src/services/authService.js`: Example service exposing login/profile functions.
- `src/services/index.js`: Barrel file exporting available services for easier imports.

Usage examples

Import a specific service where needed:

```js
import { authService } from './src/services'

// call login
await authService.login({ email, password })
```

Or import the API instance directly:

```js
import { api } from './src/services'

const resp = await api.get('/some/endpoint')
```

Environment

- Use `VITE_API_BASE_URL` to configure the API base URL for different environments (dev/staging/prod). Vite will expose it as `import.meta.env.VITE_API_BASE_URL`.

Optional next steps

- Move any existing inline fetch/axios calls from components into the `src/services` helpers.
- Add error handling, token refresh, and request interceptors to `src/services/api.js`.

If you want, I can migrate existing API calls from components into `src/services` for you.
