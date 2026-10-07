import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { nanoid } from '@reduxjs/toolkit'
import { Badge, Button, Dropdown, Field, Input, Option, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { confirmReleaseReview, createBatch, recordMonitoring, setBatchFilter, setBatchStatus, setSelectedBatch, signRelease, updateBatchStatus } from '../store/haccpSlice'
import type { BatchStatus } from '../types'
import { useLoadBatchSnapshotQuery } from '../services/api'
import { unitForLimit } from '../services/releaseBasis'
import { ConflictBanner } from '../components/ConflictBanner'

const statuses: Array<BatchStatus | '全部'> = ['全部', '生产中', '待复核', '可放行', '隔离中', '已放行', '已报废']
const statusColor = (status: BatchStatus) => status === '隔离中' || status === '已报废' ? 'danger' : status === '已放行' ? 'success' : status === '可放行' ? 'important' : 'warning'
const resultColor = (result: string) => result === '超限' ? 'danger' : result === '合格' ? 'success' : 'warning'
const QA_OPERATOR = '质量负责人 秦岚'

export function Overview() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const { isFetching } = useLoadBatchSnapshotQuery()
  const [showCreate, setShowCreate] = useState(false)
  const [newBatch, setNewBatch] = useState({ product: '', line: 'L1', quantity: 1000 })
  const [monitoring, setMonitoring] = useState({ stepId: 'P1', value: '' })
  const rows = useMemo(() => state.batches.filter((batch) => {
    const text = `${batch.id} ${batch.product} ${batch.line}`.toLowerCase()
    return (!state.batchFilter || text.includes(state.batchFilter.toLowerCase())) && (state.batchStatus === '全部' || batch.status === state.batchStatus)
  }), [state.batches, state.batchFilter, state.batchStatus])
  const selected = state.batches.find((item) => item.id === state.selectedBatchId) ?? rows[0]
  const selectedDeviations = state.deviations.filter((item) => item.batchId === selected?.id)
  const openDeviations = selectedDeviations.filter((item) => item.status !== '已关闭')
  const latestMatrix = state.matrixVersions[0]
  const signed = Boolean(selected?.releaseBasis.signedBy)
  const staleBasis = selected ? selected.matrixVersion < latestMatrix.version : false
  const canRecord = selected ? !signed && selected.status !== '已放行' && selected.status !== '已报废' : false
  const unmonitored = selected ? selected.releaseBasis.conclusions.filter((item) => item.result === '未监测') : []

  return (
    <section className="page">
      <header className="page-head"><div><p>质量运营中心 / 批次控制</p><h1>生产批次与放行</h1></div><div className="head-actions"><span className="sync-state">{isFetching ? '正在同步' : '批次快照已加载'}</span><Button appearance="primary" onClick={() => setShowCreate(true)}>投产登记</Button></div></header>
      <div className="metrics">
        <article><span>今日批次</span><strong>{state.batches.length}</strong><small>覆盖2条生产线</small></article>
        <article><span>隔离批次</span><strong>{state.batches.filter((item) => item.status === '隔离中').length}</strong><small>禁止放行</small></article>
        <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>需调查或复核</small></article>
        <article><span>待复核</span><strong>{state.batches.filter((item) => item.status === '待复核').length}</strong><small>含矩阵变更触发</small></article>
      </div>
      <div className="toolbar">
        <Input value={state.batchFilter} onChange={(_, data) => dispatch(setBatchFilter(data.value))} placeholder="搜索批次、产品、产线" />
        <Dropdown value={state.batchStatus} selectedOptions={[state.batchStatus]} onOptionSelect={(_, data) => dispatch(setBatchStatus(data.optionValue as BatchStatus | '全部'))}>
          {statuses.map((status) => <Option key={status} value={status}>{status}</Option>)}
        </Dropdown>
        <span>当前控制矩阵 V{latestMatrix.version} · 投产时固定矩阵版本作为放行依据</span>
      </div>
      <div className="split-layout">
        <div className="table-panel">
          <Table size="small" aria-label="生产批次">
            <TableHeader><TableRow><TableHeaderCell>批次</TableHeaderCell><TableHeaderCell>产品</TableHeaderCell><TableHeaderCell>产线</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>矩阵</TableHeaderCell></TableRow></TableHeader>
            <TableBody>
              {rows.map((batch) => <TableRow key={batch.id} onClick={() => dispatch(setSelectedBatch(batch.id))} className={batch.id === selected?.id ? 'selected-row' : ''}>
                <TableCell>{batch.id}</TableCell><TableCell>{batch.product}</TableCell><TableCell>{batch.line}</TableCell>
                <TableCell><Badge appearance="tint" color={statusColor(batch.status)}>{batch.status}</Badge></TableCell>
                <TableCell><Badge appearance="outline" color={batch.matrixVersion < latestMatrix.version ? 'warning' : 'informative'}>V{batch.matrixVersion}</Badge></TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </div>
        {selected && <aside className="record-panel">
          <div className="record-title"><div><span>{selected.id} · {selected.line} · 实体V{selected.version}</span><h2>{selected.product}</h2></div><Badge color={statusColor(selected.status)}>{selected.status}</Badge></div>
          <ConflictBanner entity={selected.id} />
          <dl>
            <div><dt>生产数量</dt><dd>{selected.quantity.toLocaleString()} 件</dd></div>
            <div><dt>隔离范围</dt><dd>{selected.isolationScope}</dd></div>
            <div><dt>放行依据</dt><dd>控制矩阵 V{selected.releaseBasis.matrixVersion}{staleBasis ? '（历史版本）' : ''}</dd></div>
            <div><dt>签字</dt><dd>{signed ? `${selected.releaseBasis.signedBy} · ${selected.releaseBasis.signedAt.slice(5, 16).replace('T', ' ')}` : '未签结论'}</dd></div>
          </dl>
          {staleBasis && signed && <p className="basis-note">矩阵已更新至V{latestMatrix.version}，本批次保留原放行依据，待复核确认。</p>}
          {!signed && <p className="basis-note muted">结论未签字，矩阵变更时将按新限值与纠偏措施重算。</p>}
          <h3>检验结论（依据矩阵V{selected.releaseBasis.matrixVersion}限值判定）</h3>
          <div className="monitoring-list">
            {selected.releaseBasis.conclusions.map((item) => <div key={`${selected.id}-${item.stepId}`}>
              <span>{item.controlPoint} · 限值 {item.limit}</span>
              <strong>{item.value === null ? '—' : `${item.value} ${item.unit}`} <Badge appearance="tint" color={resultColor(item.result)}>{item.result}</Badge></strong>
              {item.result === '超限' && <small>纠偏：{item.correctiveAction}</small>}
            </div>)}
          </div>
          <h3>关联偏差处置（{selected.releaseBasis.deviations.length}）</h3>
          <div className="monitoring-list">
            {selected.releaseBasis.deviations.length === 0 && <div><span>无关联偏差</span></div>}
            {selected.releaseBasis.deviations.map((item) => <div key={item.id}><span>{item.id} · {item.title}</span><strong><Badge appearance="tint" color={item.status === '已关闭' ? 'success' : 'warning'}>{item.status}</Badge> {item.decision}</strong></div>)}
          </div>
          {canRecord && <div className="monitoring-form">
            <Dropdown size="small" value={state.processSteps.find((step) => step.id === monitoring.stepId)?.controlPoint} selectedOptions={[monitoring.stepId]} onOptionSelect={(_, data) => setMonitoring({ ...monitoring, stepId: data.optionValue ?? 'P1' })}>
              {state.processSteps.map((step) => <Option key={step.id} value={step.id} text={step.controlPoint}>{step.controlPoint}</Option>)}
            </Dropdown>
            <Input size="small" type="number" value={monitoring.value} placeholder="实测值" onChange={(_, data) => setMonitoring({ ...monitoring, value: data.value })} />
            <Button size="small" disabled={monitoring.value === ''} onClick={() => { dispatch(recordMonitoring({ batchId: selected.id, stepId: monitoring.stepId, value: Number(monitoring.value), unit: unitForLimit(selected.releaseBasis.conclusions.find((item) => item.stepId === monitoring.stepId)?.limit ?? ''), operator: '生产线记录', mutationId: nanoid() })); setMonitoring({ ...monitoring, value: '' }) }}>记录监测</Button>
          </div>}
          <div className="record-actions">
            {signed && selected.status === '待复核'
              ? <Button appearance="primary" onClick={() => dispatch(confirmReleaseReview({ id: selected.id, baseVersion: selected.version, operator: QA_OPERATOR, mutationId: nanoid() }))}>复核确认原放行有效</Button>
              : <>
                <Button appearance="secondary" disabled={openDeviations.length > 0 || signed || selected.releaseBasis.conclusions.some((item) => item.result !== '合格')} onClick={() => dispatch(updateBatchStatus({ id: selected.id, status: '可放行', operator: QA_OPERATOR, mutationId: nanoid() }))}>提交放行复核</Button>
                <Button appearance="primary" disabled={selected.status !== '可放行' || signed} onClick={() => dispatch(signRelease({ id: selected.id, baseVersion: selected.version, operator: QA_OPERATOR, mutationId: nanoid() }))}>签字放行</Button>
              </>}
          </div>
          {openDeviations.length > 0 && <p className="validation-text">存在未关闭偏差，系统已阻止标记为可放行。</p>}
          {selected.releaseBasis.conclusions.some((item) => item.result === '超限') && <p className="validation-text">存在超限结论，需按纠偏措施处置并登记偏差后才能放行。</p>}
          {unmonitored.length > 0 && <p className="validation-text">{unmonitored.length}个控制点尚未监测或无法判定，补录监测值前不得放行。</p>}
        </aside>}
      </div>
      {showCreate && <div className="edit-panel">
        <h3>投产登记（固定当前矩阵V{latestMatrix.version}）</h3>
        <div className="edit-grid">
          <Field label="产品"><Input value={newBatch.product} onChange={(_, data) => setNewBatch({ ...newBatch, product: data.value })} placeholder="如：低温鲜奶 950mL" /></Field>
          <Field label="产线"><Dropdown value={newBatch.line} selectedOptions={[newBatch.line]} onOptionSelect={(_, data) => setNewBatch({ ...newBatch, line: data.optionValue ?? 'L1' })}>{['L1', 'L2'].map((line) => <Option key={line} value={line}>{line}</Option>)}</Dropdown></Field>
          <Field label="数量"><Input type="number" value={String(newBatch.quantity)} onChange={(_, data) => setNewBatch({ ...newBatch, quantity: Number(data.value) || 0 })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" disabled={!newBatch.product.trim() || newBatch.quantity <= 0} onClick={() => { dispatch(createBatch({ ...newBatch, operator: '生产调度', mutationId: nanoid() })); setShowCreate(false); setNewBatch({ product: '', line: 'L1', quantity: 1000 }) }}>登记投产</Button></div>
      </div>}
    </section>
  )
}
