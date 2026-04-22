'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Zap,
  LogOut,
  Plus,
  Search,
  Star,
  Lock,
  Unlock,
  ChevronRight,
  RefreshCw,
  FolderGit2,
} from 'lucide-react'
import { GithubIcon } from '@/components/icons'
import type { GithubRepo, Project } from '@/types'

type View = 'projects' | 'connect'

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [view, setView] = useState<View>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [filteredRepos, setFilteredRepos] = useState<GithubRepo[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState<number | null>(null)

  // Redirect if not authed
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  // Load projects on mount
  useEffect(() => {
    if (status === 'authenticated') fetchProjects()
  }, [status])

  // Filter repos on search
  useEffect(() => {
    if (!search.trim()) {
      setFilteredRepos(repos)
      return
    }
    const q = search.toLowerCase()
    setFilteredRepos(repos.filter((r) => r.full_name.toLowerCase().includes(q)))
  }, [search, repos])

  async function fetchProjects() {
    setLoading(true)
    try {
      const res = await fetch('/api/projects')
      const json = await res.json()
      if (json.data) setProjects(json.data)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRepos() {
    setLoading(true)
    try {
      const res = await fetch('/api/repos')
      const json = await res.json()
      if (json.data) {
        setRepos(json.data)
        setFilteredRepos(json.data)
      }
    } finally {
      setLoading(false)
    }
  }

  function switchToConnect() {
    setView('connect')
    if (repos.length === 0) fetchRepos()
  }

  async function connectRepo(repo: GithubRepo) {
    setConnecting(repo.id)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: repo.full_name,
          repoId: repo.id,
          defaultBranch: repo.default_branch,
        }),
      })
      const json = await res.json()
      if (json.data) {
        router.push(`/project/${json.data.id}`)
      } else if (res.status === 409) {
        // Already connected — find it and navigate
        const existing = projects.find((p) => p.repoFullName === repo.full_name)
        if (existing) router.push(`/project/${existing.id}`)
        else await fetchProjects().then(() => setView('projects'))
      }
    } finally {
      setConnecting(null)
    }
  }

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const user = session!.user

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Topbar */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-zinc-100">Forge 2.0</span>
        </div>

        <div className="flex items-center gap-3">
          {user?.image && (
            <img
              src={user.image}
              alt={user.name ?? ''}
              className="w-7 h-7 rounded-full ring-1 ring-zinc-700"
            />
          )}
          <span className="text-sm text-zinc-400">{user?.name ?? user?.login}</span>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Projects</h1>
            <p className="text-zinc-500 text-sm mt-1">
              Connect a GitHub repo to get started
            </p>
          </div>
          <div className="flex items-center gap-3">
            {view === 'projects' && (
              <button
                onClick={fetchProjects}
                className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={view === 'connect' ? () => setView('projects') : switchToConnect}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              {view === 'connect' ? (
                <>
                  <FolderGit2 className="w-4 h-4" />
                  My Projects
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Connect Repo
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Projects view ── */}
        {view === 'projects' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
                  <GithubIcon className="w-8 h-8 text-zinc-600" />
                </div>
                <h3 className="text-zinc-300 font-medium mb-2">No projects yet</h3>
                <p className="text-zinc-600 text-sm mb-6">
                  Connect a GitHub repo to start engineering with AI
                </p>
                <button
                  onClick={switchToConnect}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Connect your first repo
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onClick={() => router.push(`/project/${project.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Connect repo view ── */}
        {view === 'connect' && (
          <div>
            {/* Search */}
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search repositories…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredRepos.map((repo) => {
                  const alreadyConnected = projects.some(
                    (p) => p.repoFullName === repo.full_name
                  )
                  return (
                    <RepoCard
                      key={repo.id}
                      repo={repo}
                      alreadyConnected={alreadyConnected}
                      isConnecting={connecting === repo.id}
                      onConnect={() => connectRepo(repo)}
                    />
                  )
                })}
                {filteredRepos.length === 0 && !loading && (
                  <div className="text-center py-12 text-zinc-600">
                    No repositories found matching &quot;{search}&quot;
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────

/** "owner/my-cool-repo" → "My Cool Repo" (title line) + "owner" (subtitle) */
function formatRepoName(repoFullName: string): { title: string; owner: string; slug: string } {
  const [owner, repoSlug] = repoFullName.split('/')
  const title = (repoSlug ?? repoFullName)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return { title, owner: owner ?? '', slug: repoSlug ?? repoFullName }
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const statusColor: Record<string, string> = {
    idle: 'text-zinc-500',
    indexing: 'text-yellow-400',
    ready: 'text-green-400',
    error: 'text-red-400',
  }
  const statusDot: Record<string, string> = {
    idle: 'bg-zinc-600',
    indexing: 'bg-yellow-400 animate-pulse',
    ready: 'bg-green-400',
    error: 'bg-red-400',
  }
  const statusLabel: Record<string, string> = {
    idle: 'Not indexed',
    indexing: 'Indexing…',
    ready: 'Ready',
    error: 'Index error',
  }

  const { title, owner, slug } = formatRepoName(project.repoFullName ?? '')

  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between p-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/60 transition-all text-left group"
    >
      <div className="flex items-center gap-4">
        {/* Avatar: first letter of repo name */}
        <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center shrink-0">
          <span className="text-base font-bold text-blue-400 leading-none">
            {slug.charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <p className="font-semibold text-zinc-100 group-hover:text-white leading-tight">
            {title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <GithubIcon className="w-3 h-3 text-zinc-600" />
            <span className="text-xs text-zinc-500">{owner}/{slug}</span>
            <span className="text-zinc-700">·</span>
            <span className={`flex items-center gap-1.5 text-xs ${statusColor[project.indexStatus] ?? 'text-zinc-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot[project.indexStatus] ?? 'bg-zinc-600'}`} />
              {statusLabel[project.indexStatus] ?? project.indexStatus}
            </span>
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
    </button>
  )
}

function RepoCard({
  repo,
  alreadyConnected,
  isConnecting,
  onConnect,
}: {
  repo: GithubRepo
  alreadyConnected: boolean
  isConnecting: boolean
  onConnect: () => void
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-900 border border-zinc-800">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
          {repo.private ? (
            <Lock className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <Unlock className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-zinc-100 truncate">{repo.full_name}</p>
          <div className="flex items-center gap-3 mt-0.5">
            {repo.language && (
              <span className="text-xs text-zinc-500">{repo.language}</span>
            )}
            <span className="flex items-center gap-1 text-xs text-zinc-600">
              <Star className="w-3 h-3" />
              {repo.stargazers_count}
            </span>
            {repo.description && (
              <span className="text-xs text-zinc-600 truncate max-w-xs">{repo.description}</span>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={onConnect}
        disabled={alreadyConnected || isConnecting}
        className={`ml-4 shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          alreadyConnected
            ? 'bg-green-950 text-green-400 border border-green-800 cursor-default'
            : isConnecting
            ? 'bg-zinc-800 text-zinc-500 cursor-wait'
            : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
      >
        {alreadyConnected ? 'Connected' : isConnecting ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}
