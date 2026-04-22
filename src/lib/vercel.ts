// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Vercel Deploy Trigger
// ════════════════════════════════════════════════════════════════

const VERCEL_API = 'https://api.vercel.com'

function getVercelToken(): string {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN not set')
  return token
}

// ── Trigger deployment ────────────────────────────────────────────

/**
 * Trigger a new Vercel deployment via the Vercel API.
 * Returns the deployment URL.
 */
export async function triggerVercelDeploy(
  projectName: string,
  gitRepoFullName: string
): Promise<string> {
  const token = getVercelToken()

  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      gitSource: {
        type: 'github',
        repoId: gitRepoFullName,
        ref: 'main',
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Vercel deploy failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { url?: string; alias?: string[] }
  const url = data.alias?.[0] ? `https://${data.alias[0]}` : `https://${data.url}`
  return url
}

// ── List Vercel projects ──────────────────────────────────────────

export interface VercelProject {
  id: string
  name: string
  framework: string | null
  latestDeployments: Array<{ url: string; state: string }>
}

export async function listVercelProjects(): Promise<VercelProject[]> {
  const token = getVercelToken()

  const res = await fetch(`${VERCEL_API}/v9/projects?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) return []

  const data = (await res.json()) as { projects: VercelProject[] }
  return data.projects ?? []
}

// ── Get deployment status ─────────────────────────────────────────

export async function getDeploymentStatus(deploymentId: string): Promise<string> {
  const token = getVercelToken()

  const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) return 'unknown'
  const data = (await res.json()) as { readyState?: string }
  return data.readyState ?? 'unknown'
}
