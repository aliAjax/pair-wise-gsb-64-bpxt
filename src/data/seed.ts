import type { AuditEntry, Batch, Deviation, MatrixVersion, ProcessStep } from '../types'
import { buildReleaseBasis } from '../services/releaseBasis'

export const processSteps: ProcessStep[] = [
  { id: 'P1', name: '原料验收', equipment: '冷藏收货台', hazard: '致病菌、温度失控', controlPoint: '原料中心温度', limit: '≤ 4 ℃', frequency: '每批', correctiveAction: '拒收并隔离供应商批次' },
  { id: 'P2', name: '巴氏杀菌', equipment: 'HTST-02', hazard: '致病菌残留', controlPoint: '杀菌温度', limit: '≥ 72 ℃ / 15 s', frequency: '连续记录', correctiveAction: '自动回流并触发偏差' },
  { id: 'P3', name: '金属探测', equipment: 'MD-06', hazard: '金属异物', controlPoint: 'Fe/SUS灵敏度', limit: 'Fe 1.5 mm / SUS 2.0 mm', frequency: '每半小时', correctiveAction: '隔离末次合格点以来产品' },
  { id: 'P4', name: '灌装封口', equipment: 'FILL-01', hazard: '密封不良', controlPoint: '封口压力', limit: '0.38-0.45 MPa', frequency: '每小时', correctiveAction: '停机调机并复检留样' },
  { id: 'P5', name: '终产品冷却', equipment: '冷却隧道', hazard: '芽孢萌发', controlPoint: '冷却结束温度', limit: '≤ 10 ℃ / 2 h', frequency: '每批', correctiveAction: '延长冷却并观察质量' }
]

export const seedMatrixVersions: MatrixVersion[] = [
  { version: 1, steps: processSteps, operator: '质量主管', changeNote: '年度评审后发布', createdAt: '2026-09-28T08:00:00' }
]

const seedMonitoring: Record<string, Batch['monitoring']> = {
  'B260929-01': [
    { stepId: 'P1', value: 3.4, unit: '℃', recordedAt: '2026-09-29T06:25:00', operator: '陈莉' },
    { stepId: 'P2', value: 70.8, unit: '℃', recordedAt: '2026-09-29T06:48:00', operator: '系统采集' },
    { stepId: 'P3', value: 1.5, unit: 'mm Fe', recordedAt: '2026-09-29T07:20:00', operator: '杨鸣' }
  ],
  'B260929-02': [
    { stepId: 'P4', value: 0.36, unit: 'MPa', recordedAt: '2026-09-29T08:40:00', operator: '系统采集' },
    { stepId: 'P5', value: 8.2, unit: '℃', recordedAt: '2026-09-29T10:10:00', operator: '郑凯' }
  ],
  'B260928-07': processSteps.map((step, index) => ({
    stepId: step.id,
    value: [3.0, 73.2, 1.2, 0.41, 7.8][index],
    unit: ['℃', '℃', 'mm Fe', 'MPa', '℃'][index],
    recordedAt: '2026-09-28T17:00:00',
    operator: '生产线记录'
  }))
}

export const seedDeviations: Deviation[] = [
  {
    id: 'DEV-260929-01', batchId: 'B260929-01', stepId: 'P2', title: '杀菌温度低于关键限值', severity: '重大', status: '调查中', owner: '质量工程组', openedAt: '2026-09-29T06:55:00', dueDate: '2026-09-29', version: 3,
    investigation: { cause: '蒸汽调节阀响应滞后', evidence: '趋势图显示70.8℃持续42秒；阀门检修记录已上传', decision: '返工', reworkInstruction: '隔离产品全部回流至平衡槽，重新杀菌并留样验证' }, reviewNote: '', reviewer: ''
  },
  {
    id: 'DEV-260929-02', batchId: 'B260929-02', stepId: 'P4', title: '封口压力偏低', severity: '一般', status: '待复核', owner: '设备保障组', openedAt: '2026-09-29T08:52:00', dueDate: '2026-09-30', version: 2,
    investigation: { cause: '气缸密封圈磨损', evidence: '压力曲线、拆检照片、备件领用单', decision: '返工', reworkInstruction: '更换密封圈，返封隔离产品并恢复压力。' }, reviewNote: '', reviewer: ''
  }
]

function seedBatch(
  id: string, product: string, line: string, quantity: number, producedAt: string,
  status: Batch['status'], isolationScope: string, version: number, signed?: { by: string; at: string }
): Batch {
  const matrix = seedMatrixVersions[0]
  const basis = buildReleaseBasis(seedMonitoring[id], matrix, seedDeviations, id)
  basis.evaluatedAt = producedAt
  if (signed) {
    basis.signedBy = signed.by
    basis.signedAt = signed.at
  }
  return { id, product, line, quantity, producedAt, status, isolationScope, monitoring: seedMonitoring[id], matrixVersion: matrix.version, releaseBasis: basis, version }
}

export const seedBatches: Batch[] = [
  seedBatch('B260929-01', '低温鲜奶 950mL', 'L1', 3200, '2026-09-29T06:20:00', '隔离中', '杀菌后至金属探测前全部在制品', 4),
  seedBatch('B260929-02', '原味酸奶 200g', 'L2', 8600, '2026-09-29T08:10:00', '待复核', 'FILL-01本次清洁后产品', 3),
  seedBatch('B260928-07', '低脂牛奶 1L', 'L1', 5100, '2026-09-28T16:20:00', '已放行', '无', 6, { by: '质量负责人 秦岚', at: '2026-09-28T18:30:00' })
]

export const seedAudit: AuditEntry[] = [
  { id: 'AUD-0', entity: 'MATRIX', action: '发布控制矩阵', operator: '质量主管', detail: '矩阵V1生效：年度评审后发布', createdAt: '2026-09-28T08:00:00' },
  { id: 'AUD-1', entity: 'B260929-01', action: '自动创建偏差', operator: '监控系统', detail: '杀菌温度70.8℃低于限值72℃，批次已隔离', createdAt: '2026-09-29T06:55:00' },
  { id: 'AUD-2', entity: 'DEV-260929-01', action: '提交调查', operator: '质量工程组', detail: '记录蒸汽阀响应滞后与趋势证据', createdAt: '2026-09-29T08:15:00' },
  { id: 'AUD-3', entity: 'B260929-02', action: '状态流转', operator: '杨鸣', detail: '由生产中转为待复核', createdAt: '2026-09-29T08:52:00' }
]
