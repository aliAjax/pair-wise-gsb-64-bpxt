/**
 * 持久化层：主文档 + 备份文档双写。
 * - 每次写入先写主文档并回读校验，成功后同步备份，保证磁盘上始终存在最近完整版本。
 * - 读取时主文档损坏或结构不合法则自动从备份恢复。
 * - 文档带单调递增 docVersion 与写入者标识，用于跨窗口同步时识别新写入。
 */
export const MAIN_KEY = 'gsb64:haccp-platform'
export const BACKUP_KEY = 'gsb64:haccp-platform:backup'
export const SCHEMA_VERSION = 2

export const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export interface PersistedDoc<T> {
  schemaVersion: number
  docVersion: number
  writer: string
  savedAt: string
  state: T
}

let failNextWrite = false
/** 演示/测试用：让下一次写入失败，验证恢复与幂等重试 */
export function armWriteFailure() {
  failNextWrite = true
}

function isValidState(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false
  const candidate = state as Record<string, unknown>
  return (
    Array.isArray(candidate.batches) &&
    Array.isArray(candidate.matrixVersions) &&
    (candidate.matrixVersions as unknown[]).length > 0 &&
    Array.isArray(candidate.audit) &&
    Array.isArray(candidate.deviations) &&
    (candidate.batches as Array<Record<string, unknown>>).every((batch) => batch.releaseBasis && typeof batch.matrixVersion === 'number')
  )
}

function readDoc<T>(key: string): PersistedDoc<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const doc = JSON.parse(raw) as PersistedDoc<T>
    if (doc.schemaVersion !== SCHEMA_VERSION || !isValidState(doc.state)) return null
    return doc
  } catch {
    return null
  }
}

/** 启动时加载：主文档不可用时从最近完整备份恢复并回写主文档 */
export function loadPersisted<T>(): { state: T; docVersion: number } | null {
  const main = readDoc<T>(MAIN_KEY)
  if (main) return { state: main.state, docVersion: main.docVersion }
  const backup = readDoc<T>(BACKUP_KEY)
  if (backup) {
    try {
      localStorage.setItem(MAIN_KEY, JSON.stringify(backup))
    } catch {
      // 恢复回写失败不阻塞启动，内存中已持有完整版本
    }
    return { state: backup.state, docVersion: backup.docVersion }
  }
  return null
}

export function persistState<T>(state: T, lastDocVersion: number): { ok: true; docVersion: number } | { ok: false; error: string } {
  try {
    if (failNextWrite) {
      failNextWrite = false
      throw new Error('模拟的存储写入失败')
    }
    const doc: PersistedDoc<T> = {
      schemaVersion: SCHEMA_VERSION,
      docVersion: Math.max(Date.now(), lastDocVersion + 1),
      writer: TAB_ID,
      savedAt: new Date().toISOString(),
      state
    }
    const raw = JSON.stringify(doc)
    localStorage.setItem(MAIN_KEY, raw)
    if (localStorage.getItem(MAIN_KEY) !== raw) throw new Error('写入回读校验失败')
    localStorage.setItem(BACKUP_KEY, raw)
    return { ok: true, docVersion: doc.docVersion }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function readIncomingDoc<T>(raw: string | null): PersistedDoc<T> | null {
  if (!raw) return null
  try {
    const doc = JSON.parse(raw) as PersistedDoc<T>
    if (doc.schemaVersion !== SCHEMA_VERSION || !isValidState(doc.state)) return null
    return doc
  } catch {
    return null
  }
}
