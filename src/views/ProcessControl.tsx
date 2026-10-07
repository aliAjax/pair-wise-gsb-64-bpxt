import { useEffect, useState } from 'react'
import { nanoid } from '@reduxjs/toolkit'
import { Badge, Button, Field, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { updateProcessStep } from '../store/haccpSlice'
import type { ProcessStep } from '../types'
import { ConflictBanner } from '../components/ConflictBanner'

interface Editing {
  step: ProcessStep
  baseMatrixVersion: number
  mutationId: string
  submitted: boolean
}

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const steps = useSelector((root: RootState) => root.haccp.processSteps)
  const matrixVersions = useSelector((root: RootState) => root.haccp.matrixVersions)
  const latest = matrixVersions[0]
  const [editing, setEditing] = useState<Editing | null>(null)

  // 保存被应用后关闭面板；冲突时保留填写内容，基准版本刷新到最新以便核对后重新提交
  const applied = useSelector((root: RootState) => editing?.submitted ? root.haccp.audit.some((entry) => entry.mutationId === editing.mutationId && entry.action !== '提交冲突') : false)
  const conflicted = useSelector((root: RootState) => editing?.submitted ? root.haccp.conflicts.some((item) => item.entity === 'MATRIX' && !item.dismissed) : false)
  useEffect(() => { if (applied) setEditing(null) }, [applied])
  useEffect(() => {
    if (conflicted) setEditing((current) => current ? { ...current, baseMatrixVersion: latest.version, mutationId: nanoid(), submitted: false } : current)
  }, [conflicted, latest.version])

  const save = () => {
    if (!editing) return
    dispatch(updateProcessStep({
      step: editing.step, baseMatrixVersion: editing.baseMatrixVersion, operator: '质量主管',
      changeNote: `更新${editing.step.name}关键限值或监控要求`, mutationId: editing.mutationId
    }))
    setEditing({ ...editing, submitted: true })
  }
  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点</p><h1>HACCP控制矩阵</h1></div><Badge appearance="tint" color="important">当前版本 V{latest.version} · {latest.createdAt.slice(0, 16).replace('T', ' ')}生效</Badge></header>
      <ConflictBanner entity="MATRIX" />
      <div className="process-flow">{steps.map((step, index) => <div key={step.id}><b>{index + 1}</b><span>{step.name}</span><small>{step.equipment}</small></div>)}</div>
      <div className="table-panel">
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>潜在危害</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值</TableHeaderCell><TableHeaderCell>监控频率</TableHeaderCell><TableHeaderCell /></TableRow></TableHeader>
          <TableBody>{steps.map((step) => <TableRow key={step.id}><TableCell>{step.name}</TableCell><TableCell>{step.hazard}</TableCell><TableCell>{step.controlPoint}</TableCell><TableCell><strong>{step.limit}</strong></TableCell><TableCell>{step.frequency}</TableCell><TableCell><Button size="small" appearance="subtle" onClick={() => setEditing({ step: structuredClone(step), baseMatrixVersion: latest.version, mutationId: nanoid(), submitted: false })}>编辑</Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      {editing && <div className="edit-panel">
        <h3>{editing.step.name} · 控制参数（基于矩阵V{editing.baseMatrixVersion}）</h3>
        <div className="edit-grid">
          <Field label="关键限值"><Input value={editing.step.limit} onChange={(_, data) => setEditing({ ...editing, step: { ...editing.step, limit: data.value } })} /></Field>
          <Field label="监控频率"><Input value={editing.step.frequency} onChange={(_, data) => setEditing({ ...editing, step: { ...editing.step, frequency: data.value } })} /></Field>
          <Field label="纠偏措施"><Input value={editing.step.correctiveAction} onChange={(_, data) => setEditing({ ...editing, step: { ...editing.step, correctiveAction: data.value } })} /></Field>
        </div>
        <p className="impact-hint">保存后生成矩阵V{latest.version + 1}：未签批次的检验结论将按新限值与纠偏措施重算；已签批次保留原放行依据并转复核。</p>
        <div className="record-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button appearance="primary" disabled={!editing.step.limit || !editing.step.correctiveAction} onClick={save}>保存并审计</Button></div>
      </div>}
      <div className="table-panel version-history">
        <h3>矩阵版本历史</h3>
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>版本</TableHeaderCell><TableHeaderCell>生效时间</TableHeaderCell><TableHeaderCell>发布人</TableHeaderCell><TableHeaderCell>变更说明</TableHeaderCell></TableRow></TableHeader>
          <TableBody>{matrixVersions.map((item) => <TableRow key={item.version}><TableCell><Badge appearance="outline" color={item.version === latest.version ? 'important' : 'informative'}>V{item.version}</Badge></TableCell><TableCell>{item.createdAt.slice(0, 16).replace('T', ' ')}</TableCell><TableCell>{item.operator}</TableCell><TableCell>{item.changeNote}</TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="rule-band"><strong>控制矩阵约束</strong><span>关键限值、监控频率与纠偏措施不得为空；变更只重算未签结论，已签批次保留原依据并转复核；每次变更均保留操作人和版本时间。</span></div>
    </section>
  )
}
