import { dialog, ipcMain } from 'electron'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { ffmpegPath } from './stemImport'

const execFile = promisify(execFileCallback)

const safeFileName = (value: string) =>
  value.replace(/[/\\:*?"<>|]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '') || 'song'

export function registerMixIpc() {
  ipcMain.handle('mix:export', async (_event, request: { songName?: unknown; wav?: unknown }) => {
    if (typeof request?.songName !== 'string' || !request.songName.trim()) throw new Error('Invalid song name.')
    if (!(request.wav instanceof Uint8Array) || !request.wav.length) throw new Error('Invalid mix audio.')
    const selection = await dialog.showSaveDialog({
      title: 'Export current mix',
      defaultPath: `${safeFileName(request.songName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase())}-mix.mp3`,
      filters: [{ name: 'MP3 audio', extensions: ['mp3'] }],
    })
    if (selection.canceled || !selection.filePath) return null
    const directory = await mkdtemp(join(tmpdir(), 'ramses-mix-'))
    try {
      const wavPath = join(directory, 'mix.wav')
      await writeFile(wavPath, request.wav)
      await execFile(ffmpegPath(), ['-v', 'error', '-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '2', selection.filePath])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not export the mix: ${message}`)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    return selection.filePath
  })
}
