import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'

/** 跨窗口提交冲突提示：后到者保留填写内容并显示冲突 */
export interface ConflictNotice {
  id: string
  entity: string
  message: string
  createdAt: string
}

interface WorkspaceState {
  conflicts: ConflictNotice[]
  persistenceNotice: string | null
}

/** 本窗口专属状态：不持久化、不随storage事件同步 */
const slice = createSlice({
  name: 'workspace',
  initialState: { conflicts: [], persistenceNotice: null } as WorkspaceState,
  reducers: {
    addConflict(state, action: PayloadAction<{ entity: string; message: string }>) {
      const existing = state.conflicts.find((item) => item.entity === action.payload.entity)
      if (existing) {
        existing.message = action.payload.message
        existing.createdAt = new Date().toISOString()
        return
      }
      state.conflicts.push({ id: nanoid(), ...action.payload, createdAt: new Date().toISOString() })
    },
    dismissConflict(state, action: PayloadAction<string>) {
      state.conflicts = state.conflicts.filter((item) => item.entity !== action.payload)
    },
    setPersistenceNotice(state, action: PayloadAction<string>) { state.persistenceNotice = action.payload },
    clearPersistenceNotice(state) { state.persistenceNotice = null }
  }
})

export const { addConflict, dismissConflict, setPersistenceNotice, clearPersistenceNotice } = slice.actions
export default slice.reducer
