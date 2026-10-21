@AGENTS.md

# 보육공고 (어린이집 신입·담임교사 공고 모아보기)

기획은 `/Users/minseok/Desktop/md/PRD_어린이집_공고_모아보기.md`를 따른다. 모든 글(주석·문구·커밋)은 한글로 쓴다.

## 명령어

- `npm run dev` 개발 서버, `npm run build` 빌드, `npm test` 단위 테스트(vitest), `npm run typecheck`, `npm run lint`
- `npm test`에는 마이그레이션 SQL을 로컬 Postgres(PGlite)에 적용해 검증하는 `supabase/get-feed.test.ts`가 들어 있다. SQL을 고치면 반드시 돌린다.

## 구조

- `app/page.tsx` 피드(서버에서 첫 20건을 `use cache`로 조회), `app/api/jobs` 다음 페이지, `app/api/cron/[source]` 수집 엔드포인트
- `lib/collectors/` 소스별 수집기. 지금은 모두 `pending(...)`이라 501을 돌려준다. 실제 수집기로 바꿔 끼우는 곳은 `lib/collectors/index.ts`
- `lib/normalize.ts` 신입·담임 판별, `lib/dedupe.ts` 중복 키, `supabase/migrations/` 스키마와 조회 함수

## 알아둘 것

- `SUPABASE_URL`·`SUPABASE_ANON_KEY`가 없으면 피드는 샘플 데이터(`lib/sample-jobs.ts`)로 동작하고 화면에 안내가 뜬다.
- PRD와 다르게 한 곳: 같은 출처의 서로 다른 공고는 합치지 않고(출처별 순번으로 묶음), 커서는 `(first_seen_at, group_key)` 쌍이며, 마감일이 없으면 `dedupe_key`가 null이다. D-day 칩은 카드 오른쪽 위에 두고 오늘 마감은 "오늘마감"으로 쓴다.
- Tailwind 새 클래스가 개발 서버에서 안 보이면 서버를 다시 띄운다(운영 빌드에는 영향 없음).
