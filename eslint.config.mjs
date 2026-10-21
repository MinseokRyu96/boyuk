import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
