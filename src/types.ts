export type BatchStatus = '生产中' | '待复核' | '可放行' | '隔离中' | '已放行' | '已报废'
export type DeviationStatus = '待调查' | '调查中' | '待复核' | '已关闭'
export type DecisionType = '返工' | '报废' | '让步接收'

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

/** 控制矩阵的一个历史版本，矩阵每次变更都会生成新快照 */
export interface MatrixRevision {
  version: number
  steps: ProcessStep[]
  changedAt: string
  changedBy: string
  summary: string
}

export interface MonitoringValue {
  stepId: string
  value: number
  unit: string
  recordedAt: string
  operator: string
}

/** 单个监测点对照某一矩阵版本限值的判定结论 */
export interface MonitoringEvaluation {
  stepId: string
  controlPoint: string
  limit: string
  correctiveAction: string
  value: number
  unit: string
  result: '符合' | '超限' | '未评估'
}

/** 签字放行时固化的放行依据：矩阵版本 + 监测判定 + 偏差处置 + 签字人 */
export interface ReleaseBasis {
  matrixVersion: number
  evaluations: MonitoringEvaluation[]
  deviations: Array<{ id: string; title: string; decision: DecisionType; status: DeviationStatus }>
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
  /** 投产时固定的矩阵版本 */
  matrixVersion: number
  /** 签字时固化的放行依据；矩阵变更后保留，直至重新签字 */
  releaseBasis: ReleaseBasis | null
  /** 已签批次因矩阵变更转复核时的原因说明 */
  pendingReviewReason: string | null
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
}
