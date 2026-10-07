import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { MATRIX_INITIAL_VERSION, seedAudit, seedBatches, seedDeviations, seedMatrixRevisions, processSteps } from '../data/seed'
import { buildReleaseBasis } from '../domain/release'
import type { AuditEntry, Batch, BatchStatus, Deviation, Investigation, MatrixRevision, ProcessStep } from '../types'

export interface HaccpState {
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  matrixVersion: number
  matrixRevisions: MatrixRevision[]
  audit: AuditEntry[]
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

export const STORAGE_KEY = 'gsb64:haccp-platform'

function seedState(): HaccpState {
  return {
    batches: structuredClone(seedBatches),
    deviations: structuredClone(seedDeviations),
    processSteps: structuredClone(processSteps),
    matrixVersion: MATRIX_INITIAL_VERSION,
    matrixRevisions: structuredClone(seedMatrixRevisions),
    audit: structuredClone(seedAudit),
    batchFilter: '',
    batchStatus: '全部',
    selectedBatchId: seedBatches[0].id
  }
}

/** 兼容旧版持久化数据：补齐矩阵版本与放行依据字段 */
function normalize(persisted: Partial<HaccpState>): HaccpState {
  const base = seedState()
  const merged: HaccpState = { ...base, ...persisted }
  merged.matrixVersion = persisted.matrixVersion ?? MATRIX_INITIAL_VERSION
  merged.matrixRevisions = persisted.matrixRevisions?.length ? persisted.matrixRevisions : base.matrixRevisions
  merged.batches = (persisted.batches ?? base.batches).map((batch) => ({
    ...batch,
    matrixVersion: batch.matrixVersion ?? MATRIX_INITIAL_VERSION,
    releaseBasis: batch.releaseBasis ?? null,
    pendingReviewReason: batch.pendingReviewReason ?? null
  }))
  return merged
}

function initialState(): HaccpState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalize(JSON.parse(raw))
  } catch {
    // Seed data remains available when local storage is unavailable or corrupt.
  }
  return seedState()
}

/**
 * 审计ID按「实体#动作#版本」确定性生成并按ID去重：
 * 写入失败恢复后重试同一操作会得到相同ID，不会重复生成审计。
 */
