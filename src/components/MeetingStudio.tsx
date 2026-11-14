'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioLines, BrainCircuit, Check, ChevronLeft, Clock3, Download, FileText, GitBranch,
  LayoutGrid, ListTodo, LoaderCircle, Mic, Moon, MoreHorizontal, Plus, Send,
  ShieldCheck, Sparkles, Square, StickyNote, Sun, Trash2, WandSparkles, X,
} from 'lucide-react'
import { useMeetings } from '@/store/meetings'
import { useLiveTranscription } from '@/hooks/useLiveTranscription'
import { downloadFile, toMarkdown } from '@/lib/export'
import type { Analysis } from '@/types/meeting'

const MeetingBoard = dynamic(() => import('./MeetingBoard').then(m => m.MeetingBoard), { ssr: false })
type Tab = 'minutes' | 'transcript' | 'actions'

function formatTime(value: string) { return new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) }
function formatDate(value: string) { return new Date(value).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) }
const sample = [
  '新プロジェクトのMVPは11月末までに社内テストを目指す。',
  '課題はリアルタイム音声認識の精度とホワイトボード同期の実装工数。',
  'まずは日本語の会議録を優先し、多言語対応は次フェーズで検討する。',
  '田中さんはAPIの調査を担当、期限は11月20日。UI設計は担当未定。',
  '次回の定例までにプロトタイプをレビューすることで合意した。',
]
const CHOICES = [
  { label: '付箋で整理', value: '決定事項・課題・アイデアを付箋として分類してホワイトボードを作って。', icon: StickyNote },
  { label: 'フローチャート', value: '会議の手順や意思決定をフローチャート（flow）で整理して。', icon: GitBranch },
  { label: 'ツリー', value: '議題から論点をツリー（tree）にして関連付けて。', icon: GitBranch },
  { label: 'マトリクス', value: '課題・決定・アクション・アイデアを2×2のマトリクス（matrix）で配置して。', icon: LayoutGrid },
]

