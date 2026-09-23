/**
 * Meta Graph API addressing (docs/META_INTEGRATION.md). The API version is pinned by config
 * (META_GRAPH_API_VERSION) and upgraded deliberately; the base URL is overridable for the
 * meta-mock test server. Clients, webhook parsing and signatures arrive in Phases 4–5.
 */
export type GraphConfig = {
  baseUrl: string
  version: string
}

const VERSION_RE = /^v\d+\.\d+$/

export function graphUrl(
  config: GraphConfig,
  path: string,
  query?: Record<string, string>,
): string {
  if (!VERSION_RE.test(config.version))
    throw new Error(`Invalid Graph API version "${config.version}" (expected e.g. v23.0)`)
  const cleanPath = path.replace(/^\/+/, '')
  if (cleanPath.includes('..')) throw new Error('Graph path must not contain ".."')
  const url = new URL(
    `${config.version}/${cleanPath}`,
    config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`,
  )
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
  return url.toString()
}