function log(state: HaccpState, id: string, entity: string, action: string, operator: string, detail: string) {
  if (state.audit.some((entry) => entry.id === id)) return
  state.audit.unshift({ id, entity, action, operator, detail, createdAt: new Date().toISOString() })
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },
    updateProcessStep(state, action: PayloadAction<{ step: ProcessStep; operator: string }>) {
      const index = state.processSteps.findIndex((item) => item.id === action.payload.step.id)
      if (index < 0) return
      state.processSteps[index] = action.payload.step
      state.matrixVersion += 1
      state.matrixRevisions.unshift({
        version: state.matrixVersion,
        steps: state.processSteps.map((step) => ({ ...step })),
        changedAt: new Date().toISOString(),
        changedBy: action.payload.operator,
        summary: `更新${action.payload.step.name}关键限值或纠偏措施`
      })
      log(state, `MATRIX#矩阵版本变更#V${state.matrixVersion}`, '控制矩阵', '矩阵版本变更', action.payload.operator,
        `矩阵升级至V${state.matrixVersion}：${action.payload.step.name}限值或纠偏措施变化，未签结论按新矩阵重算`)
      // 限值或纠偏措施变化只影响未签结论；已签批次保留原放行依据并转复核
      for (const batch of state.batches) {
        if (batch.status !== '已放行') continue
        batch.status = '待复核'
        batch.pendingReviewReason = batch.releaseBasis
          ? `控制矩阵已变更至V${state.matrixVersion}，原放行依据V${batch.releaseBasis.matrixVersion}保留，需复核后重新签字`
          : `控制矩阵已变更至V${state.matrixVersion}，该批次缺少固化放行依据，需复核后重新签字`
        batch.version += 1
        log(state, `${batch.id}#矩阵变更转复核#V${batch.version}`, batch.id, '矩阵变更转复核', action.payload.operator,
          batch.releaseBasis ? `已签批次保留原依据V${batch.releaseBasis.matrixVersion}，转入复核` : '已签批次无固化依据，转入复核')
      }
    },
    updateBatchStatus(state, action: PayloadAction<{ id: string; status: BatchStatus }>) {
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch) return
      if (batch.status === '已放行' || batch.status === '已报废') return // 已签结论只能经复核流程变更
      if (action.payload.status === '已放行') return // 放行必须走signBatch固化放行依据
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      if (action.payload.status === '可放行' && blocking) return
      batch.status = action.payload.status
      batch.version += 1
      log(state, `${batch.id}#批次状态流转#V${batch.version}`, batch.id, '批次状态流转', '质量主管', `状态更新为${action.payload.status}`)
    },
    signBatch(state, action: PayloadAction<{ id: string; signedBy: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch || batch.status !== '可放行') return
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      if (blocking) return
      const now = new Date().toISOString()
      const previousBasis = batch.releaseBasis
      batch.releaseBasis = buildReleaseBasis(batch, state.deviations, state.processSteps, state.matrixVersion, action.payload.signedBy, now)
      batch.status = '已放行'
      batch.pendingReviewReason = null
      batch.version += 1
      log(state, `${batch.id}#签字放行#V${batch.version}`, batch.id, '签字放行', action.payload.signedBy,
        previousBasis
          ? `复核后依据矩阵V${state.matrixVersion}重新签字，原依据V${previousBasis.matrixVersion}已归档`
          : `依据矩阵V${state.matrixVersion}签字放行，放行依据已固化`)
    },
    createDeviation(state, action: PayloadAction<{ batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string }>) {
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      const now = new Date().toISOString()
      const deviation: Deviation = {
        id: `DEV-${Date.now().toString().slice(-8)}`, ...action.payload, status: '待调查', openedAt: now,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), reviewNote: '', reviewer: '', version: 1,
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
      }
      state.deviations.unshift(deviation)
      if (batch.status !== '已放行' && batch.status !== '已报废') {
        batch.status = '隔离中'
        batch.version += 1
      }
      log(state, `${deviation.id}#创建偏差调查#V1`, deviation.id, '创建偏差调查', '当前用户', `批次${batch.id}因${action.payload.title}进入隔离`)
    },
    saveInvestigation(state, action: PayloadAction<{ id: string; investigation: Investigation }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation || deviation.status === '已关闭') return // 已签字结论不可覆盖
      if (!action.payload.investigation.cause.trim() || !action.payload.investigation.evidence.trim()) return
      deviation.investigation = action.payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      log(state, `${deviation.id}#提交偏差调查#V${deviation.version}`, deviation.id, '提交偏差调查', deviation.owner, `处置分支：${deviation.investigation.decision}`)
    },
    reviewDeviation(state, action: PayloadAction<{ id: string; approved: boolean; note: string; reviewer: string }>) {
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation || deviation.status !== '待复核') return // 已签字或未到复核环节的结论不可覆盖
      if (action.payload.approved && !action.payload.note.trim()) return
      deviation.reviewNote = action.payload.note
      deviation.reviewer = action.payload.reviewer
      deviation.status = action.payload.approved ? '已关闭' : '调查中'
      deviation.version += 1
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch && action.payload.approved && !state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭' && item.id !== deviation.id)) {
        if (batch.status !== '已放行' && batch.status !== '已报废') {
          batch.status = deviation.investigation.decision === '报废' ? '已报废' : '待复核'
          batch.version += 1
        }
      }
      log(state, `${deviation.id}#偏差复核#V${deviation.version}`, deviation.id, action.payload.approved ? '复核通过' : '退回补证', action.payload.reviewer, action.payload.note || '退回调查')
    },
    /** 其他窗口写入后同步最新持久化状态，保留本窗口的筛选与选中 */
    hydrateFromStorage(state, action: PayloadAction<Partial<HaccpState>>) {
      const incoming = normalize(action.payload)
      return { ...incoming, batchFilter: state.batchFilter, batchStatus: state.batchStatus, selectedBatchId: state.selectedBatchId }
    },
    /** 写入失败后从最近完整版本恢复；恢复审计按快照确定性生成，重复恢复不重复记账 */
    recoverPersistedState(state, action: PayloadAction<Partial<HaccpState>>) {
      const snapshot = normalize(action.payload)
      const recoveryId = `RECOVERY#${snapshot.audit[0]?.id ?? 'EMPTY'}`
      if (state.audit.some((entry) => entry.id === recoveryId) && state.matrixVersion === snapshot.matrixVersion) return state
      const audit: AuditEntry[] = snapshot.audit.some((entry) => entry.id === recoveryId)
        ? snapshot.audit
        : [{ id: recoveryId, entity: '本地存储', action: '写入失败恢复', operator: '系统', detail: '持久化写入失败，已从最近完整版本恢复，刚才的操作未生效，请重试', createdAt: new Date().toISOString() }, ...snapshot.audit]
      return { ...snapshot, audit, batchFilter: state.batchFilter, batchStatus: state.batchStatus, selectedBatchId: state.selectedBatchId }
    },
    resetDemo() {
      return seedState()
    }
  }
})

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch,
  updateProcessStep, updateBatchStatus, signBatch,
  createDeviation, saveInvestigation, reviewDeviation,
  hydrateFromStorage, recoverPersistedState, resetDemo
} = slice.actions
export default slice.reducer
