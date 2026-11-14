export interface SongNameParts {
  artist?: string
  title: string
}

/**
 * Split the folder slug into display parts.
 * New slugs use a double dash as the artist/title boundary ("pink-floyd--time") so
 * multi-word artists survive the round trip; single dashes inside a part are word
 * separators. Legacy folders ("pink-floyd-time") keep parsing via the first-dash
 * rule, which stays ambiguous for multi-word artists until the song is renamed.
 */
export function parseSongName(name: string): SongNameParts {
  const boundary = name.indexOf('--')
  if (boundary > 0 && boundary < name.length - 1) {
    return {
      artist: name.slice(0, boundary).replaceAll('-', ' ').trim(),
      title: name.slice(boundary + 2).replaceAll('-', ' ').trim(),
    }
  }
  const dash = name.indexOf('-')
  if (dash > 0 && dash < name.length - 1) {
    return {
      artist: name.slice(0, dash).replaceAll('-', ' ').trim(),
      title: name.slice(dash + 1).replaceAll('-', ' ').trim(),
    }
  }
  return { title: name.replaceAll('-', ' ').trim() }
}

/** Derive the folder slug from artist and title (double-dash boundary), matching the import pipeline (electron/ipc/stemImport.ts songNameFrom). */
export function songFolderName(artist: string, title: string): string {
  const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const artistSlug = slug(artist)
  const titleSlug = slug(title)
  if (!artistSlug) return titleSlug
  // Keep the boundary marker even without a title ("pink-floyd--") so reopening the
  // edit dialog still recovers the full artist instead of splitting at the first dash.
  return titleSlug ? `${artistSlug}--${titleSlug}` : `${artistSlug}--`
}

/** Human-friendly folder slug for titles and messages: the boundary becomes " – ", word dashes collapse to spaces. */
export function songDisplayName(name: string): string {
  return name
    .split('--')
    .map((part) => part.replaceAll('-', ' ').trim())
    .filter(Boolean)
    .join(' – ') || name.replaceAll('-', ' ').trim()
}

/**
 * Derive the library slug from an import source path, matching the import
 * pipeline: "Artist - Title.ext" becomes "artist--title" (double-dash
 * boundary), anything else becomes a plain slug of the file name.
 */
export function songNameFromSource(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').toLowerCase() ?? ''
  const boundary = base.indexOf(' - ')
  if (boundary > 0) {
    const parts = [slugOf(base.slice(0, boundary)), slugOf(base.slice(boundary + 3))].filter(Boolean)
    if (parts.length) return parts.join('--')
  }
  return slugOf(base) || 'imported-song'
}

const slugOf = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
