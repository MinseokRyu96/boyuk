-- 어린이집 공고 모아보기: 초기 스키마 (PRD 7장·부록 A)

create table jobs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  source_id     text not null,
  title         text not null,
  org_name      text,
  region        text,
  deadline      date,
  url           text not null,
  is_workplace  boolean not null default false,
  dedupe_key    text,
  is_active     boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (source, source_id)
);

create index jobs_feed_idx   on jobs (is_active, first_seen_at desc);
create index jobs_dedupe_idx on jobs (dedupe_key);

create table collector_runs (
  id            bigint generated always as identity primary key,
  source        text not null,
  started_at    timestamptz not null default now(),
  status        text not null check (status in ('success', 'failed')),
  fetched_count int  not null default 0,
  saved_count   int  not null default 0,
  error_message text
);

create index collector_runs_source_idx on collector_runs (source, started_at desc);

-- 일반 사용자는 활성 공고 읽기만 허용하고, 쓰기는 service role로만 한다.
-- collector_runs는 정책을 만들지 않아 anon으로는 읽을 수 없다.
alter table jobs enable row level security;
alter table collector_runs enable row level security;

create policy "public read active jobs" on jobs
  for select using (is_active = true);

-- Data API 권한을 Supabase 기본값에 기대지 않고 명시한다.
-- 공개 사용자(anon, authenticated)는 jobs 읽기만 가능하고(행은 위 정책이 활성 공고로 제한),
-- 쓰기는 수집기가 쓰는 service_role만 한다. collector_runs는 service_role 외에는 접근할 수 없다.
grant select on jobs to anon, authenticated;
grant select, insert, update, delete on jobs to service_role;
grant select, insert, update, delete on collector_runs to service_role;

-- 피드 조회: 같은 공고를 한 카드로 묶고 최신 등록순으로 돌려준다.
--
-- * 마감일이 지난 공고, 마감일이 없고 최초 수집 후 30일이 지난 공고는 is_active와 상관없이 숨긴다.
--   (수집이 멈춰 is_active 갱신이 늦어져도 화면에는 만료 공고가 나오지 않게 하기 위해서)
-- * 같은 dedupe_key라도 같은 출처의 서로 다른 공고(같은 어린이집이 같은 마감일로 올린 1세반·3세반 담임 등)는
--   합치지 않는다. 출처별로 순번(slot)을 매겨 "출처마다 첫 번째 공고끼리, 두 번째 공고끼리" 묶는다.
-- * 커서는 (first_seen_at, group_key) 쌍이다. 한 번의 수집에서 저장된 공고는 first_seen_at이 같을 수 있어
--   시각만으로 끊으면 페이지 경계에서 공고가 빠진다.
create or replace function get_feed(
  p_cursor_at  timestamptz default null,
  p_cursor_key text        default null,
  p_limit      int         default 20
)
returns table (
  group_key     text,
  title         text,
  org_name      text,
  region        text,
  url           text,
  deadline      date,
  is_workplace  boolean,
  sources       text[],
  first_seen_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with visible as (
    select
      j.*,
      case
        when j.dedupe_key is null then j.id::text
        else j.dedupe_key || ':' ||
             row_number() over (partition by j.dedupe_key, j.source order by j.first_seen_at, j.id)
      end as gkey
    from jobs j
    where j.is_active
      and (
        (j.deadline is not null and j.deadline >= (now() at time zone 'Asia/Seoul')::date)
        or (j.deadline is null and j.first_seen_at > now() - interval '30 days')
      )
  ),
  grouped as (
    select
      v.gkey                                                    as group_key,
      (array_agg(v.title    order by v.first_seen_at, v.id))[1] as title,
      (array_agg(v.org_name order by v.first_seen_at, v.id))[1] as org_name,
      (array_agg(v.region   order by v.first_seen_at, v.id))[1] as region,
      (array_agg(v.url      order by v.first_seen_at, v.id))[1] as url,
      min(v.deadline)                                           as deadline,
      bool_or(v.is_workplace)                                   as is_workplace,
      array_agg(distinct v.source order by v.source)            as sources,
      min(v.first_seen_at)                                      as first_seen_at
    from visible v
    group by v.gkey
  )
  select g.group_key, g.title, g.org_name, g.region, g.url, g.deadline,
         g.is_workplace, g.sources, g.first_seen_at
  from grouped g
  where p_cursor_at is null
     or (g.first_seen_at, g.group_key) < (p_cursor_at, p_cursor_key)
  order by g.first_seen_at desc, g.group_key desc
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function get_feed(timestamptz, text, int) to anon, authenticated;

-- 피드 상단 "N분 전 업데이트"용. collector_runs를 익명 사용자에게 열지 않으려고 이 함수만 노출한다.
create or replace function last_collected_at()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(started_at) from collector_runs where status = 'success';
$$;

revoke execute on function last_collected_at() from public;
grant execute on function last_collected_at() to anon, authenticated;

-- 수집이 끝날 때마다 호출하는 마감 처리 (PRD 6장). service role만 실행한다.
create or replace function deactivate_expired_jobs()
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected int;
begin
  update jobs
     set is_active = false
   where is_active
     and (
       (deadline is not null and deadline < (now() at time zone 'Asia/Seoul')::date)
       or (deadline is null and first_seen_at < now() - interval '30 days')
     );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function deactivate_expired_jobs() from public, anon, authenticated;
grant execute on function deactivate_expired_jobs() to service_role;
