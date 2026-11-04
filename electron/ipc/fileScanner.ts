import { ipcMain } from 'electron'
import { readdir, readFile, rename, rmdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { ensureSongsDirectory, songsDirectory } from '../paths'

function safeStemPath(songName: string, stemFile: string) {
  const filePath = resolve(safeSongDirectory(songName), stemFile)
  const root = resolve(songsDirectory())
  if (!filePath.startsWith(`${root}${sep}`) || !stemFile.toLowerCase().endsWith('.mp3')) {
    throw new Error('Invalid stem path')
  }
  return filePath
}

function safeSongDirectory(songName: string) {
  const root = resolve(songsDirectory())
  if (!songName || songName !== basename(songName) || songName.includes('\0')) throw new Error('Invalid song name')
  const directory = resolve(root, songName)
  if (!directory.startsWith(`${root}${sep}`)) throw new Error('Invalid song name')
  return directory
}

export function registerSongIpc() {
  ipcMain.handle('songs:list', async () => {
    await ensureSongsDirectory()
    const entries = await readdir(songsDirectory(), { withFileTypes: true })
    const directories = entries.filter((entry) => entry.isDirectory())
    return Promise.all(
      directories.map(async ({ name }) => {
        const files = await readdir(join(songsDirectory(), name), { withFileTypes: true })
        return {
          name,
          stems: files
            .filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.mp3'))
            .map((file) => file.name)
            .sort(),
        }
      }),
    ).then((songs) => songs.filter((song) => song.stems.length > 0).sort((a, b) => a.name.localeCompare(b.name)))
  })

  ipcMain.handle('songs:load-buffer', async (_event, { songName, stemFile }: { songName: string; stemFile: string }) => {
    const data = await readFile(safeStemPath(songName, stemFile))
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  })

  ipcMain.handle('songs:rename', async (_event, { songName, newName }: { songName: string; newName: string }) => {
    const source = safeSongDirectory(songName)
    const destination = safeSongDirectory(newName.trim())
    if (source === destination) return
    try {
      await stat(destination)
      throw new Error('A song with that name already exists')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(source, destination)
  })

  ipcMain.handle('songs:delete', async (_event, songName: string) => {
    await rm(safeSongDirectory(songName), { recursive: true })
  })

  ipcMain.handle('songs:delete-stem', async (_event, { songName, stemFile }: { songName: string; stemFile: string }) => {
    const directory = safeSongDirectory(songName)
    await rm(safeStemPath(songName, stemFile))
    const entries = await readdir(directory)
    if (entries.length === 0) await rmdir(directory)
  })
}
