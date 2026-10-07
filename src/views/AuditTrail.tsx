import { useState } from 'react'
import { Button, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@fluentui/react-components'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'
import { armWriteFailure, SCHEMA_VERSION } from '../services/persistence'

export function AuditTrail() {
  const state = useSelector((root: RootState) => root.haccp)
  const [keyword, setKeyword] = useState('')
  const [armed, setArmed] = useState(false)
  const rows = state.audit.filter((item) => `${item.entity} ${item.action} ${item.operator} ${item.detail}`.includes(keyword))
  const exportAudit = () => {
    const tracePack = {
      exportedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      matrixVersions: state.matrixVersions,
      batches: state.batches.map((batch) => ({
        id: batch.id, product: batch.product, status: batch.status,
        matrixVersion: batch.matrixVersion, releaseBasis: batch.releaseBasis, entityVersion: batch.version
      })),
      deviations: state.deviations,
      conflicts: state.conflicts,
      audit: state.audit
    }
    const blob = new Blob([JSON.stringify(tracePack, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'HACCP放行依据追溯包.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <section className="page"><header className="page-head"><div><p>批次 / 控制矩阵 / 偏差 / 签字</p><h1>完整追溯审计</h1></div><div className="head-actions"><Button appearance="subtle" onClick={() => { armWriteFailure(); setArmed(true) }}>模拟下次写入失败</Button><Button appearance="primary" onClick={exportAudit}>导出追溯包</Button></div></header>
    {armed && <p className="basis-note">已布防：下一次数据变更将模拟写入失败，系统会从最近完整版本恢复，可重试验证审计不重复。</p>}
    <div className="toolbar"><Input value={keyword} onChange={(_, data) => setKeyword(data.value)} placeholder="搜索实体、动作、操作人" /><span>共{rows.length}条可追溯事件 · 矩阵版本{state.matrixVersions.length}个</span></div>
    <div className="table-panel"><Table size="small"><TableHeader><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>实体</TableHeaderCell><TableHeaderCell>动作</TableHeaderCell><TableHeaderCell>操作人</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell>{item.createdAt.replace('T', ' ').slice(0, 16)}</TableCell><TableCell>{item.entity}</TableCell><TableCell>{item.action}</TableCell><TableCell>{item.operator}</TableCell><TableCell>{item.detail}</TableCell></TableRow>)}</TableBody></Table></div>
  </section>
}
