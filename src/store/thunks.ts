import type { AppDispatch, RootState } from './index'
import { reviewDeviation, saveInvestigation, signBatch, updateBatchStatus, updateProcessStep } from './haccpSlice'
import { addConflict } from './workspaceSlice'
import type { BatchStatus, Investigation, ProcessStep } from '../types'

/**
 * 带乐观并发校验的提交动作：expectedVersion为开始填写时看到的版本。
 * 若实体已被其他窗口推进，则拒绝提交、记录冲突并保留本窗口填写内容；
 * 已签字的结论（已关闭偏差、已放行批次）一律不可覆盖。
 * 返回true表示提交成功，调用方据此决定是否清空草稿。
 */
type AppThunk = (dispatch: AppDispatch, getState: () => RootState) => boolean

export const submitProcessStep = (step: ProcessStep, expectedMatrixVersion: number, operator: string): AppThunk => (dispatch, getState) => {
  const current = getState().haccp.matrixVersion
  if (current !== expectedMatrixVersion) {
    dispatch(addConflict({ entity: '控制矩阵', message: `控制矩阵已在其他窗口更新至V${current}，你的修改内容已保留，请核对差异后基于新版本重新保存。` }))
    return false
  }
  dispatch(updateProcessStep({ step, operator }))
  return true
}

export const submitInvestigation = (id: string, investigation: Investigation, expectedVersion: number): AppThunk => (dispatch, getState) => {
  const deviation = getState().haccp.deviations.find((item) => item.id === id)
  if (!deviation) return false
  if (deviation.status === '已关闭') {
    dispatch(addConflict({ entity: id, message: `${id}已由${deviation.reviewer || '复核人'}签字关闭，你的填写内容已保留，未覆盖已签结论。` }))
    return false
  }
  if (deviation.version !== expectedVersion) {
    dispatch(addConflict({ entity: id, message: `${id}已在其他窗口更新至V${deviation.version}，你的填写内容已保留，请核对最新记录后再提交。` }))
    return false
  }
  dispatch(saveInvestigation({ id, investigation }))
  return true
}

export const submitReview = (id: string, approved: boolean, note: string, reviewer: string, expectedVersion: number): AppThunk => (dispatch, getState) => {
  const deviation = getState().haccp.deviations.find((item) => item.id === id)
  if (!deviation) return false
  if (deviation.status === '已关闭') {
    dispatch(addConflict({ entity: id, message: `${id}已由${deviation.reviewer || '复核人'}签字关闭，复核签字不可覆盖。` }))
    return false
  }
  if (deviation.version !== expectedVersion) {
    dispatch(addConflict({ entity: id, message: `${id}已在其他窗口更新至V${deviation.version}，本次复核未提交，请核对最新内容。` }))
    return false
  }
  dispatch(reviewDeviation({ id, approved, note, reviewer }))
  return true
}

export const submitBatchStatus = (id: string, status: BatchStatus, expectedVersion: number): AppThunk => (dispatch, getState) => {
  const batch = getState().haccp.batches.find((item) => item.id === id)
  if (!batch) return false
  if (batch.status === '已放行' || batch.status === '已报废') {
    dispatch(addConflict({ entity: id, message: `${id}已${batch.status}，已签结论不可覆盖。` }))
    return false
  }
  if (batch.version !== expectedVersion) {
    dispatch(addConflict({ entity: id, message: `${id}已在其他窗口更新至V${batch.version}（${batch.status}），本次操作未执行。` }))
    return false
  }
  dispatch(updateBatchStatus({ id, status }))
  return true
}

export const submitSignBatch = (id: string, expectedVersion: number, signedBy: string): AppThunk => (dispatch, getState) => {
  const batch = getState().haccp.batches.find((item) => item.id === id)
  if (!batch) return false
  if (batch.status === '已放行' && batch.releaseBasis) {
    dispatch(addConflict({ entity: id, message: `${id}已由${batch.releaseBasis.signedBy}签字放行（依据矩阵V${batch.releaseBasis.matrixVersion}），签字不可覆盖。` }))
    return false
  }
  if (batch.version !== expectedVersion) {
    dispatch(addConflict({ entity: id, message: `${id}已在其他窗口更新至V${batch.version}，本次签字未执行，请核对批次状态。` }))
    return false
  }
  dispatch(signBatch({ id, signedBy }))
  return true
}
