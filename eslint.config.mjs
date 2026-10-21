import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 일부러 쓰지 않는 인자는 이름 앞에 _를 붙인다 (가짜 함수의 자리 채움 인자 등)
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // SEED CLI가 생성하는 스니펫. 다시 받으면 덮어써지므로 직접 고치지 않고 린트에서 뺀다
    "seed-design/**",
  ]),
]);

export default eslintConfig;
