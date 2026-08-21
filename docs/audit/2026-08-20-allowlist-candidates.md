# allowlist 登録候補（2026-08-20 監査 `ac2a137`）

**署名は人間だけが行える**（`.consultant/STRUCTURE.md` §7）。本書は下ごしらえである。

★ **実体の行を本書に載せていない。** 初版は検出された行をそのまま引用し、
  **その引用で pre-commit の PII 走査が落ちた**（High 2 件・Medium 15 件）――
  検出について書いた文書が、検出源になる。S13 で同じ形を踏んでいる（自己参照）。
  実体は追跡外の `.tmp/allowlist-evidence-2026-08-20.md` に置いた。**手元で読む。**

対象は D6-01（32件）と D2-02（8件）。いずれも `★過去18回同じ指摘`で、判断が未決のまま繰り返されている。

| 場所 | 規則 | 指紋 |
|---|---|---|
| `db/seeds/0002_season_2026.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0003_season_2027.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0005_season2_special_selection.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0006_season3_align_to_season2.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0007_season3_target.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0008_group_interview_criteria.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0009_season3_partner_status.production.sql` | — | `2f33c6d9c32cc5b5` |
| `db/seeds/0010_document_screening_criteria.production.sql` | — | `2f33c6d9c32cc5b5` |
| `app/borderline/page.tsx:65` | JP_PERSON_NAME_WEAK | `3d4aa43df019e3d1` |
| `app/borderline/page.tsx:67` | JP_PERSON_NAME_WEAK | `3d4aa43df019e3d1` |
| `db/migrations/0023_person_optional_facts.sql:59` | JP_PERSON_NAME_WEAK | `5847e657a15515c3` |
| `db/seeds/0001_reference.example.sql:64` | JP_PERSON_NAME_WEAK | `5b159eb0e0613c26` |
| `db/seeds/0001_reference.example.sql:70` | JP_PERSON_NAME_WEAK | `5b159eb0e0613c26` |
| `db/seeds/0001_reference.example.sql:73` | JP_PERSON_NAME_WEAK | `5b159eb0e0613c26` |
| `db/seeds/0001_reference.example.sql:75` | JP_PERSON_NAME_WEAK | `5b159eb0e0613c26` |
| `db/seeds/0004_channels.sql:31` | JP_PERSON_NAME_WEAK | `eed36f99a940c6c7` |
| `db/seeds/0004_channels.sql:32` | JP_PERSON_NAME_WEAK | `eed36f99a940c6c7` |
| `db/seeds/0004_channels.sql:33` | JP_PERSON_NAME_WEAK | `eed36f99a940c6c7` |
| `db/seeds/0004_channels.sql:35` | JP_PERSON_NAME_WEAK | `eed36f99a940c6c7` |
| `db/seeds/0004_channels.sql:36` | JP_PERSON_NAME_WEAK | `eed36f99a940c6c7` |
| `db/seeds/0004_channels.sql:37` | JP_PERSON_NAME_WEAK | `eed36f99a940c6c7` |
| `db/seeds/0005_season2_special_selection.production.sql:55` | JP_PERSON_NAME_WEAK | `e7898dc0373a18d6` |
| `docs/audit/2026-08-19-remediation.md:163` | BIRTHDATE | `12c2fcba9f5d1fde` |
| `docs/audit/2026-08-19-remediation.md:163` | BIRTHDATE | `12c2fcba9f5d1fde` |
| `docs/consultant/2026-08-19-state.md:103` | BIRTHDATE | `df135ce3288badb3` |
| `scripts/import-approach-2026.ts:109` | JP_PERSON_NAME_WEAK | `1fc24323d72d61d7` |
| `scripts/import-approach-2026.ts:146` | JP_PERSON_NAME_WEAK | `1fc24323d72d61d7` |
| `scripts/import-legacy-2026.ts:308` | JP_PERSON_NAME_WEAK | `76b8971475a23f21` |
| `src/commands/ai_pre_assessment.ts:193` | JP_PERSON_NAME_WEAK | `cf2337f4e356eb95` |
| `src/commands/ai_pre_assessment.ts:210` | JP_PERSON_NAME_WEAK | `cf2337f4e356eb95` |
| `src/import/legacy_2026.ts:313` | JP_PERSON_NAME_WEAK | `e54284d137a49a9e` |
| `src/import/legacy_2026.ts:314` | JP_PERSON_NAME_WEAK | `e54284d137a49a9e` |
| `src/import/legacy_2026.ts:315` | JP_PERSON_NAME_WEAK | `e54284d137a49a9e` |
| `src/import/legacy_2026.ts:316` | JP_PERSON_NAME_WEAK | `e54284d137a49a9e` |
| `src/import/legacy_2026.ts:317` | JP_PERSON_NAME_WEAK | `e54284d137a49a9e` |
| `src/queries/ai_pre_assessment.ts:24` | JP_PERSON_NAME_WEAK | `51a4d05477cd4374` |
| `src/queries/document_screening.ts:103` | JP_PERSON_NAME_WEAK | `46e428761d062d17` |
| `src/queries/tasks.ts:256` | JP_PERSON_NAME_WEAK | `8907b49da696d996` |
| `tests/21_decide.test.ts:345` | JP_PERSON_NAME_WEAK | `48218fd60fa74816` |
| `tests/22_reference_season.test.ts:161` | JP_PERSON_NAME_WEAK | `08f29bf3012b9029` |
| `tests/22_reference_season.test.ts:162` | JP_PERSON_NAME_WEAK | `08f29bf3012b9029` |
| `tests/22_reference_season.test.ts:163` | JP_PERSON_NAME_WEAK | `08f29bf3012b9029` |
| `tests/22_reference_season.test.ts:165` | JP_PERSON_NAME_WEAK | `08f29bf3012b9029` |
| `tests/22_reference_season.test.ts:232` | JP_PERSON_NAME_WEAK | `08f29bf3012b9029` |
| `tests/22_reference_season.test.ts:255` | JP_PERSON_NAME_WEAK | `08f29bf3012b9029` |
| `tests/29_profile_editing.test.ts:32` | BIRTHDATE | `1e315a7a3d6a3687` |
| `tests/33_borderline_scoring.test.ts:42` | JP_PERSON_NAME_WEAK | `269dd29a732e105f` |
| `tests/33_borderline_scoring.test.ts:206` | JP_PERSON_NAME_WEAK | `269dd29a732e105f` |
| `tests/34_legacy_import.test.ts:34` | BIRTHDATE | `bdd9501527e48224` |
| `tests/34_legacy_import.test.ts:37` | BIRTHDATE | `bdd9501527e48224` |
| `tests/34_legacy_import.test.ts:44` | BIRTHDATE | `bdd9501527e48224` |
| `tests/34_legacy_import.test.ts:52` | BIRTHDATE | `bdd9501527e48224` |
| `tests/34_legacy_import.test.ts:61` | BIRTHDATE | `bdd9501527e48224` |
| `tests/34_legacy_import.test.ts:72` | BIRTHDATE | `bdd9501527e48224` |
| `tests/34_legacy_import.test.ts:52` | JP_PERSON_NAME_WEAK | `1c0dda8f1a5ca64e` |
| `tests/34_legacy_import.test.ts:60` | JP_PERSON_NAME_WEAK | `1c0dda8f1a5ca64e` |
| `tests/34_legacy_import.test.ts:94` | JP_PERSON_NAME_WEAK | `1c0dda8f1a5ca64e` |
| `tests/35_interview_sheet.test.ts:44` | JP_PERSON_NAME_WEAK | `f45afa5a9ad4294b` |
| `tests/36_intake.test.ts:304` | JP_PERSON_NAME_WEAK | `eab42f49f33f912e` |
| `tests/36_intake.test.ts:317` | JP_PERSON_NAME_WEAK | `eab42f49f33f912e` |
| `tests/36_intake.test.ts:321` | JP_PERSON_NAME_WEAK | `eab42f49f33f912e` |
| `tests/36_intake.test.ts:328` | JP_PERSON_NAME_WEAK | `eab42f49f33f912e` |
| `tests/36_intake.test.ts:341` | JP_PERSON_NAME_WEAK | `eab42f49f33f912e` |
| `tests/36_intake.test.ts:345` | JP_PERSON_NAME_WEAK | `eab42f49f33f912e` |
| `tests/41_sheet_bulk.test.ts:316` | JP_PERSON_NAME_WEAK | `1900689dd37477f5` |
| `tests/41_sheet_bulk.test.ts:326` | JP_PERSON_NAME_WEAK | `1900689dd37477f5` |
| `tests/48_criteria_weighting.test.ts:48` | JP_PERSON_NAME_WEAK | `ac54ad25f547ae36` |
| `tests/48_criteria_weighting.test.ts:89` | JP_PERSON_NAME_WEAK | `ac54ad25f547ae36` |
| `tests/52_season3_alignment.test.ts:28` | JP_PERSON_NAME_WEAK | `5c69f55f1ae8ce6e` |
| `tests/52_season3_alignment.test.ts:30` | JP_PERSON_NAME_WEAK | `5c69f55f1ae8ce6e` |
| `tests/52_season3_alignment.test.ts:33` | JP_PERSON_NAME_WEAK | `5c69f55f1ae8ce6e` |
| `tests/52_season3_alignment.test.ts:33` | JP_PERSON_NAME_WEAK | `5c69f55f1ae8ce6e` |
| `tests/52_season3_alignment.test.ts:90` | JP_PERSON_NAME_WEAK | `5c69f55f1ae8ce6e` |
| `tests/53_deploy_target.test.ts:29` | JP_PERSON_NAME_WEAK | `2a5878401d714015` |
| `tests/53_deploy_target.test.ts:37` | JP_PERSON_NAME_WEAK | `2a5878401d714015` |
| `tests/53_deploy_target.test.ts:55` | JP_PERSON_NAME_WEAK | `2a5878401d714015` |
| `tests/54_list_weight.test.ts:41` | JP_PERSON_NAME_WEAK | `46e8f299f856337c` |
| `tests/70_ai_pre_assessment.test.ts:204` | JP_PERSON_NAME_WEAK | `add27257ededee3d` |
| `tests/75_end_to_end_selection.test.ts:270` | JP_PERSON_NAME_WEAK | `35db984ebddb3ab1` |
| `tests/76_document_gate.test.ts:47` | JP_PERSON_NAME_WEAK | `0fd81207cc350f9f` |
| `tests/76_document_gate.test.ts:63` | JP_PERSON_NAME_WEAK | `0fd81207cc350f9f` |
| `tests/76_document_gate.test.ts:71` | JP_PERSON_NAME_WEAK | `0fd81207cc350f9f` |
| `tests/78_pilot_hirashain.test.ts:36` | JP_PERSON_NAME_WEAK | `d6caa5fa78933d94` |
| `tests/78_pilot_hirashain.test.ts:38` | JP_PERSON_NAME_WEAK | `d6caa5fa78933d94` |
| `tests/78_pilot_hirashain.test.ts:216` | JP_PERSON_NAME_WEAK | `d6caa5fa78933d94` |
| `public/brand/icon_64.png` | ? | `a7c866a6816ef3ec` |
| `public/brand/logo_black.png` | ? | `a7c866a6816ef3ec` |
| `public/brand/logo_gradient.png` | ? | `a7c866a6816ef3ec` |
| `public/brand/logo_gradient_720.png` | ? | `a7c866a6816ef3ec` |
| `public/brand/logo_white.png` | ? | `a7c866a6816ef3ec` |
| `public/brand/logo_ydb.png` | ? | `a7c866a6816ef3ec` |

## 判断のしかた

```
open .tmp/allowlist-evidence-2026-08-20.md
```

1. 実体の行を見る。**実在の個人か／分類語か／列名の判定文字列か。**
2. 実在の個人なら allowlist ではない —— 取り除く（push 済みなら履歴の除去は不可逆操作）。
3. 架空・分類語・列名なら `.tmp/allowlist-additions-2026-08-20.yml` を
   `.audit/allowlist.yml` へ移し、**人間が `approved_by` に署名する**（`expires` は1年）。

★ 走査の 32 件は「弱い日本語人名パターン」で、実体は選考区分・チャネル・学校区分の**分類語**と、
  接頭辞で架空と明示された団体名である（語そのものは本書に載せない。上記の理由）。
  ただし**判断は署名者が行う** ―― 本書は材料を並べただけである。
