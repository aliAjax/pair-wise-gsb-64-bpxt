import type { Batch, Deviation, MonitoringEvaluation, MonitoringValue, ProcessStep, ReleaseBasis } from '../types'

/**
 * 解析关键限值文本并对监测值判定。
 * 支持 "≤ 4 ℃"、"≥ 72 ℃ / 15 s"、"0.38-0.45 MPa"、"Fe 1.5 mm / SUS 2.0 mm" 等写法。
 * 无法解析时返回 null，对应结论为「未评估」，绝不凭空判合格。
 */
export function checkLimit(limit: string, value: number): boolean | null {
  const text = limit.trim()
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)/)
  if (range) return value >= Number(range[1]) && value <= Number(range[2])
  const lte = text.match(/≤\s*(\d+(?:\.\d+)?)/)
  if (lte) return value <= Number(lte[1])
  const gte = text.match(/≥\s*(\d+(?:\.\d+)?)/)
  if (gte) return value >= Number(gte[1])
  const firstNumber = text.match(/(\d+(?:\.\d+)?)/)
  if (firstNumber) return value <= Number(firstNumber[1])
  return null
}

/** 用指定矩阵版本对监测记录逐点判定，未签批次随当前矩阵重算，已签批次用签字快照 */
export function evaluateMonitoring(monitoring: MonitoringValue[], steps: ProcessStep[]): MonitoringEvaluation[] {
  return monitoring.map((item) => {
    const step = steps.find((entry) => entry.id === item.stepId)
    if (!step) {
      return { stepId: item.stepId, controlPoint: item.stepId, limit: '矩阵中无此控制点', correctiveAction: '', value: item.value, unit: item.unit, result: '未评估' }
    }
    const pass = checkLimit(step.limit, item.value)
    return {
      stepId: item.stepId,
      controlPoint: step.controlPoint,
      limit: step.limit,
      correctiveAction: step.correctiveAction,
      value: item.value,
      unit: item.unit,
      result: pass === null ? '未评估' : pass ? '符合' : '超限'
    }
  })
}

/** 签字放行时把批次、矩阵版本、偏差处置汇成同一份放行依据 */
export function buildReleaseBasis(batch: Batch, deviations: Deviation[], steps: ProcessStep[], matrixVersion: number, signedBy: string, signedAt: string): ReleaseBasis {
  return {
    matrixVersion,
    evaluations: evaluateMonitoring(batch.monitoring, steps),
    deviations: deviations
      .filter((item) => item.batchId === batch.id)
      .map((item) => ({ id: item.id, title: item.title, decision: item.investigation.decision, status: item.status })),
    signedBy,
    signedAt
  }
}
