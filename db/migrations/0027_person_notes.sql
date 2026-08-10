-- =============================================================
-- 0027 候補者メモ（追記専用）
--
-- 依頼者の指示（実行⑪）――
--   「個人アプローチのタブ内で、名前を押したらメモというボタンが出て、
--     押したらポップアップでメモが書けて、
--     **書いた人、日時、内容を記入必須**にして」
--
-- ★ なぜ既存の `persons.note` では足りないか
--
--   `persons.note` は**現在値1つ**である。上書きすると前に書いたものが消え、
--   誰がいつ書いたかも残らない。編集履歴は `person_profile_revisions`（0018）
--   に積まれるが、あれは**プロフィールの変更履歴**であって、
--   「面談でこう言っていた」を1件ずつ積む場所ではない。
--
--   メモは1件が1つの事実である。上書きの列に押し込むと、
--   2人が同じ日に別のことを書いた時点でどちらかが消える。
--
-- ★ 書いた人が**手入力**である理由
--
--   合言葉は層ごとに1つで、層の中では**誰が入ったか記録されない**
--   （`src/auth/tiers.ts`）。記録層に「操作した人」を書ける根拠が無い。
--   ここで `staffs` への参照を作ると、**選んだ名前が「その人が書いた証拠」に
--   見えてしまう。** 実際には誰でも他人の名前を選べる。
--
--   依頼者の判断は「手入力」（実行⑪）。名乗った名前をそのまま残す。
--   `staffs` への FK にしない ―― 名簿に無い人（外部の面談者）も書くうえ、
--   名簿を選ばせると「本人確認済み」という誤った含みが付く。
--   **これは署名ではなく、自己申告である。**
--
-- ★ 日時が2つある理由
--
--   noted_at    手入力。**その出来事があった日時**（後から書くことがある）
--   created_at  自動。**この行が記録された時刻**
--
--   1つにすると、3日前の面談を今日書いたときに、どちらかが嘘になる。
--   手入力を信じるが、いつ入れられたかは消さない。
--
-- ★ 追記専用。訂正は打ち消し行（原則5）。0016 と同じ型を使う。
-- =============================================================

CREATE TABLE person_notes (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id        uuid        NOT NULL REFERENCES persons(id),
    -- 書いた人。手入力の自己申告であって、認証された身元ではない。
    author_name      text        NOT NULL,
    -- 出来事の日時（手入力）。
    noted_at         timestamptz NOT NULL,
    body             text        NOT NULL,
    is_correction    boolean     NOT NULL DEFAULT false,
    corrects_note_id uuid        REFERENCES person_notes(id),
    created_at       timestamptz NOT NULL DEFAULT now(),

    -- 制約は NOT NULL だけでは足りない。空白だけの「必須項目」を通すと、
    -- 制約は満たすのに中身が無い記録ができる（`hold` で踏んだ穴と同じ）。
    CONSTRAINT person_notes_author_not_blank CHECK (btrim(author_name) <> ''),
    CONSTRAINT person_notes_body_not_blank   CHECK (btrim(body) <> ''),

    -- 訂正の向きを双方向にしない。自分で自分を打ち消す行は再帰の始点を
    -- 持たず、行がまるごと集計から消える（0003 と同じ理由）。
    CONSTRAINT person_notes_no_self_correction
        CHECK (corrects_note_id IS NULL OR corrects_note_id <> id),
    -- フラグと参照を両方向で縛る。片側だけだとフラグのほうが嘘になる。
    CONSTRAINT person_notes_correction_pair
        CHECK (is_correction = false OR corrects_note_id IS NOT NULL),
    CONSTRAINT person_notes_correction_pair_reverse
        CHECK (corrects_note_id IS NULL OR is_correction = true)
);

COMMENT ON TABLE person_notes IS
    '候補者メモ。追記専用。1件=1つの事実で、訂正は打ち消し行を足す（原則5）。';
COMMENT ON COLUMN person_notes.author_name IS
    '書いた人（手入力の自己申告）。合言葉は層で共有のため、'
    '記録層に認証された書き手は存在しない。staffs への参照にしない。';
COMMENT ON COLUMN person_notes.noted_at IS
    '出来事の日時（手入力）。行が記録された時刻は created_at。';

CREATE INDEX person_notes_person_idx ON person_notes (person_id, noted_at DESC);

-- 1つの行を打ち消す訂正行は最大1つ。分岐すると有効性が一意に定まらない。
CREATE UNIQUE INDEX person_notes_corrects_key
    ON person_notes (corrects_note_id) WHERE corrects_note_id IS NOT NULL;

-- 追記専用。UPDATE を禁じることで訂正チェーンの循環が構造的に作れなくなる。
CREATE TRIGGER person_notes_append_only
    BEFORE UPDATE OR DELETE ON person_notes
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();


-- -------------------------------------------------------------
-- 有効なメモ（訂正チェーンの解決）
-- -------------------------------------------------------------
-- v_effective_approach_events と同じ判定。深さ偶数が有効。
-- 訂正を訂正すれば元が復活する（会計の逆仕訳と同じ挙動）。
CREATE VIEW v_effective_person_notes AS
WITH RECURSIVE chain AS (
    SELECT n.id, n.corrects_note_id, 0 AS depth
      FROM person_notes n
     WHERE NOT EXISTS (
               SELECT 1 FROM person_notes c WHERE c.corrects_note_id = n.id
           )
    UNION ALL
    SELECT t.id, t.corrects_note_id, ch.depth + 1
      FROM chain ch
      JOIN person_notes t ON t.id = ch.corrects_note_id
)
SELECT pn.*
  FROM person_notes pn
  JOIN chain ON chain.id = pn.id
 WHERE chain.depth % 2 = 0;

COMMENT ON VIEW v_effective_person_notes IS
    '訂正チェーンを解決した後に有効なメモ。深さ偶数が有効。画面はこれを読む。';
