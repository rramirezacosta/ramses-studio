/** Google OAuth desktop client id: build-time define first, runtime env var as fallback. */
export function googleClientId(): string {
  const fromBuild = typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : ''
  return fromBuild || process.env.GOOGLE_CLIENT_ID || ''
}
