import { useDispatch, useSelector } from 'react-redux'
import { Button } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import {
  clearPersistenceError, confirmReleaseReview, createBatch, createDeviation, recordMonitoring, reviewDeviation,
  saveInvestigation, signRelease, updateBatchStatus, updateProcessStep
} from '../store/haccpSlice'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const retryMap: Record<string, (payload: any) => any> = {
  [signRelease.type]: signRelease,
  [confirmReleaseReview.type]: confirmReleaseReview,
  [saveInvestigation.type]: saveInvestigation,
  [reviewDeviation.type]: reviewDeviation,
  [updateProcessStep.type]: updateProcessStep,
  [createDeviation.type]: createDeviation,
  [createBatch.type]: createBatch,
  [recordMonitoring.type]: recordMonitoring,
  [updateBatchStatus.type]: updateBatchStatus
}

/** 写入失败提示：已从最近完整版本恢复，可用同一幂等键重试，不会重复生成审计 */
export function PersistenceBanner() {
  const dispatch = useDispatch<AppDispatch>()
  const persistence = useSelector((root: RootState) => root.haccp.persistence)
  if (!persistence.error) return null
  const retry = () => {
    const pending = persistence.pending
    if (!pending) return
    const action = retryMap[pending.type]
    if (action) dispatch(action(pending.payload))
  }
  return (
    <div className="persistence-banner">
      <div>
        <strong>写入失败，已从最近完整版本恢复</strong>
        <p>{persistence.error}{persistence.pending ? '；最近一次提交尚未保存，重试不会重复生成审计记录。' : '。'}</p>
      </div>
      <div className="banner-actions">
        {persistence.pending && <Button size="small" appearance="primary" onClick={retry}>重试提交</Button>}
        <Button size="small" appearance="subtle" onClick={() => dispatch(clearPersistenceError())}>{persistence.pending ? '放弃该提交' : '知道了'}</Button>
      </div>
    </div>
  )
}
