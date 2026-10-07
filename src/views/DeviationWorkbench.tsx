import { useEffect, useMemo, useState } from 'react'
import { nanoid } from '@reduxjs/toolkit'
import { Badge, Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { createDeviation, reviewDeviation, saveInvestigation } from '../store/haccpSlice'
import type { DecisionType, Deviation, Investigation } from '../types'
import { ConflictBanner } from '../components/ConflictBanner'

const REVIEWER = '质量负责人 秦岚'

interface Draft {
  id: string
  baseVersion: number
  mutationId: string
  value: Investigation
}

export function DeviationWorkbench() {
  const dispatch = useDispatch<AppDispatch>()
  const state = useSelector((root: RootState) => root.haccp)
  const [status, setStatus] = useState<Deviation['status'] | '全部'>('全部')
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [newDeviation, setNewDeviation] = useState({ batchId: state.batches[0]?.id ?? '', stepId: state.processSteps[0]?.id ?? '', title: '', severity: '一般' as const, owner: '质量工程组' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null)
  const rows = useMemo(() => state.deviations.filter((item) => status === '全部' || item.status === status), [state.deviations, status])
  const selected = state.deviations.find((item) => item.id === selectedId) ?? rows[0]
  const activeDraft = draft && selected && draft.id === selected.id ? draft : null
  const investigation = activeDraft?.value ?? selected?.investigation

  const draftApplied = useSelector((root: RootState) => activeDraft ? root.haccp.audit.some((entry) => entry.mutationId === activeDraft.mutationId && entry.action !== '提交冲突') : false)
  const draftConflicted = useSelector((root: RootState) => activeDraft ? root.haccp.conflicts.some((item) => item.entity === activeDraft.id && !item.dismissed) : false)
  // 提交成功后清空草稿；冲突时保留填写内容，仅把基准版本刷新到当前版本以便重新提交
  useEffect(() => { if (draftApplied) setDraft(null) }, [draftApplied])
  useEffect(() => {
    if (draftConflicted && selected) setDraft((current) => current ? { ...current, baseVersion: selected.version, mutationId: nanoid() } : current)
  }, [draftConflicted, selected?.version])

  // 复核意见同样在应用后才清空，冲突时保留
  const reviewApplied = useSelector((root: RootState) => reviewMutationId ? root.haccp.audit.some((entry) => entry.mutationId === reviewMutationId && entry.action !== '提交冲突') : false)
  useEffect(() => {
    if (reviewApplied) {
      setReviewNote('')
      setReviewMutationId(null)
    }
  }, [reviewApplied])

  const editInvestigation = (patch: Partial<Investigation>) => {
    if (!selected || !investigation) return
    setDraft({
      id: selected.id,
      baseVersion: activeDraft?.baseVersion ?? selected.version,
      mutationId: activeDraft?.mutationId ?? nanoid(),
      value: { ...investigation, ...patch }
    })
  }

  const submitInvestigation = () => {
    if (!selected || !investigation) return
    dispatch(saveInvestigation({
      id: selected.id, investigation,
      baseVersion: activeDraft?.baseVersion ?? selected.version,
      operator: selected.owner, mutationId: activeDraft?.mutationId ?? nanoid()
    }))
  }

  const submitReview = (approved: boolean) => {
    if (!selected) return
    const mutationId = nanoid()
    dispatch(reviewDeviation({
      id: selected.id, approved, note: reviewNote || (approved ? '调查证据充分，纠偏措施可执行。' : '需补充设备故障诊断记录。'),
      baseVersion: selected.version, operator: REVIEWER, mutationId
    }))
    setReviewMutationId(mutationId)
  }

  return (
    <section className="page">
      <header className="page-head"><div><p>关键限值偏离 / 调查与复核</p><h1>偏差处置工作台</h1></div><Button appearance="primary" onClick={() => setShowCreate(true)}>登记偏差</Button></header>
      <div className="toolbar"><Dropdown value={status} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue as typeof status)}>{['全部', '待调查', '调查中', '待复核', '已关闭'].map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown><span>调查完成前批次保持隔离，复核签字后才能恢复放行流程。</span></div>
      <div className="split-layout">
        <div className="deviation-list">{rows.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setReviewNote('') }}>
          <div><Badge color={item.severity === '重大' ? 'danger' : 'warning'}>{item.severity}</Badge><small>{item.id}</small></div><strong>{item.title}</strong><span>{item.batchId} · {item.owner}</span><footer><Badge appearance="tint">{item.status}</Badge><span>{item.dueDate} 截止</span></footer>
        </button>)}</div>
        {selected && <div className="record-panel">
          <div className="record-title"><div><span>{selected.id} · 实体V{selected.version}</span><h2>{selected.title}</h2></div><Badge color={selected.severity === '重大' ? 'danger' : 'warning'}>{selected.status}</Badge></div>
          <ConflictBanner entity={selected.id} />
          <Field label="原因判断"><Textarea value={investigation?.cause ?? ''} onChange={(_, data) => editInvestigation({ cause: data.value })} /></Field>
          <Field label="证据摘要"><Textarea value={investigation?.evidence ?? ''} onChange={(_, data) => editInvestigation({ evidence: data.value })} /></Field>
          <Field label="处置分支"><Dropdown value={investigation?.decision} selectedOptions={[investigation?.decision ?? '返工']} onOptionSelect={(_, data) => editInvestigation({ decision: data.optionValue as DecisionType })}>{['返工', '报废', '让步接收'].map((item) => <Option key={item} value={item} text={item}>{item}</Option>)}</Dropdown></Field>
          <Field label="返工或报废指令"><Textarea value={investigation?.reworkInstruction ?? ''} onChange={(_, data) => editInvestigation({ reworkInstruction: data.value })} /></Field>
          {activeDraft && <p className="basis-note muted">草稿基于实体V{activeDraft.baseVersion}，提交时将校验版本，冲突不会覆盖已提交内容。</p>}
          <div className="record-actions">
            <Button disabled={!investigation?.cause || !investigation?.evidence} onClick={submitInvestigation}>提交调查</Button>
          </div>
          <Field label="复核意见"><Textarea value={reviewNote} onChange={(_, data) => setReviewNote(data.value)} placeholder="复核通过或退回时随签字记录" /></Field>
          <div className="record-actions">
            <Button appearance="subtle" disabled={selected.status !== '待复核'} onClick={() => submitReview(false)}>退回补充证据</Button>
            <Button appearance="primary" disabled={selected.status !== '待复核'} onClick={() => submitReview(true)}>复核通过</Button>
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
        <div className="record-actions"><Button onClick={() => setShowCreate(false)}>取消</Button><Button appearance="primary" disabled={!newDeviation.title || !newDeviation.batchId} onClick={() => { dispatch(createDeviation({ ...newDeviation, operator: '当前用户', mutationId: nanoid() })); setShowCreate(false) }}>创建并隔离批次</Button></div>
      </div>}
    </section>
  )
}
