import js from "@eslint/js";
import globals from "globals";
import userscripts from "eslint-plugin-userscripts";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.greasemonkey,
      },
    },
  },
  {
    files: ["**/*.user.js"],
    plugins: {
      userscripts: {
        rules: userscripts.rules,
      },
    },
    rules: {
      ...userscripts.configs.recommended.rules,
    },
    settings: {
      userscriptVersions: {
        violentmonkey: "*",
      },
    },
  },
];
