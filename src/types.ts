export type BatchStatus = '生产中' | '待复核' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'
export type ConclusionResult = '合格' | '超限' | '未监测'

export interface ProcessStep {
  id: string
  name: string
  equipment: string
  hazard: string
  controlPoint: string
  limit: string
  frequency: string
  correctiveAction: string
}

/** 控制矩阵的一个不可变版本，任何限值/纠偏变更都会生成新版本 */
export interface MatrixVersion {
  version: number
  steps: ProcessStep[]
  operator: string
  changeNote: string
  createdAt: string
}

export interface MonitoringValue {
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
}

/** 单个控制点的检验结论，限值与纠偏措施取自批次锁定的矩阵版本 */
export interface StepConclusion {
  stepId: string
  controlPoint: string
  limit: string
  correctiveAction: string
  value: number | null
  unit: string
  result: ConclusionResult
}

export interface DeviationSnapshot {
  id: string
  title: string
  status: DeviationStatus
  decision: DecisionType
}

/** 放行依据：批次投产时锁定矩阵版本，签字后冻结，矩阵变更不回写已签依据 */
export interface ReleaseBasis {
  matrixVersion: number
  evaluatedAt: string
  conclusions: StepConclusion[]
  deviations: DeviationSnapshot[]
  signedBy: string
  signedAt: string
}

export interface Batch {
  id: string
  product: string
  line: string
  quantity: number
  producedAt: string
  status: BatchStatus
  isolationScope: string
  monitoring: MonitoringValue[]
  matrixVersion: number
  releaseBasis: ReleaseBasis
  version: number
}

export interface Investigation {
  cause: string
  evidence: string
  decision: DecisionType
  reworkInstruction: string
}

export interface Deviation {
  id: string
  batchId: string
  stepId: string
  title: string
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  investigation: Investigation
  reviewNote: string
  reviewer: string
  version: number
}

export interface AuditEntry {
  id: string
  entity: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 幂等键：同一提交重试时不会重复生成审计 */
  mutationId?: string
}

/** 两窗口并发提交产生的冲突记录：后到者保留填写内容，不覆盖已签数据 */
export interface ConflictRecord {
  id: string
  entity: string
  entityType: '批次' | '偏差' | '控制矩阵'
  action: string
  expectedVersion: number
  currentVersion: number
  message: string
  createdAt: string
  dismissed: boolean
}

export interface PendingMutation {
  type: string
  payload: unknown
}

export interface PersistenceState {
  error: string | null
  recoveredAt: string
  pending: PendingMutation | null
}
