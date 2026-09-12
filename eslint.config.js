import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "worker-configuration.d.ts", ".wrangler"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**", "*.ts", "*.tsx", "*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // The Cloudflare Worker runs in the Workers runtime, not the browser.
    files: ["worker/**"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    // The service worker is plain JS with service-worker globals.
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    // Node build tooling (ESM), not shipped to the browser.
    files: ["scripts/**"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  prettier,
);
