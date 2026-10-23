-- 지도 보기: 공고의 위치(좌표) 저장 (0001을 고치지 않고 새 번호로 추가한다)
--
-- * lat·lng는 카카오 장소 검색으로 찾은 어린이집 위치다 (WGS84, 위도·경도). 수집기(service_role)만 채운다.
-- * geo_status: 'ok' = 위치를 찾음, 'not_found' = 찾아봤지만 못 찾음, null = 아직 찾아보지 않음.
--   못 찾은 공고는 geocoded_at으로 일정 기간 뒤에 다시 시도한다.
-- * geo_place: 어떤 장소로 찾았는지 사람이 확인할 수 있게 "장소명 · 주소"를 남긴다.
-- * 한반도 밖의 값이나 반쪽짜리 좌표가 들어가지 않도록 검사를 둔다.

alter table jobs
  add column lat          double precision,
  add column lng          double precision,
  add column geo_status   text,
  add column geocoded_at  timestamptz,
  add column geo_place    text,
  add constraint jobs_geo_status_check check (geo_status in ('ok', 'not_found')),
  -- 둘 다 없거나, 둘 다 있고 한반도 안이어야 한다. (is not null을 빼면 한쪽이 null일 때 검사가 null이 되어 통과해 버린다)
  add constraint jobs_geo_range_check check (
    (lat is null and lng is null)
    or (lat is not null and lng is not null and lat between 33 and 39 and lng between 124 and 132)
  ),
  add constraint jobs_geo_ok_check check (geo_status is distinct from 'ok' or lat is not null);

-- 위치를 아직 찾지 않았거나 다시 찾아볼 공고를 빨리 고르기 위한 인덱스
create index jobs_geo_pending_idx on jobs (geo_status, geocoded_at) where is_active;

-- 피드 조회에 위치를 더한다. 반환 열이 늘어나서 함수를 다시 만든다 (기존 호출은 그대로 동작한다).
-- 묶인 공고의 위치는 좌표가 있는 행 중 가장 먼저 수집된 것의 값이다 (위도·경도를 같은 행에서 가져온다).
drop function get_feed(timestamptz, text, int);

create function get_feed(
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
  first_seen_at timestamptz,
  lat           double precision,
  lng           double precision
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
      min(v.first_seen_at)                                      as first_seen_at,
      (array_agg(v.lat order by (v.lat is null), v.first_seen_at, v.id))[1] as lat,
      (array_agg(v.lng order by (v.lat is null), v.first_seen_at, v.id))[1] as lng
    from visible v
    group by v.gkey
  )
  select g.group_key, g.title, g.org_name, g.region, g.url, g.deadline,
         g.is_workplace, g.sources, g.first_seen_at, g.lat, g.lng
  from grouped g
  where p_cursor_at is null
     or (g.first_seen_at, g.group_key) < (p_cursor_at, p_cursor_key)
  order by g.first_seen_at desc, g.group_key desc
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function get_feed(timestamptz, text, int) to anon, authenticated;
