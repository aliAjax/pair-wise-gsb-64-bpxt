import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { createDeviation } from '../store/haccpSlice'
import { submitInvestigation, submitReview } from '../store/thunks'
import { dismissConflict } from '../store/workspaceSlice'
import type { DecisionType, Deviation, Investigation } from '../types'

export function DeviationWorkbench() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const conflicts = useSelector((root: RootState) => root.workspace.conflicts)
  const [status, setStatus] = useState<Deviation['status'] | '全部'>('全部')
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [newDeviation, setNewDeviation] = useState({ batchId: state.batches[0]?.id ?? '', stepId: state.processSteps[0]?.id ?? '', title: '', severity: '一般' as const, owner: '质量工程组' })
  const rows = useMemo(() => state.deviations.filter((item) => status === '全部' || item.status === status), [state.deviations, status])
  const selected = state.deviations.find((item) => item.id === selectedId) ?? rows[0]
  // 本窗口的填写草稿与填写时所基于的版本：冲突时保留内容，不被其他窗口覆盖
  const [draft, setDraft] = useState<Investigation | null>(null)
  const [draftFor, setDraftFor] = useState<string | null>(null)
  const [editBase, setEditBase] = useState<{ id: string; version: number } | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const activeInvestigation = selected && draftFor === selected.id && draft ? draft : selected?.investigation
  const conflict = selected ? conflicts.find((item) => item.entity === selected.id) : undefined

  const selectDeviation = (id: string) => { setSelectedId(id); setDraft(null); setDraftFor(null); setEditBase(null); setReviewNote('') }
  const editInvestigation = (patch: Partial<Investigation>) => {
    if (!selected || !activeInvestigation) return
    if (editBase?.id !== selected.id) setEditBase({ id: selected.id, version: selected.version })
    setDraft({ ...activeInvestigation, ...patch })
    setDraftFor(selected.id)
  }
  const submit = () => {
    if (!selected || !activeInvestigation) return
    const baseVersion = editBase?.id === selected.id ? editBase.version : selected.version
    // 成功才清空草稿；冲突时草稿与复核意见保留，横幅提示
    if (dispatch(submitInvestigation(selected.id, activeInvestigation, baseVersion))) { setDraft(null); setDraftFor(null); setEditBase(null) }
  }
  const review = (approved: boolean) => {
    if (!selected) return
    const note = reviewNote.trim() || (approved ? '调查证据充分，纠偏措施可执行。' : '需补充设备故障诊断记录。')
    if (dispatch(submitReview(selected.id, approved, note, '质量负责人 秦岚', selected.version))) setReviewNote('')
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>关键限值偏离 / 调查与复核</p><h1>偏差处置工作台</h1></div><Button appearance="primary" onClick={() => setShowCreate(true)}>登记偏差</Button></header>
      <div className="toolbar"><Dropdown value={status} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue as typeof status)}>{['全部', '待调查', '调查中', '待复核', '已关闭'].map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown><span>调查完成前批次保持隔离，复核签字后才能恢复放行流程。</span></div>
      <div className="split-layout">
        <div className="deviation-list">{rows.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => selectDeviation(item.id)}>
          <div><Badge color={item.severity === '重大' ? 'danger' : 'warning'}>{item.severity}</Badge><small>{item.id}</small></div><strong>{item.title}</strong><span>{item.batchId} · {item.owner}</span><footer><Badge appearance="tint">{item.status}</Badge><span>{item.dueDate} 截止</span></footer>
        </button>)}</div>
        {selected && <div className="record-panel">
          <div className="record-title"><div><span>{selected.id} · V{selected.version}</span><h2>{selected.title}</h2></div><Badge color={selected.severity === '重大' ? 'danger' : 'warning'}>{selected.status}</Badge></div>
          {conflict && <p className="conflict-banner"><span>{conflict.message}</span><Button size="small" appearance="subtle" onClick={() => dispatch(dismissConflict(selected.id))}>知道了</Button></p>}
          {selected.status === '已关闭' && <p className="signature-line">复核签字：{selected.reviewer} · {selected.reviewNote}</p>}
          <Field label="原因判断"><Textarea disabled={selected.status === '已关闭'} value={activeInvestigation?.cause ?? ''} onChange={(_, data) => editInvestigation({ cause: data.value })} /></Field>
          <Field label="证据摘要"><Textarea disabled={selected.status === '已关闭'} value={activeInvestigation?.evidence ?? ''} onChange={(_, data) => editInvestigation({ evidence: data.value })} /></Field>
          <Field label="处置分支"><Dropdown disabled={selected.status === '已关闭'} value={activeInvestigation?.decision} selectedOptions={[activeInvestigation?.decision ?? '返工']} onOptionSelect={(_, data) => editInvestigation({ decision: data.optionValue as DecisionType })}>{['返工', '报废', '让步接收'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown></Field>
          <Field label="返工或报废指令"><Textarea disabled={selected.status === '已关闭'} value={activeInvestigation?.reworkInstruction ?? ''} onChange={(_, data) => editInvestigation({ reworkInstruction: data.value })} /></Field>
          <Field label="复核意见"><Textarea disabled={selected.status !== '待复核'} value={reviewNote} onChange={(_, data) => setReviewNote(data.value)} placeholder="签字前填写复核意见" /></Field>
          <div className="record-actions">
            <Button disabled={selected.status === '已关闭' || !activeInvestigation?.cause || !activeInvestigation?.evidence} onClick={submit}>提交调查</Button>
            <Button appearance="primary" disabled={selected.status !== '待复核'} onClick={() => review(true)}>复核通过</Button>
            <Button appearance="subtle" disabled={selected.status !== '待复核'} onClick={() => review(false)}>退回补充证据</Button>
          </div>
        </div>}
      </div>
      {showCreate && <div className="edit-panel">
        <h3>登记关键限值偏差</h3>
        <div className="edit-grid">
          <Field label="批次"><Dropdown value={newDeviation.batchId} selectedOptions={[newDeviation.batchId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, batchId: data.optionValue ?? '' })}>{state.batches.map((item) => <Option key={item.id} value={item.id} text={`${item.id} ${item.product}`}>{item.id} {item.product}</Option>)}</Dropdown></Field>
          <Field label="控制点"><Dropdown value={newDeviation.stepId} selectedOptions={[newDeviation.stepId]} onOptionSelect={(_, data) => setNewDeviation({ ...newDeviation, stepId: data.optionValue ?? '' })}>{state.processSteps.map((item) => <Option key={item.id} value={item.id} text={item.name}>{item.name}</Option>)}</Dropdown></Field>
          <Field label="偏差标题"><Input value={newDeviation.title} onChange={(_, data) => setNewDeviation({ ...newDeviation, title: data.value })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" disabled={!newDeviation.title || !newDeviation.batchId} onClick={() => { dispatch(createDeviation(newDeviation)); setShowCreate(false) }}>创建并隔离批次</Button></div>
      </div>}
    </section>
  )
}
