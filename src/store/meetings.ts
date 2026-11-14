import { create } from 'zustand'
import type { Analysis, Meeting, TranscriptLine } from '@/types/meeting'
import { loadMeetings, saveMeetings } from '@/lib/storage'

type MeetingStore = {
  meetings: Meeting[]
  activeId: string | null
  ready: boolean
  load: () => Promise<void>
  newMeeting: () => void
  setActive: (id: string) => void
  rename: (title: string) => void
  appendTranscript: (line: TranscriptLine) => void
  applyAnalysis: (analysis: Analysis) => void
  setBoard: (snapshot: unknown, protectedIds: string[], deletedIds: string[]) => void
  stopMeeting: () => void
  deleteMeeting: (id: string) => void
}

let persistTimer: ReturnType<typeof setTimeout> | undefined
function persist(meetings: Meeting[]) {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { void saveMeetings(meetings).catch(console.error) }, 400)
}
function updateActive(state: MeetingStore, update: (meeting: Meeting) => Meeting) {
  const meetings = state.meetings.map(m => m.id === state.activeId ? update(m) : m)
  persist(meetings)
  return { meetings }
}

export const useMeetings = create<MeetingStore>((set) => ({
  meetings: [], activeId: null, ready: false,
  load: async () => {
    const meetings = await loadMeetings()
    set({ meetings, activeId: meetings[0]?.id ?? null, ready: true })
  },
  newMeeting: () => set(state => {
    const m: Meeting = {
      id: crypto.randomUUID(), title: `新しい会議 ${new Date().toLocaleDateString('ja-JP')}`,
      startedAt: new Date().toISOString(), endedAt: null,
      transcript: [], analysis: null, boardSnapshot: null,
      protectedShapeIds: [], deletedShapeIds: [],
    }
    const meetings = [m, ...state.meetings]
    persist(meetings)
    return { meetings, activeId: m.id }
  }),
  setActive: (id) => set(state => ({ activeId: state.meetings.some(m => m.id === id) ? id : state.activeId })),
  rename: title => set(state => updateActive(state, meeting => ({ ...meeting, title: title.slice(0, 100) }))),
  appendTranscript: line => set(state => updateActive(state, meeting => ({ ...meeting, transcript: [...meeting.transcript, line] }))),
  applyAnalysis: analysis => set(state => updateActive(state, meeting => ({ ...meeting, analysis }))),
  setBoard: (snapshot, protectedShapeIds, deletedShapeIds) => set(state => updateActive(state, m => ({ ...m, boardSnapshot: snapshot, protectedShapeIds, deletedShapeIds }))),
  stopMeeting: () => set(state => updateActive(state, m => ({ ...m, endedAt: new Date().toISOString() }))),
  deleteMeeting: id => set(state => {
    const meetings = state.meetings.filter(m => m.id !== id)
    persist(meetings)
    return { meetings, activeId: state.activeId === id ? (meetings[0]?.id ?? null) : state.activeId }
  }),
}))
