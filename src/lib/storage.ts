import { get, set } from 'idb-keyval'
import type { Meeting } from '@/types/meeting'
const DB_KEY = 'meetings-app:v1'
export async function loadMeetings(): Promise<Meeting[]> {
  const data: unknown = await get(DB_KEY)
  return Array.isArray(data) ? data as Meeting[] : []
}
export async function saveMeetings(meetings: Meeting[]) {
  await set(DB_KEY, meetings)
}
