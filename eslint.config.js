"use strict";

const globals = require("globals");

const sharedRules = {
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-unreachable": "error",
  "no-unsafe-finally": "error",
  "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }]
};

module.exports = [
  { ignores: ["node_modules/**", "data/**"] },
  {
    files: ["client/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.browser }
    },
    rules: sharedRules
  },
  {
    files: ["client/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: sharedRules
  },
  {
    files: ["server/**/*.js", "tools/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: sharedRules
  }
];
