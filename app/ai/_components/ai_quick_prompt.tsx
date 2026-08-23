const QUICK_PROMPTS = [
  '3期の応募者は何人ですか',
  '確度S・Aの候補者一覧を見せてください',
  '書類選考で合格した候補者は何人いますか',
  '連携団体からの推薦者数と進行状況を教えて',
  '面接の未評価者リストを出してください',
]

/** クリックでの選択は `<datalist>`（ネイティブの候補一覧）に委ねる。
 *  クライアントJSを使わずに「入れると候補が出る」を実現する。 */
export function AiQuickPrompts() {
  return (
    <div className="editable-region">
      <label>
        問い
        <input
          name="question"
          required
          maxLength={400}
          list="ai-quick-prompts"
          placeholder="例：3期の応募者は何人ですか"
        />
      </label>
      <datalist id="ai-quick-prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <option key={prompt} value={prompt} />
        ))}
      </datalist>
    </div>
  )
}
