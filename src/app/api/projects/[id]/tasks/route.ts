import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getProject, createTask, updateTask, getProjectTasks } from '@/lib/supabase'
import { runTaskAgent } from '@/lib/ai/agent'

export const runtime = 'nodejs'
export const maxDuration = 300  // Tasks can take several minutes

// GET /api/projects/[id]/tasks — list tasks for a project
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: projectId } = await params

  try {
    const project = await getProject(projectId)
    if (project.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tasks = await getProjectTasks(projectId)
    return NextResponse.json({ data: tasks })
  } catch (err) {
    console.error('Failed to get tasks:', err)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

// POST /api/projects/[id]/tasks — submit a new task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.accessToken || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: projectId } = await params

  try {
    const body = await req.json()
    const { description } = body as { description: string }

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Task description required' }, { status: 400 })
    }

    const project = await getProject(projectId)
    if (project.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (project.index_status !== 'ready') {
      return NextResponse.json(
        { error: 'Repository must be indexed before running tasks. Please index it first.' },
        { status: 422 }
      )
    }

    // Create task record
    const task = await createTask({
      projectId,
      userId: session.user.id,
      description: description.trim(),
    })

    // Run agent asynchronously — don't await here so we return quickly
    runTaskAgent({
      taskId: task.id,
      projectId,
      description: description.trim(),
      repoFullName: project.repo_full_name,
      defaultBranch: project.default_branch,
      accessToken: session.accessToken,
      vercelProject: project.vercel_project,
    })
      .then(async (result) => {
        await updateTask(task.id, {
          status: 'done',
          branchName: result.branchName,
          prUrl: result.prUrl,
          deployUrl: result.deployUrl ?? undefined,
          // Include complexity + model in summary so UI can display it
          resultSummary: `[${result.complexity.toUpperCase()} · ${result.modelUsed.split('/').pop()}] ${result.summary}`,
          filesChanged: result.filesChanged,
          completedAt: new Date().toISOString(),
        })
      })
      .catch(async (err) => {
        console.error('Task agent error:', err)
        await updateTask(task.id, {
          status: 'failed',
          error: String(err),
          completedAt: new Date().toISOString(),
        })
      })

    return NextResponse.json({ data: task }, { status: 202 })
  } catch (err) {
    console.error('Failed to submit task:', err)
    return NextResponse.json({ error: 'Failed to submit task' }, { status: 500 })
  }
}
