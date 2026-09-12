import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../../src/db/server.ts'
import { getPerson } from '../../../../src/queries/drilldown.ts'
import { getPersonPanel, getProfileEditOptions } from '../../../../src/queries/headhunting.ts'
import { listSeasons, defaultSeason, getSeason } from '../../../../src/queries/dashboard.ts'
import {
  updateProfileAction, updateApproachAction, correctApproachAction,
} from '../../../headhunting/actions.ts'
import { ymd } from '../../../_components/ui.tsx'
import { Shell, Breadcrumb, seasonLabel } from '../../../_components/shell.tsx'
import { Avatar } from '../../../_components/borderline.tsx'

export const dynamic = 'force-dynamic'

const MESSAGE: Record<string, string> = {
  saved: 'プロフィールを保存した。',
  approach_saved: 'アプローチ状態を記録した。',
  approach_corrected: '直前のアプローチ状態を訂正した。',
  nothing_to_correct: 'まだ記録が無いので、訂正ではなく「状態を記録」で置く。',
  person_not_found: 'その候補者は見つからなかった。',
  required: '姓・名・メールは空にできない。',
  bad_email: 'メールの形が違う。',
  bad_date: '生年月日は日付で入れる。',
  school_not_found: 'その学校は選べない。',
  bad_referrer: 'その紹介者は選べない。',
  bad_photo: '顔写真は JPEG / PNG / WebP の 2MB 以下。',
  duplicate_line: 'その LINE ID は別の人が使っている。',
}

/**
 * プロフィールの編集（依頼者の指示。実行⑩）。
 *
 * ★ **右の小さなパネルから編集させない。**
 *   それまでヘッドハンティングの側パネル（幅 340px）に、
 *   12項目のフォームを畳んで入れていた。書く場所としては狭すぎるうえ、
 *   一覧を見ながら書くものでもない。**深い層に出した。**
 *
 * ★ 判定は `src/commands/profile.ts` にある。ここは受け渡しだけ。
 *   アクションも既存のものをそのまま使う ―― 入口を増やしても規則は1つ。
 *
 * 素の `<form>` である。`'use client'` は増やしていない。
 */
