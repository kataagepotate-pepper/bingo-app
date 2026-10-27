-- ビンゴ大会のデータベース定義
-- Supabase では「SQL Editor」にこのファイルの中身を貼り付けて実行する。
-- 何度実行しても壊れないように if not exists を付けている。

create table if not exists games (
  id            text primary key,                 -- 大会コード（6文字）
  title         text not null,
  host_key_hash text not null,                    -- 司会用の合言葉（ハッシュ化して保存）
  drawn         smallint[] not null default '{}', -- 引いた番号（引いた順）
  status        text not null default 'open',     -- open / ended
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists cards (
  id         uuid primary key,
  game_id    text not null references games(id) on delete cascade,
  name       text not null,
  numbers    smallint[] not null,                 -- 25マス（左上から横向き、真ん中は0=FREE）
  token_hash text not null,                       -- 本人確認用（ハッシュ化して保存）
  created_at timestamptz not null default now()
);
create index if not exists cards_game_idx on cards (game_id);

create table if not exists winners (
  id         bigserial primary key,
  game_id    text not null references games(id) on delete cascade,
  card_id    uuid not null references cards(id) on delete cascade,
  name       text not null,
  draw_count int not null,                        -- 何個目の番号でビンゴしたか
  created_at timestamptz not null default now(),
  constraint winners_game_card_unique unique (game_id, card_id) -- 同じ大会・同じカードは1件だけ
);

-- 大会の作りすぎ防止・古い大会の自動削除用
alter table games add column if not exists creator_ip_hash text;
create index if not exists games_creator_idx on games (creator_ip_hash, created_at);
create index if not exists games_created_idx on games (created_at);

-- 抽選中（ドラムロール中）の管理と、映写画面のQRコード表示（2026-10-20 追加）
alter table games add column if not exists reveal_at timestamptz;
alter table games add column if not exists show_qr boolean not null default true;

-- Supabase の公開API（anonキー）からは一切読めないようにする。
-- サーバー（Netlify Functions）はデータベースに直接つなぐのでこの制限を受けない。
alter table games   enable row level security;
alter table cards   enable row level security;
alter table winners enable row level security;
