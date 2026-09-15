const INGEST_URL = 'https://lufvkrnwqbqdaqcgljxt.supabase.co/functions/v1/planetx-analytics-ingest'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const key = process.env.PLANETX_ANALYTICS_INGEST_KEY
  const oidc = String(req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || '')
  if (!key && !oidc) return res.status(503).json({ error: 'Analytics is not configured' })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers['X-PlanetX-Analytics-Key'] = key
  if (oidc) headers.Authorization = `Bearer ${oidc}`
  const upstream = await fetch(INGEST_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...req.body, source_product: 'xos-nexus', source_surface: 'web-app' }),
  })
  const body = await upstream.text()
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(body)
}