export function MeetingStudio() {
  const state = useMeetings()
  const meeting = state.meetings.find(m => m.id === state.activeId) ?? null
  const [dark, setDark] = useState(false)
  const [tab, setTab] = useState<Tab>('minutes')
  const [instruction, setInstruction] = useState('')
  const [manualText, setManualText] = useState('')
  const [captureSystem, setCaptureSystem] = useState(false)
  const [consentDialog, setConsentDialog] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [mobilePanel, setMobilePanel] = useState(false)
  const [aiWorking, setAiWorking] = useState(false)
  const [aiError, setAiError] = useState('')
  const [autoMode, setAutoMode] = useState(true)
  const aiBusyRef = useRef(false)
  const aiBlockedRef = useRef(false)
  const lastAnalyzedRef = useRef('')
  const runAIRef = useRef<(instruction?: string) => Promise<void>>(async () => undefined)
  const transcriptEnd = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await useMeetings.getState().load()
        if (!cancelled && useMeetings.getState().meetings.length === 0) useMeetings.getState().newMeeting()
      } catch (err) { console.error('Failed to load saved meetings', err) }
    })()
    const saved = localStorage.getItem('meetings-app:theme')
    const frame = requestAnimationFrame(() => { if (saved === 'dark') setDark(true) })
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('meetings-app:theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [meeting?.transcript.length, tab])

  const runAI = useCallback(async (command = '') => {
    if (aiBusyRef.current) return
    const active = useMeetings.getState()
    const current = active.meetings.find(m => m.id === active.activeId)
    if (!current || (!current.transcript.length && !command.trim())) return
    aiBusyRef.current = true
    setAiWorking(true)
    setAiError('')
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: current.transcript.map(line => `${formatTime(line.at)} ${line.text}`).join('\n').slice(-24_000),
          previous: current.analysis,
          instruction: command,
        }),
      })
      const result = await response.json() as { analysis?: Analysis; error?: string }
      if (!response.ok || !result.analysis) throw new Error(result.error || 'AI解析エラー')
      if (useMeetings.getState().activeId === current.id) {
        active.applyAnalysis(result.analysis)
        lastAnalyzedRef.current = `${current.id}:${current.transcript.length}`
      }
      aiBlockedRef.current = false
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Claudeへの接続に失敗しました')
      aiBlockedRef.current = true
    } finally {
      aiBusyRef.current = false
      setAiWorking(false)
    }
  }, [])
  useEffect(() => { runAIRef.current = runAI }, [runAI])

  const onFinal = useCallback((text: string) => {
    const state = useMeetings.getState()
    const current = state.meetings.find(m => m.id === state.activeId)
    if (!current || current.endedAt) return
    state.appendTranscript({ id: crypto.randomUUID(), at: new Date().toISOString(), text, source: 'audio' })
    // Voice commands require a wake word, so other meeting participants do not
    // accidentally trigger a destructive/expensive UI operation.
    const voiceCommand = text.match(/^(?:Claude|クロード|クラウド)[、,\s:：]+(.+)/i)
    if (voiceCommand && /ホワイトボード|付箋|フロー|ツリー|マトリクス|議事録|アクション|整理/.test(voiceCommand[1])) {
      void runAIRef.current(voiceCommand[1])
    }
  }, [])
  const transcription = useLiveTranscription(onFinal)
  const live = transcription.status !== 'idle'

  useEffect(() => {
    if (!autoMode || !meeting?.transcript.length || meeting.endedAt || !live) return
    const timer = setInterval(() => {
      const current = useMeetings.getState().meetings.find(m => m.id === useMeetings.getState().activeId)
      if (!current || !current.transcript.length || aiBlockedRef.current || aiBusyRef.current) return
      const fingerprint = `${current.id}:${current.transcript.length}`
      if (fingerprint !== lastAnalyzedRef.current) void runAIRef.current()
    }, 25_000)
    return () => clearInterval(timer)
  }, [autoMode, meeting?.id, meeting?.transcript.length, meeting?.endedAt, live])

  const begin = useCallback(async () => {
    setConsentDialog(false)
    if (!agreed || !meeting || meeting.endedAt) return
    await transcription.start(captureSystem)
  }, [agreed, meeting, captureSystem, transcription])
  const finish = useCallback(async () => {
    await transcription.stop()
    useMeetings.getState().stopMeeting()
    if (useMeetings.getState().meetings.find(m => m.id === useMeetings.getState().activeId)?.transcript.length) {
      void runAIRef.current('会議終了。これまでの会話に基づいて最終議事録・決定事項・アクションを確定版として整理してください。')
    }
  }, [transcription])
  const addManual = () => {
    const text = manualText.trim()
    if (!text || meeting?.endedAt) return
    state.appendTranscript({ id: crypto.randomUUID(), at: new Date().toISOString(), text, source: 'manual' })
    setManualText('')
  }
  const prompt = (command: string) => {
    setInstruction('')
    setTab('minutes')
    void runAI(command)
  }
  const beginNew = () => { if (live) return; state.newMeeting(); setAgreed(false); setAiError(''); lastAnalyzedRef.current = '' }
  const exportMeeting = (format: 'md' | 'json') => {
    if (!meeting) return
    const filename = `meeting-${meeting.id.slice(0, 8)}.${format}`
    if (format === 'md') downloadFile(filename, toMarkdown(meeting), 'text/markdown;charset=utf-8')
    else downloadFile(filename, JSON.stringify(meeting, null, 2), 'application/json;charset=utf-8')
  }

  if (!state.ready || !meeting) return <div className="flex min-h-screen items-center justify-center gap-2 text-sm muted"><LoaderCircle className="animate-spin" size={20}/> 会議ワークスペースを準備しています</div>

  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden">
      <header className="surface stroke z-10 flex h-[68px] shrink-0 items-center justify-between border-b px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button className="pill !p-2" onClick={() => setSidebar(v => !v)} aria-label="履歴パネルの開閉"><ChevronLeft className={sidebar ? '' : 'rotate-180'} size={18}/></button>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><AudioLines size={20}/></span>
          <div className="min-w-0"><div className="truncate text-sm font-bold tracking-tight">Meetings <span className="text-indigo-500">Studio</span></div><div className="muted hidden text-[10px] sm:block">AI meeting workspace</div></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="muted hidden items-center gap-1.5 text-xs md:flex"><ShieldCheck size={14}/> ローカル保存</span>
          <button className="pill lg:hidden" onClick={() => setMobilePanel(true)}><FileText size={15}/> 議事録</button>
          <button className="pill !p-2" onClick={() => setDark(v => !v)} aria-label="ダークモード切替">{dark ? <Sun size={17}/> : <Moon size={17}/>}</button>
          <button className="pill" onClick={beginNew} disabled={live}><Plus size={15}/> <span className="hidden sm:inline">新しい会議</span></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <aside className="surface stroke aside-scroll hidden w-[238px] shrink-0 flex-col overflow-y-auto border-r px-3 py-5 md:flex">
            <div className="mb-4 flex items-center justify-between px-2"><p className="muted text-[11px] font-bold tracking-[.14em]">MY MEETINGS</p><Clock3 size={15} className="muted"/></div>
            <div className="space-y-1">
              {state.meetings.map(item => (
                <button key={item.id} disabled={live} onClick={() => { state.setActive(item.id); setAiError(''); lastAnalyzedRef.current = '' }}
                  className={`w-full rounded-xl px-3 py-3 text-left transition ${item.id === meeting.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
                  <div className="flex items-center gap-2"><FileText size={16} className="shrink-0"/><span className="min-w-0 truncate text-xs font-semibold">{item.title}</span></div>
                  <div className="muted mt-1.5 pl-6 text-[10px]">{formatDate(item.startedAt)} · {item.endedAt ? '完了' : '作業中'} · {item.transcript.length}件</div>
                </button>
              ))}
            </div>
            <div className="mt-auto space-y-3 px-2 pt-8">
              <div className="soft stroke rounded-xl border p-3"><div className="mb-1 flex items-center gap-1.5 text-xs font-bold"><Sparkles size={15} className="text-indigo-500"/> クイックスタート</div><p className="muted text-[11px] leading-relaxed">会話を記録すると、AIが論点や決定事項を整理します。</p></div>
              <p className="muted text-[10px] leading-relaxed">録音は保存されません。議事録とホワイトボードはこのブラウザに保存されます。</p>
            </div>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3 lg:gap-4 lg:p-5">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 flex-col gap-1">
              <input aria-label="会議タイトル" className="min-w-0 max-w-[410px] bg-transparent text-lg font-bold tracking-tight outline-none focus:underline lg:text-xl"
                value={meeting.title} onChange={e => state.rename(e.target.value)} />
              <div className="muted flex items-center gap-2 text-[11px]"><Clock3 size={12}/>{new Date(meeting.startedAt).toLocaleString('ja-JP')}<span>·</span>{meeting.endedAt ? '完了した会議' : live ? '録音中' : '録音待機中'}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${live ? 'border-red-300 bg-red-50 text-red-600 dark:bg-red-900/20' : 'stroke muted'}`}>{live ? '● LIVE' : '○ READY'}</span>
              <button className="pill !py-2" onClick={() => exportMeeting('md')}><Download size={14}/> Markdown</button>
              <button className="pill !py-2" onClick={() => exportMeeting('json')}>JSON</button>
            </div>
          </div>
          <div className="surface stroke flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border p-2">
            <div className="mr-2 flex items-center gap-1.5 px-2 text-[11px] font-bold"><WandSparkles size={15} className="text-indigo-500"/> AI整理</div>
            {CHOICES.map(choice => <button key={choice.label} onClick={() => prompt(choice.value)} disabled={aiWorking} className="pill !border-transparent !bg-transparent !px-2.5 !py-1.5 hover:!bg-indigo-50 dark:hover:!bg-indigo-500/15"><choice.icon size={14}/>{choice.label}</button>)}
            <button className="pill ml-auto !py-1.5 text-indigo-600 dark:text-indigo-300" disabled={aiWorking} onClick={() => void runAI()}>{aiWorking ? <LoaderCircle className="animate-spin" size={14}/> : <BrainCircuit size={14}/>} AI更新</button>
          </div>
          <div className="relative min-h-0 flex-1">
            <MeetingBoard key={meeting.id} analysis={meeting.analysis} snapshot={meeting.boardSnapshot}
              protectedIds={meeting.protectedShapeIds} deletedIds={meeting.deletedShapeIds} dark={dark}
              onChange={(snapshot, protectedIds, deletedIds) => {
                if (useMeetings.getState().activeId === meeting.id) useMeetings.getState().setBoard(snapshot, protectedIds, deletedIds)
              }}/>
          </div>
          <div className="surface stroke shrink-0 rounded-2xl border p-3 shadow-sm">
            {transcription.interim && <div className="mb-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200">認識中: {transcription.interim}</div>}
            {(transcription.error || transcription.info || aiError) && (
              <div className="mb-2 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                {transcription.error && <p>音声: {transcription.error}</p>}{transcription.info && <p>{transcription.info}</p>}{aiError && <p>AI: {aiError}</p>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!live ? (
                <button disabled={Boolean(meeting.endedAt)} onClick={() => setConsentDialog(true)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-semibold text-white hover:bg-indigo-700"><Mic size={17}/> 録音開始</button>
              ) : (
                <button disabled={transcription.status === 'stopping' || transcription.status === 'connecting'} onClick={() => void finish()} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-xs font-semibold text-white hover:bg-red-700"><Square size={15} fill="currentColor"/> {transcription.status === 'stopping' ? '終了処理中' : '会議終了'}</button>
              )}
              <label className="muted flex items-center gap-1.5 text-[11px]"><input type="checkbox" disabled={live} checked={captureSystem} onChange={e => setCaptureSystem(e.target.checked)} className="accent-indigo-600"/> タブ・画面の音声も取得</label>
              <label className="muted ml-auto flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={autoMode} onChange={e => setAutoMode(e.target.checked)} className="accent-indigo-600"/> 25秒ごとにAI整理</label>
            </div>
            <div className="mt-3 flex gap-2">
              <input value={instruction} onChange={e => setInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && instruction.trim()) prompt(instruction) }}
                placeholder="Claudeに指示: これを課題別のツリーに整理して..." className="soft stroke min-w-0 flex-1 rounded-xl border px-3 py-3 text-xs"/>
              <button disabled={!instruction.trim() || aiWorking} onClick={() => prompt(instruction)} className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white dark:bg-indigo-600"><Send size={14}/> 送信</button>
            </div>
          </div>
        </main>

        <aside className={`surface stroke shrink-0 flex-col border-l ${mobilePanel ? 'fixed inset-x-0 bottom-0 top-[68px] z-30 flex w-full' : 'hidden'} lg:static lg:z-auto lg:flex lg:w-[315px] xl:w-[360px] 2xl:w-[410px]`}>
          <div className="stroke flex justify-end border-b px-3 py-2 lg:hidden"><button className="pill !p-2" aria-label="議事録を閉じる" onClick={() => setMobilePanel(false)}><X size={16}/></button></div>
          <div className="stroke grid grid-cols-3 border-b px-2 pt-3">
            {([{ id: 'minutes', label: '議事メモ', icon: FileText }, { id: 'transcript', label: '文字起こし', icon: AudioLines }, { id: 'actions', label: 'アクション', icon: ListTodo }] as const).map(item =>
              <button key={item.id} onClick={() => setTab(item.id)} className={`flex items-center justify-center gap-1.5 border-b-2 px-1 pb-3 text-[11px] font-bold ${tab === item.id ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'border-transparent muted'}`}><item.icon size={14}/>{item.label}</button>
            )}
          </div>
          <div className="actions-scroll min-h-0 flex-1 overflow-y-auto p-5">
            {tab === 'minutes' && <>
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">AI議事録</h2><span className="muted text-[10px]">{meeting.analysis?.updatedAt ? `${formatTime(meeting.analysis.updatedAt)} 更新` : '未作成'}</span></div>
              {meeting.analysis ? <><h3 className="muted mb-2 text-[11px] font-bold uppercase tracking-wider">SUMMARY</h3><p className="text-xs leading-7 whitespace-pre-wrap">{meeting.analysis.summary}</p><div className="stroke my-5 border-t"/><h3 className="muted mb-3 text-[11px] font-bold uppercase tracking-wider">MEETING NOTES</h3><div className="whitespace-pre-wrap text-xs leading-7">{meeting.analysis.minutes}</div></>
              : <div className="flex min-h-48 flex-col items-center justify-center text-center"><BrainCircuit size={28} className="mb-3 text-indigo-400"/><p className="text-xs font-bold">議事録はまだありません</p><p className="muted mt-2 max-w-56 text-[11px] leading-6">文字起こしを開始し、「AI更新」を押すと会議の内容が整理されます。</p></div>}
            </>}
            {tab === 'transcript' && <>
              <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold">発言ログ</h2><span className="muted text-[10px]">{meeting.transcript.length}件</span></div>
              <div className="space-y-4">{meeting.transcript.map(line => <div key={line.id} className="flex gap-3"><span className="muted w-10 shrink-0 pt-0.5 text-[10px]">{formatTime(line.at)}</span><div className="text-xs leading-6"><span className="mb-1 block text-[10px] font-bold text-indigo-500">{line.source === 'audio' ? '音声' : '手入力'}</span>{line.text}</div></div>)}<div ref={transcriptEnd}/></div>
              {!meeting.transcript.length && <p className="muted mt-12 text-center text-xs">発言が記録されるとここに表示されます。</p>}
            </>}
            {tab === 'actions' && <>
              <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold">アクションアイテム</h2><span className="muted text-[10px]">{meeting.analysis?.actions.length ?? 0}件</span></div>
              <div className="space-y-3">{meeting.analysis?.actions.map(action => <div key={action.id} className="soft stroke rounded-xl border p-3"><div className="flex items-start gap-2"><div className="mt-1 h-4 w-4 shrink-0 rounded border border-indigo-300"/><p className="text-xs font-semibold leading-6">{action.task}</p></div><p className="muted mt-2 pl-6 text-[11px]">担当: {action.owner || '未定'}　期限: {action.due || '未定'}</p></div>)}</div>
              {!meeting.analysis?.actions.length && <p className="muted mt-12 text-center text-xs">アクションはまだ抽出されていません。</p>}
            </>}
          </div>
          <div className="stroke border-t p-4">
            {tab === 'transcript' && !meeting.endedAt ? <div className="mb-3 flex gap-2"><input aria-label="発言を手入力" className="soft stroke min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs" placeholder="発言を手入力して追加" value={manualText} onChange={e => setManualText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addManual() }}/><button className="pill" onClick={addManual} disabled={!manualText.trim()}><Plus size={16}/></button></div> : null}
            {!meeting.transcript.length && !meeting.endedAt ? <button className="muted flex w-full items-center justify-center gap-1.5 text-[11px] hover:text-indigo-500" onClick={() => { for (const text of sample) state.appendTranscript({ id: crypto.randomUUID(), at: new Date().toISOString(), text, source: 'manual' }); setTab('transcript') }}><MoreHorizontal size={16}/> サンプル会話を追加して試す</button> : <div className="muted text-center text-[10px]">「Claude、フローに整理して」と音声でも指示できます</div>}
            {meeting.endedAt && <button disabled={live} onClick={() => { if (confirm('この会議の履歴と保存データを削除しますか？')) state.deleteMeeting(meeting.id) }} className="mt-3 flex w-full items-center justify-center gap-1 text-[10px] text-red-500"><Trash2 size={13}/> この会議を削除</button>}
          </div>
        </aside>
      </div>

      {consentDialog && <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
        <div className="surface w-full max-w-[450px] rounded-2xl p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15"><ShieldCheck size={22}/></span><button aria-label="閉じる" onClick={() => setConsentDialog(false)}><X size={19}/></button></div>
          <h2 id="consent-title" className="text-lg font-bold">録音・文字起こしへの同意</h2>
          <p className="muted mt-3 text-xs leading-7">会議参加者全員に文字起こしについて説明し、同意を取得してください。マイク{captureSystem ? 'と選択した共有元の音声' : 'の音声'}はOpenAIの音声認識APIに送信されます。確定した文字起こしはClaude APIへの整理依頼に利用します。</p>
          <p className="muted mt-2 text-xs leading-6">このMVPでは録音ファイルを保存しません。生成された文章とホワイトボードだけがこのブラウザに保存されます。</p>
          <label className="stroke mt-5 flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-xs leading-6"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-1 accent-indigo-600"/>参加者全員に通知して同意を得ました。外部サービスへの音声・文字起こしの送信を理解しています。</label>
          <div className="mt-5 flex justify-end gap-2"><button className="pill" onClick={() => setConsentDialog(false)}>キャンセル</button><button disabled={!agreed} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white" onClick={() => void begin()}><Check size={16}/> 録音を開始</button></div>
        </div>
      </div>}
    </div>
  )
}
