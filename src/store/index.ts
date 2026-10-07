import { configureStore, isAnyOf, type Middleware } from '@reduxjs/toolkit'
import haccpReducer, {
  confirmReleaseReview, createBatch, createDeviation, recordMonitoring, reviewDeviation,
  saveInvestigation, signRelease, syncFromStorage, updateBatchStatus, updateProcessStep, writeFailed,
  type HaccpState
} from './haccpSlice'
import { haccpApi } from '../services/api'
import { MAIN_KEY, TAB_ID, loadPersisted, persistState, readIncomingDoc } from '../services/persistence'
import type { PendingMutation } from '../types'

/** 需要落盘失败可重试的提交型动作 */
const commitActions = isAnyOf(
  createBatch, updateBatchStatus, recordMonitoring, signRelease, confirmReleaseReview,
  updateProcessStep, createDeviation, saveInvestigation, reviewDeviation
)

let lastMutation: PendingMutation | null = null

/** 记录最近一次提交型动作，写入失败时据此生成可重试的暂存 */
const mutationTracker: Middleware = () => (next) => (action) => {
  if (commitActions(action)) {
    lastMutation = { type: action.type, payload: action.payload }
  }
  return next(action)
}

export const store = configureStore({
  reducer: {
    haccp: haccpReducer,
    [haccpApi.reducerPath]: haccpApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(mutationTracker, haccpApi.middleware)
})

let lastCommitted: HaccpState = store.getState().haccp
let lastDocVersion = loadPersisted<HaccpState>()?.docVersion ?? 0
let syncingFromStorage = false

store.subscribe(() => {
  const state = store.getState().haccp
  if (syncingFromStorage || state === lastCommitted) return
  const result = persistState(state, lastDocVersion)
  if (result.ok) {
    lastDocVersion = result.docVersion
    lastCommitted = state
    return
  }
  // 写入失败：回滚到最近完整版本，提交内容进入暂存等待重试
  if (!store.getState().haccp.persistence.error) {
    const pending = lastMutation
    lastMutation = null
    store.dispatch(writeFailed({ snapshot: lastCommitted, error: result.error, pending }))
  }
})

/** 跨窗口同步：另一标签页写入新版本时并入本窗口，后到提交将触发版本冲突检查 */
window.addEventListener('storage', (event) => {
  if (event.key !== MAIN_KEY) return
  const doc = readIncomingDoc<HaccpState>(event.newValue)
  if (!doc || doc.writer === TAB_ID) return
  if (doc.docVersion < lastDocVersion || (doc.docVersion === lastDocVersion && doc.writer <= TAB_ID)) return
  lastDocVersion = doc.docVersion
  syncingFromStorage = true
  store.dispatch(syncFromStorage(doc.state))
  syncingFromStorage = false
  lastCommitted = store.getState().haccp
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
