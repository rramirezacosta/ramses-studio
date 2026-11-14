import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, safeStorage } from 'electron'
import { googleClientId } from './config'

/**
 * Google OAuth for installed apps: PKCE authorization-code flow through a
 * BrowserWindow popup and a loopback redirect. Tokens live only in the main
 * process and are persisted encrypted via Electron safeStorage (OS keychain).
 * Renderer code only ever sees a connection status and the account email.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const ABOUT_ENDPOINT = 'https://www.googleapis.com/drive/v3/about'
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

/** Thrown when a Drive call needs a signed-in user but none is connected. */
export class DriveNotConnectedError extends Error {
  constructor(message = 'Google Drive is not connected.') {
    super(message)
    this.name = 'DriveNotConnectedError'
  }
}

interface StoredAuth {
  refreshToken: string
  accessToken?: string
  /** Epoch ms when `accessToken` stops being valid. */
  expiresAt?: number
  account?: string
}

let cachedAuth: StoredAuth | null = null

const tokenFile = () => join(app.getPath('userData'), 'drive-auth.bin')

async function loadAuth(): Promise<StoredAuth | null> {
  if (cachedAuth) return cachedAuth
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const encrypted = await readFile(tokenFile())
    cachedAuth = JSON.parse(safeStorage.decryptString(encrypted)) as StoredAuth
  } catch {
    cachedAuth = null
  }
  return cachedAuth
}

async function saveAuth(auth: StoredAuth | null): Promise<void> {
  cachedAuth = auth
  if (!auth) {
    await unlink(tokenFile()).catch(() => undefined)
    return
  }
  // Without an available keychain the session stays memory-only for this run.
  if (!safeStorage.isEncryptionAvailable()) return
  await writeFile(tokenFile(), safeStorage.encryptString(JSON.stringify(auth)))
}

/** Drop a rejected access token so the next call refreshes it. */
export async function clearAccessToken(): Promise<void> {
  const auth = await loadAuth()
  if (auth?.accessToken) {
    delete auth.accessToken
    await saveAuth(auth)
  }
}

export async function status(): Promise<{ connected: boolean; account?: string }> {
  const auth = await loadAuth()
  return auth ? { connected: true, ...(auth.account ? { account: auth.account } : {}) } : { connected: false }
}

/**
 * Exchange/refresh helper shared by the connect flow and token refresh.
 */
async function tokenRequest(body: URLSearchParams): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`)
  return (await response.json()) as { access_token: string; expires_in: number; refresh_token?: string }
}

/** Valid (refreshed if needed) access token for Drive API calls. */
export async function getAccessToken(): Promise<string> {
  const auth = await loadAuth()
  if (!auth) throw new DriveNotConnectedError()
  if (auth.accessToken && auth.expiresAt && Date.now() < auth.expiresAt - 60_000) return auth.accessToken
  const tokens = await tokenRequest(new URLSearchParams({
    client_id: googleClientId(),
    refresh_token: auth.refreshToken,
    grant_type: 'refresh_token',
  }))
  auth.accessToken = tokens.access_token
  auth.expiresAt = Date.now() + tokens.expires_in * 1000
  await saveAuth(auth)
  return auth.accessToken
}

/** Revoke the stored grant and forget the tokens. */
export async function disconnect(): Promise<void> {
  const auth = await loadAuth()
  await saveAuth(null)
  if (auth?.refreshToken) {
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: auth.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  }
}

interface PendingFlow {
  state: string
  codeVerifier: string
  redirectUri: string
  port: number
  resolve: (auth: StoredAuth) => void
  reject: (error: Error) => void
  window?: BrowserWindow
  server?: ReturnType<typeof createServer>
  settled: boolean
}

let pendingFlow: PendingFlow | null = null

function settleFlow(flow: PendingFlow, error?: Error, auth?: StoredAuth): void {
  if (flow.settled) return
  flow.settled = true
  if (pendingFlow === flow) pendingFlow = null
  if (error) flow.reject(error)
  else if (auth) flow.resolve(auth)
}

/** Accept exactly one loopback callback request, then shut the server down. */
function handleCallback(request: IncomingMessage, response: ServerResponse, flow: PendingFlow): void {
  const respond = (status: number, body: string) => {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><meta charset="utf-8"><title>Ramses Studio</title><body style="font-family:system-ui;background:#11131a;color:#e8eaff;display:grid;place-items:center;height:100vh"><p>${body}</p></body>`)
  }
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${flow.port}`)
    if (url.pathname !== '/callback') {
      respond(404, 'Not found')
      return
    }
    if (url.searchParams.get('state') !== flow.state) {
      respond(400, 'Sign-in could not be verified (state mismatch). You can close this window.')
      settleFlow(flow, new Error('Google sign-in could not be verified.'))
      return
    }
    const error = url.searchParams.get('error')
    if (error) {
      respond(200, 'Sign-in was cancelled. You can close this window.')
      settleFlow(flow, new Error('Google sign-in was cancelled.'))
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      respond(400, 'Missing authorization code. You can close this window.')
      settleFlow(flow, new Error('Google did not return an authorization code.'))
      return
    }
    respond(200, 'Signed in. You can close this window and return to Ramses Studio.')
    void finishConnect(flow, code)
  } finally {
    flow.server?.close()
  }
}

async function finishConnect(flow: PendingFlow, code: string): Promise<void> {
  try {
    const tokens = await tokenRequest(new URLSearchParams({
      code,
      client_id: googleClientId(),
      redirect_uri: flow.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: flow.codeVerifier,
    }))
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Try connecting again.')
    const auth: StoredAuth = {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    }
    // Best-effort account email for the settings UI.
    try {
      const about = await fetch(`${ABOUT_ENDPOINT}?fields=user`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (about.ok) {
        const user = (await about.json() as { user?: { emailAddress?: string } }).user
        if (user?.emailAddress) auth.account = user.emailAddress
      }
    } catch {
      // Email display is cosmetic; never fail the sign-in for it.
    }
    await saveAuth(auth)
    settleFlow(flow, undefined, auth)
  } catch (reason) {
    settleFlow(flow, reason instanceof Error ? reason : new Error(String(reason)))
  } finally {
    if (flow.window && !flow.window.isDestroyed()) flow.window.close()
  }
}

/** Open the Google sign-in popup and complete the PKCE flow. Resolves with the stored auth. */
export async function connect(): Promise<StoredAuth> {
  const existing = await loadAuth()
  if (existing) return existing
  if (pendingFlow) throw new Error('A Google sign-in window is already open.')
  if (!googleClientId()) throw new Error('Google Drive is missing its client configuration.')

  const state = randomBytes(16).toString('base64url')
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  const server = createServer((request, response) => {
    if (pendingFlow) handleCallback(request, response, pendingFlow)
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  const redirectUri = `http://127.0.0.1:${port}/callback`

  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', googleClientId())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Guarantees a refresh token even if the user previously granted access.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')

  return new Promise<StoredAuth>((resolve, reject) => {
    const flow: PendingFlow = { state, codeVerifier, redirectUri, port, resolve, reject, server, settled: false }
    pendingFlow = flow
    const authWindow = new BrowserWindow({
      width: 480,
      height: 720,
      autoHideMenuBar: true,
      title: 'Sign in with Google',
    })
    flow.window = authWindow
    authWindow.on('closed', () => {
      flow.server?.close()
      settleFlow(flow, new Error('Google sign-in was cancelled.'))
    })
    authWindow.loadURL(url.toString()).catch(() => undefined)
  })
}
