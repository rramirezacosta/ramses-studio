export interface SongNameParts {
  artist?: string
  title: string
}

/** Split the folder slug "artist-title" into display parts (single-part names keep everything as the title). */
export function parseSongName(name: string): SongNameParts {
  const dash = name.indexOf('-')
  if (dash > 0 && dash < name.length - 1) {
    return {
      artist: name.slice(0, dash).replaceAll('-', ' ').trim(),
      title: name.slice(dash + 1).replaceAll('-', ' ').trim(),
    }
  }
  return { title: name.replaceAll('-', ' ').trim() }
}

/** Derive the folder slug from artist and title, matching the import pipeline's naming (electron/ipc/stemImport.ts songNameFrom). */
export function songFolderName(artist: string, title: string): string {
  const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return [slug(artist), slug(title)].filter(Boolean).join('-')
}
