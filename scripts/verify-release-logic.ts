/**
 * 核心放行逻辑验证：直接驱动 slice reducer。
 * 运行：npx tsx scripts/verify-release-logic.ts
 */
import reducer, {
  confirmReleaseReview, createBatch, recordMonitoring, reviewDeviation, saveInvestigation, signRelease,
  updateBatchStatus, updateProcessStep, writeFailed,
  type HaccpState
} from '../src/store/haccpSlice'

let failures = 0
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name}`, extra ?? '') }
}

function fresh(): HaccpState {
  return reducer(undefined, { type: '@@init' })
}

// 1. 投产时固定矩阵版本
console.log('1. 投产固定矩阵版本')
{
  let s = fresh()
  s = reducer(s, createBatch({ product: '测试奶 1L', line: 'L1', quantity: 100, operator: '调度', mutationId: 'm1' }))
  const batch = s.batches[0]
  check('新批次矩阵版本=V1', batch.matrixVersion === 1)
  check('放行依据未签字', batch.releaseBasis.signedBy === '')
  check('审计含投产记录', s.audit.some((a) => a.action === '批次投产' && a.mutationId === 'm1'))
}

// 2. 矩阵变更：未签重算，已签保留依据并转复核
console.log('2. 矩阵变更按签字状态分流')
{
  let s = fresh()
  const step = { ...s.processSteps[1], limit: '≥ 75 ℃ / 15 s' } // 收紧杀菌限值
  s = reducer(s, updateProcessStep({ step, baseMatrixVersion: 1, operator: '质量主管', changeNote: '收紧杀菌限值', mutationId: 'm2' }))
  check('矩阵升到V2', s.matrixVersions[0].version === 2)
  const unsigned = s.batches.find((b) => b.id === 'B260929-01')!
  check('未签批次重算到V2', unsigned.matrixVersion === 2 && unsigned.releaseBasis.matrixVersion === 2)
  check('未签批次结论按新限值判定(70.8<75超限)', unsigned.releaseBasis.conclusions.find((c) => c.stepId === 'P2')!.result === '超限')
  const signedBatch = s.batches.find((b) => b.id === 'B260928-07')!
  check('已签批次保留原依据V1', signedBatch.releaseBasis.matrixVersion === 1 && signedBatch.matrixVersion === 1)
  check('已签批次签字未被清除', signedBatch.releaseBasis.signedBy === '质量负责人 秦岚')
  check('已签批次转复核', signedBatch.status === '待复核')
  check('已签批次原结论未重算(73.2仍按V1合格)', signedBatch.releaseBasis.conclusions.find((c) => c.stepId === 'P2')!.result === '合格')
  // 复核确认恢复原状态
  s = reducer(s, confirmReleaseReview({ id: 'B260928-07', baseVersion: signedBatch.version, operator: '质量负责人 秦岚', mutationId: 'm3' }))
  check('复核确认后恢复已放行', s.batches.find((b) => b.id === 'B260928-07')!.status === '已放行')
}

// 3. 两窗口提交：后到者冲突、保留内容、不覆盖签字
console.log('3. 并发提交冲突')
{
  let s = fresh()
  // 窗口A先把偏差推进到可签字链路：直接对批次签字（先置可放行）
  const batch = s.batches.find((b) => b.id === 'B260928-07')! // 已放行、已签
  const before = batch.releaseBasis.signedBy
  s = reducer(s, signRelease({ id: batch.id, baseVersion: batch.version, operator: '另一窗口 王五', mutationId: 'm4' }))
  const after = s.batches.find((b) => b.id === batch.id)!
  check('已签批次再次签字被拒绝', after.releaseBasis.signedBy === before)
  check('产生冲突记录', s.conflicts.some((c) => c.entity === batch.id && c.action === '签字放行'))
  check('冲突写入审计', s.audit.some((a) => a.action === '提交冲突' && a.entity === batch.id))

  // 偏差调查：窗口B基于旧版本提交
  let s2 = fresh()
  const dev = s2.deviations.find((d) => d.id === 'DEV-260929-01')!
  s2 = reducer(s2, saveInvestigation({ id: dev.id, investigation: { cause: 'A窗口原因', evidence: 'A窗口证据', decision: '返工', reworkInstruction: '' }, baseVersion: dev.version, operator: '窗口A', mutationId: 'm5' }))
  const v1 = s2.deviations.find((d) => d.id === dev.id)!
  s2 = reducer(s2, saveInvestigation({ id: dev.id, investigation: { cause: 'B窗口原因', evidence: 'B窗口证据', decision: '报废', reworkInstruction: '' }, baseVersion: dev.version, operator: '窗口B', mutationId: 'm6' }))
  const v2 = s2.deviations.find((d) => d.id === dev.id)!
  check('后到提交未覆盖先到内容', v2.investigation.cause === 'A窗口原因')
  check('后到提交产生冲突', s2.conflicts.some((c) => c.entity === dev.id && c.expectedVersion === dev.version && c.currentVersion === v1.version))
}

// 4. 幂等：同一 mutationId 重试不重复生成审计
console.log('4. 幂等重试')
{
  let s = fresh()
  const payload = { product: ' retry奶', line: 'L2', quantity: 50, operator: '调度', mutationId: 'm7' }
  s = reducer(s, createBatch(payload))
  const auditCount = s.audit.filter((a) => a.mutationId === 'm7').length
  const batchCount = s.batches.length
  s = reducer(s, createBatch(payload)) // 模拟重试
  check('重试未重复生成审计', s.audit.filter((a) => a.mutationId === 'm7').length === auditCount)
  check('重试未重复创建批次', s.batches.length === batchCount)
}

// 5. 写入失败：回滚到最近完整版本，重试成功且不重复审计
console.log('5. 写入失败恢复与重试')
{
  let s = fresh()
  const committed = s // 模拟已落盘的最近完整版本
  s = reducer(s, createBatch({ product: '失败批次', line: 'L1', quantity: 10, operator: '调度', mutationId: 'm8' }))
  check('提交后内存含新批次', s.batches.some((b) => b.product === '失败批次'))
  // 模拟持久化失败 → writeFailed 回滚
  s = reducer(s, writeFailed({ snapshot: committed, error: '模拟的存储写入失败', pending: { type: 'haccp/createBatch', payload: { product: '失败批次', line: 'L1', quantity: 10, operator: '调度', mutationId: 'm8' } } }))
  check('回滚到最近完整版本', !s.batches.some((b) => b.product === '失败批次'))
  check('记录写入失败与暂存', s.persistence.error === '模拟的存储写入失败' && s.persistence.pending !== null)
  // 重试（同一 mutationId）
  s = reducer(s, createBatch({ product: '失败批次', line: 'L1', quantity: 10, operator: '调度', mutationId: 'm8' }))
  check('重试后批次恢复', s.batches.some((b) => b.product === '失败批次'))
  check('审计只生成一次', s.audit.filter((a) => a.mutationId === 'm8').length === 1)
  check('暂存已清除', s.persistence.pending === null && s.persistence.error === null)
}

// 6. 监测补录：按批次锁定的矩阵版本重算；已签批次拒绝补录
console.log('6. 监测补录与冻结')
{
  let s = fresh()
  s = reducer(s, recordMonitoring({ batchId: 'B260929-02', stepId: 'P4', value: 0.41, unit: 'MPa', operator: '郑凯', mutationId: 'm9' }))
  const batch = s.batches.find((b) => b.id === 'B260929-02')!
  check('复测后P4结论转合格', batch.releaseBasis.conclusions.find((c) => c.stepId === 'P4')!.result === '合格')
  check('结论仍依据锁定矩阵V1', batch.releaseBasis.matrixVersion === 1)
  const signedBefore = s.batches.find((b) => b.id === 'B260928-07')!.version
  s = reducer(s, recordMonitoring({ batchId: 'B260928-07', stepId: 'P2', value: 99, unit: '℃', operator: '郑凯', mutationId: 'm10' }))
  const signedAfter = s.batches.find((b) => b.id === 'B260928-07')!
  check('已签批次拒绝补录', signedAfter.version === signedBefore && signedAfter.releaseBasis.conclusions.find((c) => c.stepId === 'P2')!.value === 73.2)
}

// 7. 未监测/超限阻止进入放行链路
console.log('7. 放行门禁')
{
  let s = fresh()
  s = reducer(s, updateBatchStatus({ id: 'B260929-02', status: '可放行', operator: '秦岚', mutationId: 'm11' }))
  check('存在未监测控制点时不得可放行', s.batches.find((b) => b.id === 'B260929-02')!.status === '待复核')
}

// 8. 偏差复核签字保护：已关闭后另一窗口提交不覆盖
console.log('8. 偏差复核签字保护')
{
  let s = fresh()
  const dev = s.deviations.find((d) => d.id === 'DEV-260929-02')! // 待复核
  s = reducer(s, reviewDeviation({ id: dev.id, approved: true, note: '证据充分', baseVersion: dev.version, operator: '质量负责人 秦岚', mutationId: 'm12' }))
  const closed = s.deviations.find((d) => d.id === dev.id)!
  check('复核通过后关闭', closed.status === '已关闭' && closed.reviewer === '质量负责人 秦岚')
  s = reducer(s, reviewDeviation({ id: dev.id, approved: false, note: '另一窗口退回', baseVersion: dev.version, operator: '另一窗口 王五', mutationId: 'm13' }))
  const after = s.deviations.find((d) => d.id === dev.id)!
  check('已关闭偏差不接受覆盖', after.status === '已关闭' && after.reviewNote === '证据充分')
  check('覆盖尝试产生冲突记录', s.conflicts.some((c) => c.entity === dev.id && c.action === '偏差复核'))
}

// 9. 冲突后可重新提交：冲突记录不触发幂等拦截
console.log('9. 冲突后重提交通路')
{
  let s = fresh()
  const dev = s.deviations.find((d) => d.id === 'DEV-260929-01')!
  s = reducer(s, saveInvestigation({ id: dev.id, investigation: { cause: 'A', evidence: 'A证', decision: '返工', reworkInstruction: '' }, baseVersion: dev.version, operator: '窗口A', mutationId: 'm14' }))
  const v1 = s.deviations.find((d) => d.id === dev.id)!.version
  // 窗口B用旧版本提交 → 冲突；随后用同一 mutationId 基于新版本重提 → 应成功
  s = reducer(s, saveInvestigation({ id: dev.id, investigation: { cause: 'B', evidence: 'B证', decision: '报废', reworkInstruction: '' }, baseVersion: dev.version, operator: '窗口B', mutationId: 'm15' }))
  check('旧版本提交被冲突拦截', s.deviations.find((d) => d.id === dev.id)!.investigation.cause === 'A')
  s = reducer(s, saveInvestigation({ id: dev.id, investigation: { cause: 'B', evidence: 'B证', decision: '报废', reworkInstruction: '' }, baseVersion: v1, operator: '窗口B', mutationId: 'm15' }))
  check('基于新版本重提交成功', s.deviations.find((d) => d.id === dev.id)!.investigation.cause === 'B')
  check('同一冲突不重复记录', s.conflicts.filter((c) => c.entity === dev.id && c.action === '提交偏差调查').length === 1)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
