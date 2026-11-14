import { clearAccessToken, getAccessToken, DriveNotConnectedError } from './auth'

/**
 * Minimal Google Drive REST v3 client scoped to the hidden `appDataFolder`.
 * Every file lives flat in the app-data folder; "paths" in names are just a
 * naming convention (Drive file names may contain slashes).
 */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

export interface DriveFileMeta {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
}

async function ensureOk(response: Response, action: string): Promise<void> {
  if (response.ok) return
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message ? `: ${body.error.message}` : ''
  } catch {
    // Non-JSON error bodies are fine; the status code carries the meaning.
  }
  throw new Error(`Could not ${action} (${response.status}${detail}).`)
}

/** Authorized fetch; transparently refreshes the access token once on 401. */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await getAccessToken()}` },
  })
  if (response.status === 401) {
    await clearAccessToken()
    const retry = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await getAccessToken()}` },
    })
    if (retry.ok || retry.status !== 401) return retry
  }
  return response
}

/** All files in the hidden app-data folder (flat namespace). */
export async function listFiles(): Promise<DriveFileMeta[]> {
  const files: DriveFileMeta[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${API}/files`)
    url.searchParams.set('q', "'appDataFolder' in parents and trashed = false")
    // The appdata-only scope forbids searching all spaces at once.
    url.searchParams.set('spaces', 'appDataFolder')
    url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, modifiedTime, size)')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await driveFetch(url.toString())
    await ensureOk(response, 'list Drive files')
    const data = (await response.json()) as { nextPageToken?: string; files?: DriveFileMeta[] }
    files.push(...(data.files ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return files
}

/**
 * Create or update a file via a resumable upload session (one init request
 * plus one PUT of the whole body; the manifest checksums guard integrity).
 */
export async function uploadFile(options: {
  name: string
  mimeType: string
  bytes: Uint8Array
  /** When set, patches the existing file (keeping its id) instead of creating one. */
  fileId?: string
}): Promise<{ id: string; modifiedTime?: string }> {
  const { name, mimeType, bytes, fileId } = options
  const url = new URL(fileId ? `${UPLOAD_API}/files/${fileId}` : `${UPLOAD_API}/files`)
  url.searchParams.set('uploadType', 'resumable')
  url.searchParams.set('fields', 'id, modifiedTime')
  const initResponse = await driveFetch(url.toString(), {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(bytes.length),
    },
    body: fileId ? undefined : JSON.stringify({ name, mimeType, parents: ['appDataFolder'] }),
  })
  await ensureOk(initResponse, fileId ? 'update a Drive file' : 'upload to Drive')
  const location = initResponse.headers.get('location')
  if (!location) throw new Error('Google Drive did not return an upload session.')
  const uploadResponse = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, Authorization: `Bearer ${await getAccessToken()}` },
    body: new Uint8Array(bytes),
  })
  await ensureOk(uploadResponse, fileId ? 'update a Drive file' : 'upload to Drive')
  return (await uploadResponse.json()) as { id: string; modifiedTime?: string }
}

export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const response = await driveFetch(`${API}/files/${fileId}?alt=media`)
  await ensureOk(response, 'download from Drive')
  return new Uint8Array(await response.arrayBuffer())
}

export async function deleteFile(fileId: string): Promise<void> {
  const response = await driveFetch(`${API}/files/${fileId}`, { method: 'DELETE' })
  if (response.status === 404 || response.ok) return
  await ensureOk(response, 'delete from Drive')
}

export { DriveNotConnectedError }
