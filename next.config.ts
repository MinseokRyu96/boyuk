import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/*
 * SEED는 번들러에 "seed-layered" 조건을 넣으면 컴포넌트 CSS를 @layer로 감싼 버전을 쓴다.
 * Turbopack에는 이 조건 옵션이 없어서, 같은 효과를 내도록 recipe 모듈을 레이어 버전으로 직접 연결한다.
 *   @seed-design/css/recipes/badge  ->  @seed-design/css/recipes/badge.layered
 * 이게 없으면 SEED 컴포넌트 CSS가 레이어 밖에 있어 Tailwind 클래스로 덮어쓸 수 없다.
 * SEED의 recipe 구조가 바뀌면 깨질 수 있으니 SEED를 올릴 때 다시 확인한다.
 */
const recipesDir = path.join(process.cwd(), "node_modules/@seed-design/css/recipes");
const seedLayeredAlias: Record<string, string> = fs.existsSync(recipesDir)
  ? Object.fromEntries(
      fs
        .readdirSync(recipesDir)
        .filter((file) => file.endsWith(".layered.mjs"))
        .map((file) => file.replace(/\.layered\.mjs$/, ""))
        .map((name) => [`@seed-design/css/recipes/${name}`, `@seed-design/css/recipes/${name}.layered`]),
    )
  : {};

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    resolveAlias: seedLayeredAlias,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
