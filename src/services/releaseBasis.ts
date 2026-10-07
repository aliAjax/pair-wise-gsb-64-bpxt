import type { Batch, ConclusionResult, Deviation, MatrixVersion, ProcessStep, ReleaseBasis, StepConclusion } from '../types'

/** 解析关键限值文本并判定实测值，无法解析时按未监测处理，避免误判放行 */
export function evaluateLimit(limit: string, value: number | null): ConclusionResult {
  if (value === null || Number.isNaN(value)) return '未监测'
  const text = limit.replace(/\s/g, '')
  const le = text.match(/≤([\d.]+)/)
  if (le) return value <= Number(le[1]) ? '合格' : '超限'
  const ge = text.match(/≥([\d.]+)/)
  if (ge) return value >= Number(ge[1]) ? '合格' : '超限'
  const range = text.match(/([\d.]+)[-–~]([\d.]+)/)
  if (range) return value >= Number(range[1]) && value <= Number(range[2]) ? '合格' : '超限'
  const maxMm = text.match(/([\d.]+)mm/i)
  if (maxMm) return value <= Number(maxMm[1]) ? '合格' : '超限'
  return '未监测'
}

export function buildConclusions(monitoring: Batch['monitoring'], steps: ProcessStep[]): StepConclusion[] {
  return steps.map((step) => {
    const record = monitoring.find((item) => item.stepId === step.id)
    return {
      stepId: step.id,
      controlPoint: step.controlPoint,
      limit: step.limit,
      correctiveAction: step.correctiveAction,
      value: record?.value ?? null,
      unit: record?.unit ?? '',
      result: evaluateLimit(step.limit, record?.value ?? null)
    }
  })
}

export function snapshotDeviations(deviations: Deviation[], batchId: string): ReleaseBasis['deviations'] {
  return deviations
    .filter((item) => item.batchId === batchId)
    .map((item) => ({ id: item.id, title: item.title, status: item.status, decision: item.investigation.decision }))
}

/** 依据指定矩阵版本重建未签结论；已签依据永远不走这里 */
export function buildReleaseBasis(
  monitoring: Batch['monitoring'],
  matrix: MatrixVersion,
  deviations: Deviation[],
  batchId: string
): ReleaseBasis {
  return {
    matrixVersion: matrix.version,
    evaluatedAt: new Date().toISOString(),
    conclusions: buildConclusions(monitoring, matrix.steps),
    deviations: snapshotDeviations(deviations, batchId),
    signedBy: '',
    signedAt: ''
  }
}

export function currentMatrix(matrixVersions: MatrixVersion[]): MatrixVersion {
  return matrixVersions[0]
}

/** 从限值文本推断计量单位，用于监测补录 */
export function unitForLimit(limit: string): string {
  if (limit.includes('℃')) return '℃'
  if (limit.includes('MPa')) return 'MPa'
  if (/mm/i.test(limit)) return 'mm Fe'
  return ''
}

export function matrixByVersion(matrixVersions: MatrixVersion[], version: number): MatrixVersion | undefined {
  return matrixVersions.find((item) => item.version === version)
}

export function isSigned(batch: Batch): boolean {
  return Boolean(batch.releaseBasis.signedBy)
}

/** 存在超限或未监测结论时不得进入放行链路 */
export function hasBlockingConclusion(batch: Batch): boolean {
  return batch.releaseBasis.conclusions.some((item) => item.result !== '合格')
}
