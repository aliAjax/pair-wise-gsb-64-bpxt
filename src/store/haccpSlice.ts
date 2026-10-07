import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'
import { seedAudit, seedBatches, seedDeviations, seedMatrixVersions } from '../data/seed'
import { loadPersisted } from '../services/persistence'
import { buildReleaseBasis, currentMatrix, hasBlockingConclusion, isSigned, snapshotDeviations } from '../services/releaseBasis'
import type {
  AuditEntry, Batch, BatchStatus, ConflictRecord, Deviation, Investigation,
  MatrixVersion, PendingMutation, PersistenceState, ProcessStep
} from '../types'

export interface HaccpState {
  batches: Batch[]
  deviations: Deviation[]
  processSteps: ProcessStep[]
  matrixVersions: MatrixVersion[]
  audit: AuditEntry[]
  conflicts: ConflictRecord[]
  persistence: PersistenceState
  batchFilter: string
  batchStatus: BatchStatus | '全部'
  selectedBatchId: string | null
}

const uiDefaults = { batchFilter: '', batchStatus: '全部' as const, selectedBatchId: seedBatches[0].id }

function seedState(): HaccpState {
  return {
    batches: seedBatches,
    deviations: seedDeviations,
    processSteps: seedMatrixVersions[0].steps,
    matrixVersions: seedMatrixVersions,
    audit: seedAudit,
    conflicts: [],
    persistence: { error: null, recoveredAt: '', pending: null },
    ...uiDefaults
  }
}

function initialState(): HaccpState {
  const persisted = loadPersisted<HaccpState>()
  if (persisted) return { ...persisted.state, ...uiDefaults, persistence: { error: null, recoveredAt: '', pending: null } }
  return seedState()
}

const now = () => new Date().toISOString()

function log(state: HaccpState, entity: string, action: string, operator: string, detail: string, mutationId?: string) {
  state.audit.unshift({ id: nanoid(), entity, action, operator, detail, createdAt: now(), mutationId })
}

/** 幂等键：同一提交的失败重试不会重复落审计，也不会重复执行业务变更；冲突记录不算已应用 */
function alreadyApplied(state: HaccpState, mutationId?: string): boolean {
  return Boolean(mutationId) && state.audit.some((entry) => entry.mutationId === mutationId && entry.action !== '提交冲突')
}

/** 重试成功或跨窗口同步已包含该提交时，清除写入失败暂存 */
function clearPendingIfMatches(state: HaccpState, mutationId?: string) {
  const pending = state.persistence.pending
  if (pending && mutationId && (pending.payload as { mutationId?: string }).mutationId === mutationId) {
    state.persistence.pending = null
    state.persistence.error = null
  }
}

function recordConflict(
  state: HaccpState,
  payload: { entity: string; entityType: ConflictRecord['entityType']; action: string; expectedVersion: number; currentVersion: number; message: string; operator: string; mutationId?: string }
) {
  const duplicated = state.conflicts.some((item) =>
    !item.dismissed && item.entity === payload.entity && item.action === payload.action &&
    item.expectedVersion === payload.expectedVersion && item.currentVersion === payload.currentVersion
  )
  if (duplicated) return
  state.conflicts.unshift({
    id: nanoid(), entity: payload.entity, entityType: payload.entityType, action: payload.action,
    expectedVersion: payload.expectedVersion, currentVersion: payload.currentVersion,
    message: payload.message, createdAt: now(), dismissed: false
  })
  log(state, payload.entity, '提交冲突', payload.operator, payload.message, payload.mutationId)
}

interface VersionedPayload {
  baseVersion: number
  operator: string
  mutationId: string
}

