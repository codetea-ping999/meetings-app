# Meetings Studio — AI会議ワークスペース

**Next.js × Claude Messages API × OpenAI Realtime STT × tldraw** によるローカルファーストの会議整理MVPです。AnthropicのClaude Meetings公式機能やAPIを利用・再実装したものではなく、独立したプロジェクトです。

## 起動

**必要なもの**: Node.js 20.9以上、npm、Anthropic APIキー、OpenAI APIキー、Chrome/EdgeなどWebRTCを利用できるブラウザ。

```bash
npm install
cp .env.example .env.local
# .env.local を編集して ANTHROPIC_API_KEY / OPENAI_API_KEY を設定
npm run dev
```

`http://localhost:3000` を開いて、録音同意を確認してから開始してください。**キーを設定しなくても**、発言の手入力・サンプル読み込み・ホワイトボードの手動編集・保存・エクスポートを試せます。APIを利用する処理は対応するキーが必要です。

## MVP機能

- 低遅延音声認識: browser WebRTC → OpenAI `gpt-live-transcribe`（一時接続キーはNext.js Route Handlerから取得）。音声認識の差分はプレビューに表示され、無音区間または最大12秒ごとに確定します。
- マイク、および（対応ブラウザの）任意のタブ／画面共有音声をミックス。**システム音声が取得できないOS・ブラウザ・共有対象があります**。画面映像は送信しません。
- Claude `claude-sonnet-5-5`（環境変数で変更可）: 議事録、課題・決定・アクション・アイデア付箋、フロー／ツリー／マトリクスをJSON Schemaで返します。
- 25秒おきの自動整理（発言が増えた場合のみ）、テキスト指示、音声ウェイクワード「Claude、〇〇を整理して」。
- tldraw上で付箋のドラッグ、直接編集・削除・描画。手動編集済みの付箋の文字はAIが上書きしません。
- IndexedDBへの会議単位の自動保存。Markdown／JSONエクスポート、会議履歴の再読込。
- ダークモード。録音時の同意確認モーダル。録音データの永続保存なし。

### 使い方

1. 「新しい会議」で会議を作成し、タイトルを付けます。
2. 参加者全員の同意を得て、「録音開始」を押します。マイクアクセスを許可します。
3. 音声が確定すると右の「文字起こし」に表示されます。手入力も可能です。
4. 「AI更新」または「フローチャート」などを押して整理を指示します。
5. 「会議終了」で最終解析が走ります。履歴に保存され、Markdown／JSONを取得できます。

## 構成

```
src/
  app/
    api/analyze/route.ts     Claude Messages API / Structured Outputs
    api/realtime/route.ts    OpenAI WebRTC用の短命クライアントキー発行
    globals.css              Tailwind CSS 4 / UI トークン
    layout.tsx, page.tsx
  components/
    MeetingStudio.tsx        画面、録音同意、履歴、指示、エクスポート
    MeetingBoard.tsx         tldraw形状同期・手動編集保護
  hooks/
    useLiveTranscription.ts  マイク、タブ音声ミックス、WebRTC、VAD
  lib/
    storage.ts               IndexedDB永続化
    export.ts                Markdown / JSONダウンロード
  store/
    meetings.ts              Zustandミーティングストア
  types/
    meeting.ts               スキーマ/アプリ型
```

## データフロー

```
getUserMedia() ─┐
                ├─ AudioContext mix ─ RTCPeerConnection ─ OpenAI Realtime WebRTC
getDisplayMedia ┘                                      │             ↑ SDP answer
                                                      └──── transcript delta/completed
                                                            ↓
                                               Zustand: transcript + IndexedDB
                                                            ↓ 25秒/明示指示
                                            POST /api/analyze → Claude Messages API
                                                            ↓ JSON Schema
                                         Analysis (cards, actions, notes, edges)
                                                ↓                      ↓
                                        tldraw editor/store       議事録 UI
                                                └────────┬─────────────┘
                                                     IndexedDB
```

## 既知の制限とセキュリティ

- **シングルユーザー・ローカルMVP専用**: API Routeにはログイン認証・利用者別レート制限・不正アクセス防御がありません。APIキーと課金枠を守るため、**本番にそのまま公開しないでください**。認証、サーバー側クォータ、CSRF対策、監査ログ、暗号化・削除ポリシーの実装が必要です。
- `OPENAI_API_KEY` と `ANTHROPIC_API_KEY` はサーバー環境変数のみ。**`NEXT_PUBLIC_` にしないこと**。`.env.local` はGit管理対象外です。
- 音声はOpenAIへ、発言ログはAnthropicへ送信されます。第三者への通知と同意、取扱規約・保持期間は使用者の責任で確認してください。
- WebRTCストリーミングの確定タイミングは簡易クライアントVAD（エネルギー閾値）を利用します。無音や環境ノイズによって区切りが最適でない場合があります。話者分離・逐語的な完全性の保証はありません。
- 手動編集保護は付箋の文字内容のみ。AIが生成した付箋が会議中に削除された場合、同じIDの付箋は再作成しません。構造図のレイアウトを切り替えると配置は再計算されます。
- Markdownエクスポートはtldraw形状データを含みません。**JSONエクスポート**には形状スナップショットが含まれます。IndexedDBはブラウザ内で保存され、別端末には共有されません。
- アプリの長時間稼働・音声接続は環境依存です。APIごとの利用料金が発生します。
- **tldraw** はローカル開発ではキー不要ですが、公開したWebアプリには用途に応じた有効なライセンスが必要です。`NEXT_PUBLIC_TLDRAW_LICENSE_KEY` を設定してください。https://tldraw.dev/community/license

## 拡張予定

- Google Meet / Teams: 権限を得た連携と参加者通知、公式SDK / botインフラ
- 認証、APIレート制御、PostgreSQL/Supabase + RLS、サーバー永続化
- tldraw sync によるマルチプレイヤー（公式の同期方式）
- 話者識別、より安定したVAD、用語辞書、会議ごとのAI差分抽出
- Notion / Google Docsへのエクスポート、レビュー・承認ワークフロー
- 操作ログ、OpenTelemetry、AI評価（議事録の事実性／遅延／コスト）
