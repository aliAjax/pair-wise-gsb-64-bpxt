import { useState } from 'react'
import { Badge, Button, Field, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../store'
import { submitProcessStep } from '../store/thunks'
import { dismissConflict } from '../store/workspaceSlice'
import type { ProcessStep } from '../types'

export function ProcessControl() {
  const dispatch = useDispatch<AppDispatch>()
  const steps = useSelector((root: RootState) => root.haccp.processSteps)
  const matrixVersion = useSelector((root: RootState) => root.haccp.matrixVersion)
  const revisions = useSelector((root: RootState) => root.haccp.matrixRevisions)
  const signedBatches = useSelector((root: RootState) => root.haccp.batches.filter((item) => item.status === '已放行').length)
  const conflict = useSelector((root: RootState) => root.workspace.conflicts.find((item) => item.entity === '控制矩阵'))
  const [editing, setEditing] = useState<ProcessStep | null>(null)
  // 进入编辑时固定所见的矩阵版本，提交时据此校验是否被其他窗口抢先变更
  const [editingVersion, setEditingVersion] = useState(matrixVersion)
  const startEdit = (step: ProcessStep) => { setEditing(structuredClone(step)); setEditingVersion(matrixVersion) }
  const save = () => {
    if (!editing) return
    // 冲突时 thunk 记录冲突并返回false，编辑内容保留在面板中
    if (dispatch(submitProcessStep(editing, editingVersion, '质量主管'))) setEditing(null)
  }
  return (
    <section className="page">
      <header className="page-head"><div><p>危害分析 / 关键控制点</p><h1>HACCP控制矩阵</h1></div><Badge appearance="filled" color="informative">当前矩阵 V{matrixVersion}</Badge></header>
      <div className="process-flow">{steps.map((step, index) => <div key={step.id}><b>{index + 1}</b><span>{step.name}</span><small>{step.equipment}</small></div>)}</div>
      <div className="table-panel">
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>步骤</TableHeaderCell><TableHeaderCell>潜在危害</TableHeaderCell><TableHeaderCell>控制点</TableHeaderCell><TableHeaderCell>关键限值</TableHeaderCell><TableHeaderCell>监控频率</TableHeaderCell><TableHeaderCell /></TableRow></TableHeader>
          <TableBody>{steps.map((step) => <TableRow key={step.id}><TableCell>{step.name}</TableCell><TableCell>{step.hazard}</TableCell><TableCell>{step.controlPoint}</TableCell><TableCell><strong>{step.limit}</strong></TableCell><TableCell>{step.frequency}</TableCell><TableCell><Button size="small" appearance="subtle" onClick={() => startEdit(step)}>编辑</Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      {editing && <div className="edit-panel">
        <h3>{editing.name} · 控制参数（基于矩阵V{editingVersion}编辑）</h3>
        {conflict && <p className="conflict-banner"><span>{conflict.message}</span><Button size="small" appearance="subtle" onClick={() => dispatch(dismissConflict('控制矩阵'))}>知道了</Button></p>}
        <div className="edit-grid">
          <Field label="关键限值"><Input value={editing.limit} onChange={(_, data) => setEditing({ ...editing, limit: data.value })} /></Field>
          <Field label="监控频率"><Input value={editing.frequency} onChange={(_, data) => setEditing({ ...editing, frequency: data.value })} /></Field>
          <Field label="纠偏措施"><Input value={editing.correctiveAction} onChange={(_, data) => setEditing({ ...editing, correctiveAction: data.value })} /></Field>
        </div>
        <div className="record-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button appearance="primary" disabled={!editing.limit || !editing.correctiveAction} onClick={save}>保存并审计</Button></div>
      </div>}
      <div className="rule-band"><strong>控制矩阵约束</strong><span>限值或纠偏措施变化只影响未签结论；{signedBatches > 0 ? `当前${signedBatches}个已签批次将在变更后保留原依据并转复核。` : '已签批次在变更后保留原依据并转复核。'}</span></div>
      <div className="table-panel revision-panel">
        <h3>矩阵版本历史</h3>
        <Table size="small">
          <TableHeader><TableRow><TableHeaderCell>版本</TableHeaderCell><TableHeaderCell>变更时间</TableHeaderCell><TableHeaderCell>操作人</TableHeaderCell><TableHeaderCell>摘要</TableHeaderCell></TableRow></TableHeader>
          <TableBody>{revisions.map((revision) => <TableRow key={revision.version}><TableCell><Badge appearance="tint" color={revision.version === matrixVersion ? 'important' : 'informative'}>V{revision.version}</Badge></TableCell><TableCell>{revision.changedAt.replace('T', ' ').slice(0, 16)}</TableCell><TableCell>{revision.changedBy}</TableCell><TableCell>{revision.summary}</TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
    </section>
  )
}
