import { dialog, ipcMain } from 'electron'
import AdmZip from 'adm-zip'
import { writeFile } from 'node:fs/promises'

const safeFileName = (value: string) =>
  value.replace(/[/\\:*?"<>|]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '') || 'song'

export function registerMixIpc() {
  ipcMain.handle('mix:export', async (_event, request: { songName?: unknown; mp3?: unknown }) => {
    if (typeof request?.songName !== 'string' || !request.songName.trim()) throw new Error('Invalid song name.')
    if (!(request.mp3 instanceof Uint8Array || request.mp3 instanceof ArrayBuffer) || (!request.mp3.byteLength)) throw new Error('Invalid MP3 audio.')
    const selection = await dialog.showSaveDialog({
      title: 'Export current mix',
      defaultPath: `${safeFileName(request.songName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase())}-mix.mp3`,
      filters: [{ name: 'MP3 audio', extensions: ['mp3'] }],
    })
    if (selection.canceled || !selection.filePath) return null
    try {
      const mp3 = request.mp3 instanceof Uint8Array ? request.mp3 : new Uint8Array(request.mp3)
      await writeFile(selection.filePath, mp3)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not export the mix: ${message}`)
    }
    return selection.filePath
  })

  ipcMain.handle('stems:export', async (_event, request: { songName?: unknown; stems?: unknown }) => {
    if (typeof request?.songName !== 'string' || !request.songName.trim()) throw new Error('Invalid song name.')
    if (!Array.isArray(request.stems) || !request.stems.length) throw new Error('Invalid stems.')
    const stems = request.stems as Array<{ name?: unknown; data?: unknown }>
    for (const stem of stems) {
      if (typeof stem?.name !== 'string' || !stem.name.trim()) throw new Error('Invalid stem name.')
      if (!(stem.data instanceof Uint8Array || stem.data instanceof ArrayBuffer) || (!stem.data || !stem.data.byteLength)) throw new Error('Invalid stem audio.')
    }
    const selection = await dialog.showSaveDialog({
      title: 'Export stems',
      defaultPath: `${safeFileName(request.songName)}-stems.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    })
    if (selection.canceled || !selection.filePath) return null
    try {
      const zip = new AdmZip()
      for (const stem of stems) {
        const base = safeFileName(String(stem.name).replace(/\.[^.]+$/, ''))
        zip.addFile(`${base}.mp3`, Buffer.from(stem.data as Uint8Array))
      }
      zip.writeZip(selection.filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not export the stems: ${message}`)
    }
    return selection.filePath
  })
}
