Frontend (React + Tailwind) scaffold

Quick start

1. cd frontend
2. npm install
3. npm run dev

Notes
- This scaffolds a Vite React (JS) app with Tailwind configured.
- Pages live under `src/pages` with grouped folders (example: `src/pages/admin/dashboard`).
- Reusable components live under `src/components` with grouped folders (example: `src/components/admin`).

chadcn / shadcn integration

If you want to use the shadcn UI (commonly used with Tailwind), follow their docs. Typical steps:

- Install any required packages, e.g.:

  npm install class-variance-authority @radix-ui/react-* lucide-react

- Run the shadcn helper if you prefer to scaffold components:

  npx shadcn-ui@latest init

After that, copy generated UI components into `src/components/ui` and adjust Tailwind config as needed.

If you'd like, I can:
- Install and configure shadcn for you (add its dependencies and example components), or
- Add more page/component examples.

Tell me which one you want next.