const slice = createSlice({
  name: 'haccp',
  initialState,
  reducers: {
    setBatchFilter(state, action: PayloadAction<string>) { state.batchFilter = action.payload },
    setBatchStatus(state, action: PayloadAction<BatchStatus | '全部'>) { state.batchStatus = action.payload },
    setSelectedBatch(state, action: PayloadAction<string | null>) { state.selectedBatchId = action.payload },

    /** 投产登记：批次在投产时固定当前控制矩阵版本 */
    createBatch(state, action: PayloadAction<{ product: string; line: string; quantity: number; operator: string; mutationId: string }>) {
      if (alreadyApplied(state, action.payload.mutationId)) return
      clearPendingIfMatches(state, action.payload.mutationId)
      const matrix = currentMatrix(state.matrixVersions)
      const id = `B${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(state.batches.length + 1).padStart(2, '0')}`
      const batch: Batch = {
        id, product: action.payload.product, line: action.payload.line, quantity: action.payload.quantity,
        producedAt: now(), status: '生产中', isolationScope: '无', monitoring: [],
        matrixVersion: matrix.version, releaseBasis: buildReleaseBasis([], matrix, state.deviations, id), version: 1
      }
      state.batches.unshift(batch)
      state.selectedBatchId = id
      log(state, id, '批次投产', action.payload.operator, `投产即固定控制矩阵V${matrix.version}作为放行依据`, action.payload.mutationId)
    },

    updateBatchStatus(state, action: PayloadAction<{ id: string; status: BatchStatus; operator: string; mutationId?: string }>) {
      if (alreadyApplied(state, action.payload.mutationId)) return
      clearPendingIfMatches(state, action.payload.mutationId)
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch) return
      const blocking = state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')
      if (action.payload.status === '可放行' && blocking) return
      if (action.payload.status === '可放行' && hasBlockingConclusion(batch)) return
      batch.status = action.payload.status
      batch.version += 1
      log(state, batch.id, '批次状态流转', action.payload.operator, `状态更新为${action.payload.status}`, action.payload.mutationId)
    },

    /** 监测补录/复测：仅未签批次可录，结论按批次锁定的矩阵版本重算 */
    recordMonitoring(state, action: PayloadAction<{ batchId: string; stepId: string; value: number; unit: string; operator: string; mutationId: string }>) {
      if (alreadyApplied(state, action.payload.mutationId)) return
      clearPendingIfMatches(state, action.payload.mutationId)
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch || isSigned(batch) || batch.status === '已放行' || batch.status === '已报废') return
      const matrix = state.matrixVersions.find((item) => item.version === batch.matrixVersion)
      if (!matrix) return
      const existing = batch.monitoring.find((item) => item.stepId === action.payload.stepId)
      if (existing) {
        existing.value = action.payload.value
        existing.unit = action.payload.unit
        existing.recordedAt = now()
        existing.operator = action.payload.operator
      } else {
        batch.monitoring.push({ stepId: action.payload.stepId, value: action.payload.value, unit: action.payload.unit, recordedAt: now(), operator: action.payload.operator })
      }
      batch.releaseBasis = buildReleaseBasis(batch.monitoring, matrix, state.deviations, batch.id)
      batch.version += 1
      log(state, batch.id, '记录监测值', action.payload.operator, `按矩阵V${batch.matrixVersion}限值重算检验结论`, action.payload.mutationId)
    },

    /** 签字放行：版本校验 + 不覆盖已有签字；放行依据随签字冻结 */
    signRelease(state, action: PayloadAction<{ id: string } & VersionedPayload>) {
      clearPendingIfMatches(state, action.payload.mutationId)
      if (alreadyApplied(state, action.payload.mutationId)) return
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch) return
      if (isSigned(batch)) {
        recordConflict(state, {
          entity: batch.id, entityType: '批次', action: '签字放行', expectedVersion: action.payload.baseVersion, currentVersion: batch.version,
          message: `该批次已由${batch.releaseBasis.signedBy}签字放行，本次提交未覆盖原签字。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      if (batch.version !== action.payload.baseVersion) {
        recordConflict(state, {
          entity: batch.id, entityType: '批次', action: '签字放行', expectedVersion: action.payload.baseVersion, currentVersion: batch.version,
          message: `另一窗口已提交新版本（V${batch.version}），本次签字未写入，请核对后重新提交。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      if (batch.status !== '可放行') return
      if (state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')) return
      if (hasBlockingConclusion(batch)) return
      batch.releaseBasis.signedBy = action.payload.operator
      batch.releaseBasis.signedAt = now()
      batch.releaseBasis.deviations = snapshotDeviations(state.deviations, batch.id)
      batch.status = '已放行'
      batch.version += 1
      log(state, batch.id, '签字放行', action.payload.operator, `依据控制矩阵V${batch.releaseBasis.matrixVersion}签字，放行依据已冻结`, action.payload.mutationId)
    },

    /** 已签批次因矩阵变更转入复核后，确认原放行依据仍然有效 */
    confirmReleaseReview(state, action: PayloadAction<{ id: string } & VersionedPayload>) {
      clearPendingIfMatches(state, action.payload.mutationId)
      if (alreadyApplied(state, action.payload.mutationId)) return
      const batch = state.batches.find((item) => item.id === action.payload.id)
      if (!batch || !isSigned(batch) || batch.status !== '待复核') return
      if (state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭')) return
      if (batch.version !== action.payload.baseVersion) {
        recordConflict(state, {
          entity: batch.id, entityType: '批次', action: '放行复核确认', expectedVersion: action.payload.baseVersion, currentVersion: batch.version,
          message: `另一窗口已提交新版本（V${batch.version}），复核确认未写入。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      batch.status = '已放行'
      batch.version += 1
      log(state, batch.id, '放行复核确认', action.payload.operator, `确认原放行依据（矩阵V${batch.releaseBasis.matrixVersion}）在新矩阵下仍然有效`, action.payload.mutationId)
    },

    /**
     * 控制矩阵变更：生成新矩阵版本。
     * 未签结论的批次按新限值/纠偏措施重算；已签批次保留原放行依据并转复核。
     */
    updateProcessStep(state, action: PayloadAction<{ step: ProcessStep; baseMatrixVersion: number; operator: string; changeNote: string; mutationId: string }>) {
      clearPendingIfMatches(state, action.payload.mutationId)
      if (alreadyApplied(state, action.payload.mutationId)) return
      const latest = currentMatrix(state.matrixVersions)
      if (latest.version !== action.payload.baseMatrixVersion) {
        recordConflict(state, {
          entity: 'MATRIX', entityType: '控制矩阵', action: '修改控制矩阵', expectedVersion: action.payload.baseMatrixVersion, currentVersion: latest.version,
          message: `另一窗口已发布矩阵V${latest.version}，您的修改基于V${action.payload.baseMatrixVersion}，已保留填写内容，请核对后重新提交。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      const step = action.payload.step
      if (!step.limit.trim() || !step.correctiveAction.trim() || !step.frequency.trim()) return
      const steps = latest.steps.map((item) => (item.id === step.id ? { ...step } : { ...item }))
      const next: MatrixVersion = { version: latest.version + 1, steps, operator: action.payload.operator, changeNote: action.payload.changeNote, createdAt: now() }
      state.matrixVersions.unshift(next)
      state.processSteps = steps
      log(state, 'MATRIX', '发布控制矩阵', action.payload.operator, `矩阵V${next.version}生效：${action.payload.changeNote}`, action.payload.mutationId)

      let recalculated = 0
      for (const batch of state.batches) {
        if (batch.status === '已报废') continue
        if (isSigned(batch)) {
          // 已签批次：保留原放行依据，仅转复核
          if (batch.status === '已放行') {
            batch.status = '待复核'
            batch.version += 1
            log(state, batch.id, '矩阵变更触发复核', action.payload.operator, `保留原放行依据（矩阵V${batch.releaseBasis.matrixVersion}），转复核确认是否仍然有效`)
          }
          continue
        }
        // 未签结论：按新矩阵重算
        batch.matrixVersion = next.version
        batch.releaseBasis = buildReleaseBasis(batch.monitoring, next, state.deviations, batch.id)
        if (batch.status === '可放行' && hasBlockingConclusion(batch)) {
          batch.status = '待复核'
          log(state, batch.id, '放行资格回退', action.payload.operator, `按矩阵V${next.version}重算后出现超限结论，退回待复核`)
        }
        batch.version += 1
        recalculated += 1
      }
      if (recalculated > 0) {
        log(state, 'MATRIX', '未签结论重算', action.payload.operator, `${recalculated}个未签批次已按矩阵V${next.version}重算检验结论`)
      }
    },

    createDeviation(state, action: PayloadAction<{ batchId: string; stepId: string; title: string; severity: '一般' | '重大'; owner: string; operator: string; mutationId: string }>) {
      if (alreadyApplied(state, action.payload.mutationId)) return
      clearPendingIfMatches(state, action.payload.mutationId)
      const batch = state.batches.find((item) => item.id === action.payload.batchId)
      if (!batch) return
      const deviation: Deviation = {
        id: `DEV-${Date.now().toString().slice(-8)}`, batchId: action.payload.batchId, stepId: action.payload.stepId,
        title: action.payload.title, severity: action.payload.severity, owner: action.payload.owner,
        status: '待调查', openedAt: now(), dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        reviewNote: '', reviewer: '', version: 1,
        investigation: { cause: '', evidence: '', decision: '返工', reworkInstruction: '' }
      }
      state.deviations.unshift(deviation)
      batch.status = '隔离中'
      batch.version += 1
      if (!isSigned(batch)) batch.releaseBasis.deviations = snapshotDeviations(state.deviations, batch.id)
      log(state, deviation.id, '创建偏差调查', action.payload.operator, `批次${batch.id}因${action.payload.title}进入隔离`, action.payload.mutationId)
    },

    saveInvestigation(state, action: PayloadAction<{ id: string; investigation: Investigation } & VersionedPayload>) {
      clearPendingIfMatches(state, action.payload.mutationId)
      if (alreadyApplied(state, action.payload.mutationId)) return
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      if (deviation.version !== action.payload.baseVersion) {
        recordConflict(state, {
          entity: deviation.id, entityType: '偏差', action: '提交偏差调查', expectedVersion: action.payload.baseVersion, currentVersion: deviation.version,
          message: `另一窗口已提交新版本（V${deviation.version}），您的调查内容已保留，未覆盖对方提交。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      if (!action.payload.investigation.cause.trim() || !action.payload.investigation.evidence.trim()) return
      deviation.investigation = action.payload.investigation
      deviation.status = '待复核'
      deviation.version += 1
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch && !isSigned(batch)) batch.releaseBasis.deviations = snapshotDeviations(state.deviations, batch.id)
      log(state, deviation.id, '提交偏差调查', action.payload.operator, `处置分支：${deviation.investigation.decision}`, action.payload.mutationId)
    },

    reviewDeviation(state, action: PayloadAction<{ id: string; approved: boolean; note: string } & VersionedPayload>) {
      clearPendingIfMatches(state, action.payload.mutationId)
      if (alreadyApplied(state, action.payload.mutationId)) return
      const deviation = state.deviations.find((item) => item.id === action.payload.id)
      if (!deviation) return
      if (deviation.status === '已关闭') {
        recordConflict(state, {
          entity: deviation.id, entityType: '偏差', action: '偏差复核', expectedVersion: action.payload.baseVersion, currentVersion: deviation.version,
          message: `该偏差已由${deviation.reviewer}复核关闭，本次提交未覆盖原复核签字。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      if (deviation.version !== action.payload.baseVersion) {
        recordConflict(state, {
          entity: deviation.id, entityType: '偏差', action: '偏差复核', expectedVersion: action.payload.baseVersion, currentVersion: deviation.version,
          message: `另一窗口已提交新版本（V${deviation.version}），复核意见已保留，未覆盖对方提交。`, operator: action.payload.operator, mutationId: action.payload.mutationId
        })
        return
      }
      if (action.payload.approved && !action.payload.note.trim()) return
      deviation.reviewNote = action.payload.note
      deviation.reviewer = action.payload.operator
      deviation.status = action.payload.approved ? '已关闭' : '调查中'
      deviation.version += 1
      const batch = state.batches.find((item) => item.id === deviation.batchId)
      if (batch) {
        if (!isSigned(batch)) batch.releaseBasis.deviations = snapshotDeviations(state.deviations, batch.id)
        if (action.payload.approved && !state.deviations.some((item) => item.batchId === batch.id && item.status !== '已关闭' && item.id !== deviation.id)) {
          batch.status = deviation.investigation.decision === '报废' ? '已报废' : '待复核'
          batch.version += 1
        }
      }
      log(state, deviation.id, action.payload.approved ? '复核通过' : '退回补证', action.payload.operator, action.payload.note || '退回调查', action.payload.mutationId)
    },

    dismissConflict(state, action: PayloadAction<string>) {
      const conflict = state.conflicts.find((item) => item.id === action.payload)
      if (conflict) conflict.dismissed = true
    },

    /** 写入失败：回滚到最近完整版本，暂存未落盘的提交以便幂等重试 */
    writeFailed(state, action: PayloadAction<{ snapshot: HaccpState; error: string; pending: PendingMutation | null }>) {
      if (state.persistence.error) return
      const snapshot = action.payload.snapshot
      state.batches = snapshot.batches
      state.deviations = snapshot.deviations
      state.processSteps = snapshot.processSteps
      state.matrixVersions = snapshot.matrixVersions
      state.audit = snapshot.audit
      state.conflicts = snapshot.conflicts
      state.persistence = { error: action.payload.error, recoveredAt: now(), pending: action.payload.pending }
    },

    clearPersistenceError(state) {
      state.persistence = { error: null, recoveredAt: '', pending: null }
    },

    /** 另一窗口写入了更新：同步域数据，保留本窗口的界面选择与未提交表单 */
    syncFromStorage(state, action: PayloadAction<HaccpState>) {
      const incoming = action.payload
      state.batches = incoming.batches
      state.deviations = incoming.deviations
      state.processSteps = incoming.processSteps
      state.matrixVersions = incoming.matrixVersions
      state.audit = incoming.audit
      state.conflicts = incoming.conflicts
      const pending = state.persistence.pending
      if (pending) {
        const mutationId = (pending.payload as { mutationId?: string }).mutationId
        if (mutationId && incoming.audit.some((entry) => entry.mutationId === mutationId)) {
          state.persistence = { error: null, recoveredAt: '', pending: null }
        }
      }
    },

    resetDemo() {
      return seedState()
    }
  }
})

export const {
  setBatchFilter, setBatchStatus, setSelectedBatch, createBatch, updateBatchStatus, recordMonitoring, signRelease, confirmReleaseReview,
  updateProcessStep, createDeviation, saveInvestigation, reviewDeviation,
  dismissConflict, writeFailed, clearPersistenceError, syncFromStorage, resetDemo
} = slice.actions
export default slice.reducer
