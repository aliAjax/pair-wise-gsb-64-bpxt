import { configureStore } from '@reduxjs/toolkit'
import haccpReducer, { hydrateFromStorage, recoverPersistedState, STORAGE_KEY, type HaccpState } from './haccpSlice'
import workspaceReducer, { clearPersistenceNotice, setPersistenceNotice } from './workspaceSlice'
import { haccpApi } from '../services/api'

export const store = configureStore({
  reducer: {
    haccp: haccpReducer,
    workspace: workspaceReducer,
    [haccpApi.reducerPath]: haccpApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(haccpApi.middleware)
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// 最近一份完整写入成功的序列化快照，写入失败时据此恢复
let lastGoodSerialized: string | null = null
try {
  lastGoodSerialized = localStorage.getItem(STORAGE_KEY)
} catch {
  // 存储不可用时保持内存运行
}

let persistFailed = false
// 防止「恢复→仍写不进→再恢复」死循环：对同一份状态只尝试恢复一次
let lastRecoverInput: HaccpState | null = null

store.subscribe(() => {
  const state = store.getState().haccp
  let serialized: string
  try {
    serialized = JSON.stringify(state)
    localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    persistFailed = true
    if (state === lastRecoverInput) return
    lastRecoverInput = state
    if (!lastGoodSerialized) {
      store.dispatch(setPersistenceNotice('本地写入失败且无可用历史版本，当前修改仅保留在内存中。'))
      return
    }
    try {
      const snapshot = JSON.parse(lastGoodSerialized) as Partial<HaccpState>
      store.dispatch(recoverPersistedState(snapshot))
      store.dispatch(setPersistenceNotice('本地写入失败，已从最近完整版本恢复；刚才的操作未生效，请重试。'))
    } catch {
      store.dispatch(setPersistenceNotice('本地写入失败且历史版本损坏，当前修改仅保留在内存中。'))
    }
    return
  }
  lastGoodSerialized = serialized
  if (persistFailed) {
    persistFailed = false
    store.dispatch(clearPersistenceNotice())
  }
})

// 跨窗口同步：其他窗口写入后水合最新状态，使版本冲突校验基于最新数据
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || event.newValue == null) return
  try {
    if (JSON.stringify(store.getState().haccp) === event.newValue) return
    store.dispatch(hydrateFromStorage(JSON.parse(event.newValue)))
  } catch {
    // 忽略损坏的同步数据
  }
})
