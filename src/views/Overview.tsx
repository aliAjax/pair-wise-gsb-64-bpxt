import { useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Badge, Button, Dropdown, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { setBatchFilter, setBatchStatus, setSelectedBatch } from '../store/haccpSlice'
import { submitBatchStatus, submitSignBatch } from '../store/thunks'
import { dismissConflict } from '../store/workspaceSlice'
import { evaluateMonitoring } from '../domain/release'
import type { BatchStatus } from '../types'
import { useLoadBatchSnapshotQuery } from '../services/api'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) => status === '隔离中' || status === '已报废' ? 'danger' : status === '已放行' ? 'success' : status === '可放行' ? 'important' : 'warning'
const resultColor = (result: string) => result === '超限' ? 'danger' : result === '符合' ? 'success' : 'warning'

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const conflicts = useSelector((root: RootState) => root.workspace.conflicts)
  const { isFetching } = useLoadBatchSnapshotQuery()
  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)
  const conflict = selected ? conflicts.find((item) => item.entity === selected.id) : undefined
  // 已签批次按固化的放行依据判定，未签批次随当前矩阵重算
  const evaluations = selected
    ? selected.releaseBasis?.evaluations ?? evaluateMonitoring(selected.monitoring, state.processSteps)
    : []
  const openDeviations = selectedDeviations.filter((item) => item.status !== '已关闭').length

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制</p><h1>生产批次与放行</h1></div><span className="sync-state">{isFetching ? '正在同步' : `批次快照已加载 · 当前矩阵V${state.matrixVersion}`}</span></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>隔离批次</span><strong>{state.batches.filter((item) => item.status === '隔离中').length}</strong><small>禁止放行</small></article>
        <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>需调查或复核</small></article>
        <article><span>已放行</span><strong>{state.batches.filter((item) => item.status === '已放行').length}</strong><small>已完成签字</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((status) => <Option key={status} value={status}>{status}</Option>)}
        </Dropdown>
        <span>点击批次查看监测点与偏差关系</span>
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>产线</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>放行依据</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                <TableCell>{batch.id}</TableCell><TableCell>{batch.product}</TableCell><TableCell>{batch.line}</TableCell>
                <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell>
                <TableCell>{batch.releaseBasis ? `矩阵V${batch.releaseBasis.matrixVersion} · 已签` : `矩阵V${state.matrixVersion} · 未签`}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </div>
        {selected && <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line} · 投产矩阵V{selected.matrixVersion}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>
          {conflict && <p className="conflict-banner"><span>{conflict.message}</span><Button size="small" appearance="subtle" onClick={() => dispatch(dismissConflict(selected.id))}>知道了</Button></p>}
          {selected.pendingReviewReason && <p className="validation-text review">{selected.pendingReviewReason}</p>}
          <dl>
            <div><dt>生产数量</dt><dd>{selected.quantity.toLocaleString()} 件</dd></div>
            <div><dt>隔离范围</dt><dd>{selected.isolationScope}</dd></div>
            <div><dt>关联偏差</dt><dd>{selectedDeviations.length} 项{openDeviations > 0 ? `（${openDeviations}项未关闭）` : ''}</dd></div>
          </dl>
          <h3>监测点判定{selected.releaseBasis ? `（依据已签矩阵V${selected.releaseBasis.matrixVersion}）` : `（按当前矩阵V${state.matrixVersion}重算）`}</h3>
          <div className="monitoring-list">{evaluations.map((item) => <div key={`${selected.id}-${item.stepId}`}><span>{item.controlPoint} · 限值 {item.limit}</span><strong>{item.value} {item.unit} <Badge appearance="tint" color={resultColor(item.result)}>{item.result}</Badge></strong><small>{item.correctiveAction ? `纠偏：${item.correctiveAction}` : '未配置纠偏措施'}</small></div>)}</div>
          {selected.releaseBasis && <div className="basis-card">
            <strong>放行依据（已固化，不受矩阵变更影响）</strong>
            <span>矩阵V{selected.releaseBasis.matrixVersion} · {selected.releaseBasis.signedBy} · {selected.releaseBasis.signedAt.replace('T', ' ').slice(0, 16)}</span>
            <span>监测判定 {selected.releaseBasis.evaluations.filter((item) => item.result === '符合').length}/{selected.releaseBasis.evaluations.length} 符合 · 关联偏差 {selected.releaseBasis.deviations.length} 项均已处置</span>
          </div>}
          <div className="record-actions">
            <Button appearance="secondary" disabled={openDeviations > 0 || selected.status === '可放行'} onClick={() => dispatch(submitBatchStatus(selected.id, '可放行', selected.version))}>提交放行复核</Button>
            <Button appearance="primary" disabled={selected.status !== '可放行'} onClick={() => dispatch(submitSignBatch(selected.id, selected.version, '质量负责人 秦岚'))}>签字放行</Button>
          </div>
          {openDeviations > 0 && <p className="validation-text">存在未关闭偏差，系统已阻止标记为可放行。</p>}
        </aside>}
      </div>
    </section>
  )
}
