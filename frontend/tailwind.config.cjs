/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        // ───────── Legacy aliases (kept so existing utilities still resolve)
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
          // ───────── New prototype tokens (extend the legacy object)
          hover: "var(--accent-hover)",
          soft:  "var(--accent-soft)",
          muted: "var(--accent-muted)",
        },
        success: {
          DEFAULT: "var(--success)",
          foreground: "white",
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "white",
        },
        emotion: {
          DEFAULT: "var(--emotion)",
          foreground: "white",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },

        // ───────── New prototype tokens — surfaces, borders, text, semantics, charts
        canvas:   "var(--bg-canvas)",
        surface:  "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        // 'input' (legacy) maps to var(--input) which now points to --bg-input,
        // so 'bg-input' resolves to the form-input surface as the prototype intends.
        "border-subtle":  "var(--border-subtle)",
        "border-default": "var(--border-default)",
        "border-strong":  "var(--border-strong)",
        "border-focus":   "var(--border-focus)",
        "t-primary":    "var(--text-primary)",
        "t-secondary":  "var(--text-secondary)",
        "t-tertiary":   "var(--text-tertiary)",
        "t-quaternary": "var(--text-quaternary)",
        danger: "var(--danger)",
        info:   "var(--info)",
        "chart-1": "var(--chart-1)",
        "chart-2": "var(--chart-2)",
        "chart-3": "var(--chart-3)",
        "chart-4": "var(--chart-4)",
        "chart-5": "var(--chart-5)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      transitionTimingFunction: {
        signature: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '250ms',
        slow: '400ms',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
