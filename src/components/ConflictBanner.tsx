import { useDispatch, useSelector } from 'react-redux'
import { Button } from '@fluentui/react-components'
import type { AppDispatch, RootState } from '../store'
import { dismissConflict } from '../store/haccpSlice'

/** 并发提交冲突提示：后到者填写内容保留在表单中，签字与已提交数据未被覆盖 */
export function ConflictBanner({ entity }: { entity: string }) {
  const dispatch = useDispatch<AppDispatch>()
  const conflicts = useSelector((root: RootState) => root.haccp.conflicts.filter((item) => item.entity === entity && !item.dismissed))
  if (conflicts.length === 0) return null
  return (
    <div className="conflict-banner">
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="conflict-item">
          <div>
            <strong>提交冲突 · {conflict.action}</strong>
            <p>{conflict.message}（期望版本V{conflict.expectedVersion}，当前V{conflict.currentVersion}）</p>
          </div>
          <Button size="small" appearance="subtle" onClick={() => dispatch(dismissConflict(conflict.id))}>知道了</Button>
        </div>
      ))}
    </div>
  )
}
