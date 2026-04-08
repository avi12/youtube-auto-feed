import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import perfectionist from "eslint-plugin-perfectionist";
import {
  globalIgnores 
} from "eslint/config";
import globals from "globals";
import tsEslint from "typescript-eslint";

export default [
  globalIgnores([".wxt/**", ".output/**"]),
  eslint.configs.recommended,
  ...tsEslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsEslint.parser,
      globals: {
        ...globals.browser,
        chrome: true
      }
    }
  },
  {
    files: ["**/*.{ts,js}"],
    ignores: ["src/**"],
    languageOptions: {
      parser: tsEslint.parser,
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ["**/*.{ts,js}"],
    plugins: {
      perfectionist,
      "@stylistic": stylistic
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", {
        assertionStyle: "never" 
      }],
      "id-length": ["error", {
        min: 3,
        exceptions: ["_", "e", "i", "yt"],
        properties: "never" 
      }],
      "@stylistic/semi": ["error"],
      "perfectionist/sort-imports": ["error", {
        internalPattern: ["^@/"],
        newlinesBetween: 0 
      }],
      curly: ["error", "all"],
      "no-empty": ["error", {
        allowEmptyCatch: true
      }],
      "@stylistic/comma-dangle": ["error", "never"],
      "@stylistic/brace-style": ["error", "1tbs"],
      "@stylistic/indent": ["error", 2],
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/object-curly-newline": ["error", {
        multiline: true,
        minProperties: 4
      }],
      "@stylistic/object-property-newline": ["error", {
        allowAllPropertiesOnSameLine: true
      }],
      "@stylistic/arrow-parens": ["error", "as-needed"],
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.property.name='forEach']",
          message: "Use for...of instead of .forEach()"
        },
        {
          selector: "CallExpression[callee.property.name='appendChild']",
          message: "Use .append() instead of .appendChild()"
        }
      ],
      "no-nested-ternary": "error",
      "@stylistic/padding-line-between-statements": ["error", {
        blankLine: "always",
        prev: "if",
        next: "*"
      }]
    }
  }
];
