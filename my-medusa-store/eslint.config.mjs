import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  // Ignore files that you don't want to lint
  {
    ignores: ["node_modules/", "dist/", "build/", ".next/", ".medusa/", "src/scripts", "integration-tests/http", "src/modules/assistant/__tests__"],
  },

  // Apply recommended JavaScript rules
  js.configs.recommended,

  // Apply recommended TypeScript rules
  ...tseslint.configs.recommended,

  // Configure global variables for your environment
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
