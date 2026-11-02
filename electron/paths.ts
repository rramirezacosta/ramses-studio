import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const songsDirectory = () => join(app.getPath('music'), 'Ramses Studio', 'songs')

export const ensureSongsDirectory = () => mkdir(songsDirectory(), { recursive: true })
