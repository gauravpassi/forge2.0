'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  ArrowLeft,
  Zap,
  Database,
  GitBranch,
  ExternalLink,
  Send,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileCode,
} from 'lucide-react'
import type { Project, Task } from '@/types'

type IndexPhase =
  | 'tree'
  | 'fetch'
  | 'chunk'
  | 'embed'
  | 'store'
  | 'done'
  | 'error'
  | null

interface IndexProgress {
  phase: IndexPhase
  filesTotal?: number
  filesDone?: number
  chunksTotal?: number
  message: string
}

export default function ProjectPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { id: projectId } = useParams<{ id: string }>()

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskInput, setTaskInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)

  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // Redirect if not authed
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  // Load project + tasks
  const loadProject = useCallback(async () => {
    const [projRes, tasksRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`),
      fetch(`/api/projects/${projectId}/tasks`),
    ])
    const [projJson, tasksJson] = await Promise.all([projRes.json(), tasksRes.json()])
    if (projJson.data) setProject(projJson.data)
    if (tasksJson.data) setTasks(tasksJson.data)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    if (status === 'authenticated') loadProject()
  }, [status, loadProject])

  // Poll tasks while any are running/queued
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === 'running' || t.status === 'queued')
    if (hasActive) {
      pollRef.current = setInterval(() => {
        loadProject()
      }, 4000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [tasks, loadProject])

  // ── Index repo ────────────────────────────────────────────────

  async function startIndexing() {
    if (!project || indexing) return
    setIndexing(true)
    setIndexProgress({ phase: 'tree', message: 'Starting indexer…' })

    try {
      const res = await fetch(`/api/projects/${projectId}/index`, { method: 'POST' })
      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as IndexProgress
              setIndexProgress(data)
              if (data.phase === 'done' || data.phase === 'error') {
                await loadProject()
              }
            } catch {}
          }
        }
      }
    } finally {
      setIndexing(false)
    }
  }

  // ── Submit task ───────────────────────────────────────────────

  async function submitTask(e: React.FormEvent) {
    e.preventDefault()
    if (!taskInput.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: taskInput.trim() }),
      })
      const json = await res.json()
      if (json.data) {
        setTaskInput('')
        setTasks((prev) => [json.data, ...prev])
      } else {
        alert(json.error ?? 'Failed to submit task')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-500">
        Project not found.
      </div>
    )
  }

  const isReady = project.indexStatus === 'ready'
  const isIndexing = project.indexStatus === 'indexing' || indexing

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Topbar */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => router.push('/dashboard')}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
            <Zap className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold text-zinc-100 text-sm">Forge 2.0</span>
        </div>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-400 text-sm">{project.repoFullName}</span>
        <IndexStatusBadge status={project.indexStatus} />
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 flex flex-col gap-8">

        {/* ── Knowledge Base card ── */}
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold text-zinc-100">Knowledge Base</h2>
                <p className="text-zinc-500 text-sm mt-0.5">
                  {isReady
                    ? `Indexed · Last updated ${project.lastIndexedAt ? new Date(project.lastIndexedAt).toLocaleDateString() : 'recently'}`
                    : isIndexing
                    ? 'Building knowledge base…'
                    : 'Not indexed yet — index before running tasks'}
                </p>
              </div>
            </div>

            <button
              onClick={startIndexing}
              disabled={isIndexing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isIndexing
                  ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                  : isReady
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {isIndexing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Indexing…</>
              ) : isReady ? (
                <><RefreshCw className="w-4 h-4" /> Re-index</>
              ) : (
                <><Database className="w-4 h-4" /> Index Repo</>
              )}
            </button>
          </div>

          {/* Progress bar */}
          {indexing && indexProgress && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500">{indexProgress.message}</span>
                {indexProgress.chunksTotal && (
                  <span className="text-xs text-zinc-600">
                    {indexProgress.filesDone ?? 0}/{indexProgress.chunksTotal} chunks
                  </span>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{
                    width: indexProgress.phase === 'done'
                      ? '100%'
                      : indexProgress.chunksTotal
                      ? `${Math.min(99, ((indexProgress.filesDone ?? 0) / indexProgress.chunksTotal) * 100)}%`
                      : '15%',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Task submission ── */}
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
          <h2 className="font-semibold text-zinc-100 mb-4">Submit a Task</h2>
          <form onSubmit={submitTask} className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitTask(e as unknown as React.FormEvent)
                }}
                placeholder={
                  isReady
                    ? 'Describe what you want to build or fix… (⌘+Enter to submit)'
                    : 'Index the repo first before submitting tasks'
                }
                disabled={!isReady || submitting}
                rows={3}
                className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 text-sm resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <button
              type="submit"
              disabled={!isReady || !taskInput.trim() || submitting}
              className="self-end px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
          {!isReady && !isIndexing && (
            <p className="mt-3 text-xs text-yellow-500">
              ⚠ Index the repository first so Forge understands your codebase.
            </p>
          )}
        </div>

        {/* ── Task list ── */}
        {tasks.length > 0 && (
          <div>
            <h2 className="font-semibold text-zinc-100 mb-4">Tasks</h2>
            <div className="flex flex-col gap-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  expanded={expandedTask === task.id}
                  onToggle={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────

function IndexStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle: { label: 'Not indexed', cls: 'bg-zinc-800 text-zinc-500' },
    indexing: { label: 'Indexing', cls: 'bg-yellow-950 text-yellow-400 border border-yellow-800' },
    ready: { label: 'Ready', cls: 'bg-green-950 text-green-400 border border-green-800' },
    error: { label: 'Error', cls: 'bg-red-950 text-red-400 border border-red-800' },
  }
  const s = map[status] ?? map.idle
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

function TaskCard({
  task,
  expanded,
  onToggle,
}: {
  task: Task
  expanded: boolean
  onToggle: () => void
}) {
  const statusIcon = {
    queued: <Clock className="w-4 h-4 text-zinc-500" />,
    running: <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />,
    done: <CheckCircle2 className="w-4 h-4 text-green-400" />,
    failed: <XCircle className="w-4 h-4 text-red-400" />,
  }[task.status]

  const statusLabel = {
    queued: 'Queued',
    running: 'Running…',
    done: 'Done',
    failed: 'Failed',
  }[task.status]

  const timeAgo = getTimeAgo(task.createdAt)

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="shrink-0">{statusIcon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 truncate">{task.description}</p>
          <p className="text-xs text-zinc-600 mt-0.5">
            {statusLabel} · {timeAgo}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-600 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-800 p-4 space-y-4">
          {/* Summary */}
          {task.resultSummary && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Summary</p>
              <p className="text-sm text-zinc-300">{task.resultSummary}</p>
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-900">
              <p className="text-xs text-red-400">{task.error}</p>
            </div>
          )}

          {/* Files changed */}
          {task.filesChanged && task.filesChanged.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">
                Files Changed
              </p>
              <div className="space-y-1">
                {task.filesChanged.map((f) => (
                  <div key={f.path} className="flex items-center gap-2">
                    <FileCode className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <span className="text-xs text-zinc-400 font-mono">{f.path}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        f.action === 'create'
                          ? 'bg-green-950 text-green-400'
                          : f.action === 'delete'
                          ? 'bg-red-950 text-red-400'
                          : 'bg-blue-950 text-blue-400'
                      }`}
                    >
                      {f.action}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Links */}
          <div className="flex gap-3 flex-wrap">
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                View PR
                <ExternalLink className="w-3 h-3 text-zinc-500" />
              </a>
            )}
            {task.deployUrl && (
              <a
                href={task.deployUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-950 hover:bg-green-900 text-green-400 text-xs font-medium transition-colors border border-green-800"
              >
                <Zap className="w-3.5 h-3.5" />
                View Deploy
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
