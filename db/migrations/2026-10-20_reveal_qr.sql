-- 2026-10-20：抽選中（ドラムロール中）の管理と、映写画面のQRコード表示のための項目を追加
-- Supabase の SQL Editor に貼って Run する（何度実行しても大丈夫）
alter table games add column if not exists reveal_at timestamptz;
alter table games add column if not exists show_qr boolean not null default true;
