import { ipcMain } from 'electron'
import * as auth from './auth'
import * as api from './api'

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`)
}

export function registerDriveIpc() {
  ipcMain.handle('drive:status', () => auth.status())
  ipcMain.handle('drive:connect', () => auth.connect())
  ipcMain.handle('drive:disconnect', () => auth.disconnect())

  ipcMain.handle('drive:list', () => api.listFiles())

  ipcMain.handle('drive:upload', (_event, request: { name?: unknown; mimeType?: unknown; bytes?: unknown; fileId?: unknown }) => {
    assertNonEmptyString(request?.name, 'file name')
    assertNonEmptyString(request?.mimeType, 'file type')
    if (!(request.bytes instanceof Uint8Array)) throw new Error('Invalid file data.')
    if (request.fileId !== undefined) assertNonEmptyString(request.fileId, 'file id')
    return api.uploadFile({
      name: request.name,
      mimeType: request.mimeType,
      bytes: request.bytes,
      ...(request.fileId ? { fileId: request.fileId } : {}),
    })
  })

  ipcMain.handle('drive:download', (_event, fileId: unknown) => {
    assertNonEmptyString(fileId, 'file id')
    return api.downloadFile(fileId)
  })

  ipcMain.handle('drive:delete', (_event, fileId: unknown) => {
    assertNonEmptyString(fileId, 'file id')
    return api.deleteFile(fileId)
  })
}
