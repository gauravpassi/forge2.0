'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  ArrowLeft,
  Zap,
  Brain,
  GitBranch,
  ExternalLink,
  Send,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FileCode,
  Plus,
  Sparkles,
} from 'lucide-react'
import type { Project, Task } from '@/types'

type IndexPhase = 'tree' | 'fetch' | 'chunk' | 'embed' | 'store' | 'done' | 'error' | null

interface IndexProgress {
  phase: IndexPhase
  filesTotal?: number
  filesDone?: number
  chunksTotal?: number
  message: string
}

// Friendly phase labels shown under the progress bar
const PHASE_LABELS: Record<string, string> = {
  tree:  'Scanning files',
  fetch: 'Reading code',
  chunk: 'Breaking it down',
  embed: 'Understanding patterns',
  store: 'Saving knowledge',
}
const PHASE_ORDER = ['tree', 'fetch', 'chunk', 'embed', 'store']

export default function ProjectPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { id: projectId } = useParams<{ id: string }>()

  const [project, setProject]           = useState<Project | null>(null)
  const [tasks, setTasks]               = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [view, setView]                 = useState<'submit' | 'task'>('submit')
  const [taskInput, setTaskInput]       = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [indexing, setIndexing]         = useState(false)
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null)
  const [indexJustDone, setIndexJustDone] = useState(false)
  const [indexedFileCount, setIndexedFileCount] = useState<number | null>(null)
  const [loading, setLoading]           = useState(true)

  const pollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

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

  // Poll while tasks are active
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === 'running' || t.status === 'queued')
    if (hasActive) {
      pollRef.current = setInterval(loadProject, 4000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [tasks, loadProject])

  // ── Index ─────────────────────────────────────────────────────

  async function startIndexing() {
    if (!project || indexing) return
    setIndexing(true)
    setIndexJustDone(false)
    setIndexProgress({ phase: 'tree', message: 'Starting…' })

    try {
      const res = await fetch(`/api/projects/${projectId}/index`, { method: 'POST' })
      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as IndexProgress
            setIndexProgress(data)
            if (data.filesTotal) setIndexedFileCount(data.filesTotal)
            if (data.phase === 'done') {
              await loadProject()
              setIndexJustDone(true)
              setTimeout(() => setIndexJustDone(false), 5000)
            } else if (data.phase === 'error') {
              await loadProject()
            }
          } catch {}
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
        const newTask = json.data as Task
        setTasks((prev) => [newTask, ...prev])
        setSelectedTaskId(newTask.id)
        setView('task')
      } else {
        alert(json.error ?? 'Failed to submit task')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Cancel task ───────────────────────────────────────────────

  async function cancelTask(taskId: string) {
    await fetch(`/api/projects/${projectId}/tasks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
    await loadProject()
  }

  // ── Loading ───────────────────────────────────────────────────

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

  const isReady    = project.indexStatus === 'ready'
  const isIndexing = project.indexStatus === 'indexing' || indexing
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">

      {/* ── Topbar ── */}
      <header className="shrink-0 border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3">
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
        <span className="text-zinc-400 text-sm truncate">{project.repoFullName}</span>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left sidebar: task history ── */}
        <aside className="w-64 shrink-0 border-r border-zinc-800 flex flex-col overflow-hidden">
          <div className="px-3 py-3 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tasks</span>
            <button
              onClick={() => { setSelectedTaskId(null); setView('submit') }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {tasks.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center mt-8 px-4">
                No tasks yet — submit one to get started
              </p>
            ) : (
              tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={selectedTaskId === task.id}
                  onClick={() => { setSelectedTaskId(task.id); setView('task') }}
                />
              ))
            )}
          </div>
        </aside>

        {/* ── Main panel ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-5">

            {/* ── Codebase card ── */}
            <CodebaseCard
              project={project}
              isReady={isReady}
              isIndexing={isIndexing}
              indexProgress={indexProgress}
              indexJustDone={indexJustDone}
              indexedFileCount={indexedFileCount}
              onIndex={startIndexing}
            />

            {/* ── Submit form or task detail ── */}
            {view === 'submit' || !selectedTask ? (
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <h2 className="font-semibold text-zinc-100 text-sm">What do you want to build?</h2>
                </div>
                <form onSubmit={submitTask}>
                  <textarea
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitTask(e as unknown as React.FormEvent)
                    }}
                    placeholder={
                      isReady
                        ? 'e.g. "Add a dark mode toggle to the navbar" or "Fix the login redirect bug"'
                        : 'Set up your codebase first using the panel above'
                    }
                    disabled={!isReady || submitting}
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 text-sm resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-zinc-600">⌘+Enter to submit</span>
                    <button
                      type="submit"
                      disabled={!isReady || !taskInput.trim() || submitting}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {submitting ? 'Submitting…' : 'Run task'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <TaskDetail task={selectedTask} onCancel={cancelTask} />
            )}

          </div>
        </main>
      </div>
    </div>
  )
}

// ── Codebase card ─────────────────────────────────────────────────

function CodebaseCard({
  project, isReady, isIndexing, indexProgress, indexJustDone, indexedFileCount, onIndex,
}: {
  project: Project
  isReady: boolean
  isIndexing: boolean
  indexProgress: IndexProgress | null
  indexJustDone: boolean
  indexedFileCount: number | null
  onIndex: () => void
}) {
  const currentPhaseIdx = PHASE_ORDER.indexOf(indexProgress?.phase ?? '')

  const subtitle = isIndexing
    ? 'Learning your codebase…'
    : isReady
    ? `Forge understands your codebase${indexedFileCount ? ` · ${indexedFileCount} files` : project.lastIndexedAt ? ` · updated ${new Date(project.lastIndexedAt).toLocaleDateString()}` : ''}`
    : project.indexStatus === 'error'
    ? 'Something went wrong — try again'
    : 'Not set up yet — let Forge read your code before running tasks'

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isReady ? 'bg-blue-600/20' : 'bg-zinc-800'
          }`}>
            <Brain className={`w-4 h-4 ${isReady ? 'text-blue-400' : 'text-zinc-500'}`} />
          </div>
          <div>
            <p className="font-medium text-zinc-100 text-sm">
              {isReady ? 'Codebase ready' : isIndexing ? 'Setting up…' : 'Codebase'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
          </div>
        </div>

        <button
          onClick={onIndex}
          disabled={isIndexing}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isIndexing
              ? 'bg-zinc-800 text-zinc-500 cursor-wait'
              : isReady
              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {isIndexing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…</>
          ) : isReady ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Refresh</>
          ) : (
            <><Brain className="w-3.5 h-3.5" /> Set up</>
          )}
        </button>
      </div>

      {/* Success banner */}
      {indexJustDone && (
        <div className="mt-4 flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-green-950/60 border border-green-800">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          <p className="text-sm text-green-300 font-medium">
            All done! Forge now understands your codebase.
          </p>
        </div>
      )}

      {/* Progress bar */}
      {isIndexing && indexProgress && !indexJustDone && (
        <div className="mt-4">
          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden mb-3">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{
                width:
                  indexProgress.phase === 'tree'  ? '8%'  :
                  indexProgress.phase === 'fetch' ? `${10 + Math.min(30, ((indexProgress.filesDone ?? 0) / Math.max(1, indexProgress.filesTotal ?? 1)) * 30)}%` :
                  indexProgress.phase === 'chunk' ? '55%' :
                  indexProgress.phase === 'embed' ? '75%' :
                  indexProgress.phase === 'store' ? '92%' : '10%',
              }}
            />
          </div>
          <div className="flex justify-between">
            {PHASE_ORDER.map((phase, i) => (
              <span key={phase} className={`text-xs ${
                i === currentPhaseIdx ? 'text-blue-400 font-medium' :
                i < currentPhaseIdx   ? 'text-zinc-500' : 'text-zinc-700'
              }`}>
                {PHASE_LABELS[phase]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {indexProgress?.phase === 'error' && !isIndexing && (
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950/50 border border-red-900">
          <p className="text-xs text-red-400">{indexProgress.message}</p>
        </div>
      )}
    </div>
  )
}

// ── Task row (sidebar) ────────────────────────────────────────────

function TaskRow({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
  const icon = {
    queued:  <Clock className="w-3 h-3 text-zinc-500 shrink-0" />,
    running: <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />,
    done:    <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />,
    failed:  <XCircle className="w-3 h-3 text-red-400 shrink-0" />,
  }[task.status]

  const isRunning = task.status === 'running'
  const liveMsg = isRunning && task.resultSummary && !task.resultSummary.startsWith('[')
    ? task.resultSummary
    : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 mx-1 rounded-lg transition-colors flex items-start gap-2 group ${
        selected ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
      }`}
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs truncate leading-snug ${selected ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-300'}`}>
          {task.description}
        </p>
        {liveMsg ? (
          <p className="text-xs text-blue-400 truncate mt-0.5 leading-snug">{liveMsg}</p>
        ) : (
          <p className="text-xs text-zinc-600 mt-0.5">{getTimeAgo(task.createdAt)}</p>
        )}
      </div>
    </button>
  )
}

// ── Task detail (main panel) ──────────────────────────────────────

function TaskDetail({ task, onCancel }: { task: Task; onCancel: (id: string) => void }) {
  const isRunning = task.status === 'running'
  const isQueued  = task.status === 'queued'
  const isActive  = isRunning || isQueued

  const complexityMatch = task.resultSummary?.match(/^\[(SIMPLE|MEDIUM|COMPLEX) · ([^\]]+)\]/)
  const complexityLabel = complexityMatch?.[1]
  const modelLabel = complexityMatch?.[2]
  const summaryText = task.resultSummary?.replace(/^\[.*?\]\s*/, '')

  const liveProgress = isRunning && task.resultSummary && !complexityMatch
    ? task.resultSummary : null

  const complexityColor: Record<string, string> = {
    SIMPLE:  'bg-green-950 text-green-400 border-green-800',
    MEDIUM:  'bg-blue-950 text-blue-400 border-blue-800',
    COMPLEX: 'bg-purple-950 text-purple-400 border-purple-800',
  }

  const statusIcon = {
    queued:  <Clock className="w-4 h-4 text-zinc-500" />,
    running: <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />,
    done:    <CheckCircle2 className="w-4 h-4 text-green-400" />,
    failed:  <XCircle className="w-4 h-4 text-red-400" />,
  }[task.status]

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800 flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{statusIcon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 leading-snug">{task.description}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs text-zinc-500">{getTimeAgo(task.createdAt)}</span>
            {complexityLabel && (
              <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${complexityColor[complexityLabel]}`}>
                {complexityLabel}
              </span>
            )}
            {modelLabel && (
              <span className="text-xs text-zinc-600 font-mono">{modelLabel}</span>
            )}
          </div>
        </div>
        {isActive && (
          <button
            onClick={() => onCancel(task.id)}
            className="shrink-0 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-red-400 hover:bg-red-950/40 border border-transparent hover:border-red-900 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Live progress */}
        {liveProgress && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-blue-950/40 border border-blue-900/50">
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
            <p className="text-sm text-blue-300">{liveProgress}</p>
          </div>
        )}

        {isQueued && (
          <p className="text-sm text-zinc-500">Queued — will start shortly…</p>
        )}

        {/* Summary */}
        {summaryText && !isActive && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">What was done</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{summaryText}</p>
          </div>
        )}

        {/* Error */}
        {task.error && (
          <div className="px-3 py-2.5 rounded-lg bg-red-950/50 border border-red-900">
            <p className="text-xs text-red-400 font-medium mb-0.5">Error</p>
            <p className="text-xs text-red-500">{task.error}</p>
          </div>
        )}

        {/* Files changed */}
        {task.filesChanged && task.filesChanged.length > 0 && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Files changed</p>
            <div className="space-y-1">
              {task.filesChanged.map((f) => (
                <div key={f.path} className="flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                  <span className="text-xs text-zinc-400 font-mono truncate flex-1">{f.path}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                    f.action === 'create' ? 'bg-green-950 text-green-400' :
                    f.action === 'delete' ? 'bg-red-950 text-red-400' :
                    'bg-blue-950 text-blue-400'
                  }`}>
                    {f.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        {(task.prUrl || task.deployUrl) && (
          <div className="flex gap-3 flex-wrap pt-1">
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                View pull request
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
                View deploy
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            )}
          </div>
        )}
      </div>
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
