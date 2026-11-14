/** Google OAuth desktop client id: build-time define first, runtime env var as fallback. */
export function googleClientId(): string {
  const fromBuild = typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : ''
  return fromBuild || process.env.GOOGLE_CLIENT_ID || ''
}

/** Optional OAuth client secret for confidential clients. */
export function googleClientSecret(): string {
  const fromBuild = typeof __GOOGLE_CLIENT_SECRET__ === 'string' ? __GOOGLE_CLIENT_SECRET__ : ''
  return fromBuild || process.env.GOOGLE_CLIENT_SECRET || ''
}
