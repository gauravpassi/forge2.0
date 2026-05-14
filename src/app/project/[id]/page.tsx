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
  tree:  'Scanning files (don\'t get your hopes up)',
  fetch: 'Reading code (it\'s a struggle)',
  chunk: 'Breaking it down (into manageable pieces for *me*)',
  embed: 'Understanding patterns (if any exist)',
  store: 'Saving knowledge (for future mockery)',
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
        alert(json.error ?? 'Failed to submit task. Are you sure you\'re trying hard enough?')
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
        <p className="ml-4 text-zinc-500">Still waiting for something to happen...</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-500">
        Project not found. Maybe you should check your typing skills.
      </div>
    )
  }

  const isReady    = project.indexStatus === 'ready'
  const isIndexing = project.indexStatus === 'indexing' || indexing
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 shrink-0">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Dashboard</span>
        </button>
        <h1 className="text-lg font-semibold text-zinc-100">{project.repoFullName}</h1>
        <div className="w-20" /> {/* Spacer */}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Task List */}
        <div className="w-80 border-r border-zinc-800 flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Tasks</h2>
            <button
              onClick={() => {
                setSelectedTaskId(null)
                setView('submit')
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 text-xs font-medium transition-colors"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tasks.length === 0 && (
              <div className="p-4 text-center text-zinc-600 text-sm">No tasks yet.</div>
            )}
            {tasks.map((task) => (
              <TaskListItem
                key={task.id}
                task={task}
                isSelected={task.id === selectedTaskId}
                onClick={() => {
                  setSelectedTaskId(task.id)
                  setView('task')
                }}
              />
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Project Status / Indexing */}
          <div className="p-4 border-b border-zinc-800 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-medium text-zinc-300">Project Index</span>
                {isReady && (
                  <CheckCircle2 className="w-4 h-4 text-green-500 ml-1" />
                )}
                {project.indexStatus === 'error' && (
                  <XCircle className="w-4 h-4 text-red-500 ml-1" />
                )}
              </div>
              {!isIndexing && (
                <button
                  onClick={startIndexing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isIndexing}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {isReady ? 'Re-index' : 'Index now'}
                </button>
              )}
            </div>

            {isIndexing && indexProgress && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
                  <span>{PHASE_LABELS[indexProgress.phase ?? ''] ?? 'Working...'}</span>
                  {indexProgress.filesTotal && indexProgress.filesDone && (
                    <span>{indexProgress.filesDone}/{indexProgress.filesTotal} files</span>
                  )}
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${
                        (PHASE_ORDER.indexOf(indexProgress.phase ?? '') / PHASE_ORDER.length) * 100
                      }%`,
                    }}
                  ></div>
                </div>
                <p className="text-xs text-zinc-600 mt-1">{indexProgress.message}</p>
              </div>
            )}

            {indexJustDone && (
              <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
                <Sparkles className="w-3.5 h-3.5" />
                Index updated!
              </div>
            )}

            {project.indexStatus === 'error' && (
              <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950/50 border border-red-900">
                <p className="text-xs text-red-400 font-medium mb-0.5">Indexing Error</p>
                <p className="text-xs text-red-500">{project.indexError}</p>
              </div>
            )}

            {!isReady && !isIndexing && project.indexStatus !== 'error' && (
              <p className="text-sm text-zinc-500 mt-3">
                Index your project to enable AI capabilities.
              </p>
            )}
          </div>

          {/* Task Input / Selected Task View */}
          <div className="flex-1 overflow-y-auto">
            {view === 'submit' && (
              <div className="p-6">
                <h2 className="text-xl font-bold text-zinc-100 mb-4">What do you want to build?</h2>
                <form onSubmit={submitTask} className="flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="Describe your task (if you even have one worth doing)..."
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 focus:outline-none text-sm"
                    disabled={submitting || isIndexing}
                  />
                  <button
                    type="submit"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting || !taskInput.trim() || isIndexing}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Thinking... (barely)
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Unleash the chaos
                      </>
                    )}
                  </button>
                </form>
                {!isReady && (
                  <p className="text-sm text-red-400 mt-4">
                    Project must be indexed before submitting tasks.
                  </p>
                )}
              </div>
            )}

            {view === 'task' && selectedTask && (
              <TaskDetail task={selectedTask} onCancel={cancelTask} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface TaskListItemProps {
  task: Task
  isSelected: boolean
  onClick: () => void
}

function TaskListItem({ task, isSelected, onClick }: TaskListItemProps) {
  const statusIcon: Record<string, JSX.Element> = {
    queued: <Clock className="w-3.5 h-3.5 text-zinc-500" />,
    running: <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />,
    completed: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
    failed: <XCircle className="w-3.5 h-3.5 text-red-500" />,
    cancelled: <XCircle className="w-3.5 h-3.5 text-zinc-500" />,
  }

  const statusText: Record<string, string> = {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  }

  return (
    <button
      onClick={onClick}
      className={`flex flex-col p-4 text-left border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors ${
        isSelected ? 'bg-zinc-800' : ''
      }`}
    >
      <p className="text-sm text-zinc-100 font-medium line-clamp-2">{task.description}</p>
      <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
        {statusIcon[task.status]}
        <span>{statusText[task.status]}</span>
        <span className="text-zinc-700">·</span>
        <span>{getTimeAgo(task.createdAt)}</span>
      </div>
    </button>
  )
}

interface TaskDetailProps {
  task: Task
  onCancel: (taskId: string) => void
}

function TaskDetail({ task, onCancel }: TaskDetailProps) {
  const isActive = task.status === 'running' || task.status === 'queued'
  const isQueued = task.status === 'queued'
  const summaryText = task.summary
  const liveProgress = task.liveProgress

  const statusColor: Record<string, string> = {
    queued: 'text-zinc-500',
    running: 'text-blue-400',
    completed: 'text-green-500',
    failed: 'text-red-500',
    cancelled: 'text-zinc-500',
  }

  const statusIcon: Record<string, JSX.Element> = {
    queued: <Clock className="w-4 h-4" />,
    running: <Loader2 className="w-4 h-4 animate-spin" />,
    completed: <CheckCircle2 className="w-4 h-4" />,
    failed: <XCircle className="w-4 h-4" />,
    cancelled: <XCircle className="w-4 h-4" />,
  }

  const modelLabel: string | undefined = task.model?.split('-').slice(1, 3).join('-')

  return (
    <div className="flex flex-col h-full">
      <div className="p-5 border-b border-zinc-800 flex items-start justify-between">
        <div className="flex flex-col gap-1.5 pr-4">
          <p className="text-sm text-zinc-500 uppercase tracking-wider">Task</p>
          <p className="text-lg font-semibold text-zinc-100 leading-relaxed">{task.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`flex items-center gap-1.5 text-xs font-medium ${statusColor[task.status]}`}>
              {statusIcon[task.status]}
              {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-xs text-zinc-500">{getTimeAgo(task.createdAt)}</span>
            {modelLabel && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-800 text-xs text-zinc-600 font-mono">{modelLabel}</span>
            )}
          </div>
        </div>
        {isActive && (
          <button
            onClick={() => onCancel(task.id)}
            className="shrink-0 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-red-400 hover:bg-red-950/40 border border-transparent hover:border-red-900 transition-colors"
          >
            Admit defeat
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
          <p className="text-sm text-zinc-500">Queued — eventually, maybe. Don't hold your breath.</p>
        )}

        {/* Summary */}
        {summaryText && !isActive && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Behold, my minimal effort</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{summaryText}</p>
          </div>
        )}

        {/* Error */}
        {task.error && (
          <div className="px-3 py-2.5 rounded-lg bg-red-950/50 border border-red-900">
            <p className="text-xs text-red-400 font-medium mb-0.5">Oh, look. An error. Shocking.</p>
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