export default async function PersonEditPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const db = await getDb()
  const person = await getPerson(db, id)
  if (!person) notFound()

  const seasons = await listSeasons(db)
  const season = (await getSeason(db, sp.season))
    ?? defaultSeason(seasons)
  if (!season) notFound()

  const [panel, options] = await Promise.all([
    getPersonPanel(db, id, season.id),
    getProfileEditOptions(db, id),
  ])
  if (!panel || !options) notFound()

  const code = one(sp.edit)
  const message = code ? MESSAGE[code] ?? '保存できなかった。' : null

  return (
    <Shell active="headhunting" seasonId={season.id}>
      <Breadcrumb
        root={seasonLabel(season)}
        crumbs={[
          { label: '特別選考', href: `/headhunting?season=${season.id}` },
          { label: panel.person_name, href: `/people/${id}?season=${season.id}` },
          { label: '編集' },
        ]}
      />

      {message && (
        <p className={`callout${
          ['saved', 'approach_saved', 'approach_corrected'].includes(code ?? '') ? ' ok' : ''}`}>
          {message}
        </p>
      )}

      <div className="page-head">
        <div className="bl-person-head">
          <Avatar src={panel.photo_data_url} name={panel.person_name} />
          <div>
            <h1 className="page-title">{panel.person_name}</h1>
            <p className="page-sub">{panel.school}</p>
          </div>
        </div>
      </div>

      <div className="section">
        <section className="card-base">
          <h2 className="section-title">基本情報・顔写真</h2>
          <form action={updateProfileAction} className="profile-edit-form editable-region">
            <input type="hidden" name="personId" value={id} />
            <input type="hidden" name="seasonId" value={season.id} />
            <div className="edit-grid two">
              <label>姓<input name="familyName" required defaultValue={panel.family_name} /></label>
              {/* ★ 必須は姓だけ（0023 / 0054）。名を必須にすると、
                  名を受け取っていない人（旧システムからの移行者）の
                  他の項目すら直せない。 */}
              <label>名<input name="givenName" defaultValue={panel.given_name} /></label>
              <label>姓（かな）
                <input name="familyNameKana" defaultValue={panel.family_name_kana ?? ''} />
              </label>
              <label>名（かな）
                <input name="givenNameKana" defaultValue={panel.given_name_kana ?? ''} />
              </label>
              {/* 0023 で「無いこともある」になった。**必須にしない** ――
                  必須にすると、受け取っていない人のプロフィールを
                  他の項目だけ直すことすらできなくなる。 */}
              <label>生年月日
                <input name="birthDate" type="date" defaultValue={ymd(panel.birth_date)} />
              </label>
              {/* ★ 学校は任意（0054）。**必須にしない。**
                  選択肢は活性の学校だけなので、学校未記録の人や
                  畳んだ学校の人は `defaultValue` がどれにも当たらず、
                  ブラウザが**先頭の学校を勝手に選んでいた** ――
                  保存すると別の学校へ黙って移る。
                  今の記録を選択肢に足し、空も選べるようにする。 */}
              <label>学校
                <select name="schoolId" defaultValue={panel.school_id ?? ''}>
                  <option value="">―</option>
                  {panel.school_id
                    && !options.schools.some((o) => o.id === panel.school_id) && (
                    <option value={panel.school_id}>{panel.school}</option>
                  )}
                  {options.schools.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label>学部・学科<input name="faculty" defaultValue={panel.faculty ?? ''} /></label>
              <label>メール
                <input name="email" type="email" defaultValue={panel.email ?? ''} />
              </label>
              <label>電話番号<input name="phone" defaultValue={panel.phone ?? ''} /></label>
              <label>LINE ID
                <input name="lineUserId" defaultValue={panel.line_user_id ?? ''} />
              </label>
              <label>紹介者
                <select name="referrerPersonId" defaultValue={panel.referrer_person_id ?? ''}>
                  <option value="">なし</option>
                  {options.people.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label>顔写真
                <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
                <small>JPEG / PNG / WebP、2MB以下</small>
              </label>
            </div>
            {panel.photo_data_url && (
              <label className="inline-check">
                <input type="checkbox" name="removePhoto" value="1" /> 顔写真を削除
              </label>
            )}
            <label>担当者メモ
              <textarea name="note" rows={4} defaultValue={panel.note ?? ''} />
            </label>
            <button className="button-primary" type="submit">変更を保存</button>
          </form>
        </section>
      </div>

      <div className="section">
        <section className="card-base">
          <h2 className="section-title">アプローチ状態</h2>
          <form action={updateApproachAction} className="profile-edit-form editable-region">
            <input type="hidden" name="personId" value={id} />
            <input type="hidden" name="seasonId" value={season.id} />
            <label>状態
              <select name="stateId" required>
                {options.approachStates.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>記録担当者
              <select name="staffId" required>
                {options.staffs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label>状態変更メモ<textarea name="approachNote" rows={3} /></label>
            {/*
              押すボタンで意味が変わる（実行⑮。C-131）――
                状態を記録   … 出来事を1つ積む（その日に動きがあった）
                直前を訂正   … 直前の記録を打ち消して、正しい状態を置く
              欄は同じなので分けない。見送り（終端）を押し間違えても
              訂正で戻せる ―― 戻せないと、その人は一覧に二度と現れない。
            */}
            <div className="form-buttons">
              <button className="button-primary" type="submit">状態を記録</button>
              <button className="button-secondary" type="submit"
                      formAction={correctApproachAction}>直前を訂正</button>
            </div>
          </form>
        </section>
      </div>

      <div className="section">
        <Link href={`/people/${id}?season=${season.id}`} className="hh-more">
          ‹ この人の記録へ戻る
        </Link>
      </div>
    </Shell>
  )
}
