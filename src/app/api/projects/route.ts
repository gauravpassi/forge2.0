import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createProject, getUserProjects } from '@/lib/supabase'

export const runtime = 'nodejs'

// GET /api/projects — list projects for current user
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const projects = await getUserProjects(session.user.id)
    return NextResponse.json({ data: projects })
  } catch (err) {
    console.error('Failed to get projects:', err)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

// POST /api/projects — create project from a selected repo
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { repoFullName, repoId, defaultBranch } = body as {
      repoFullName: string
      repoId: number
      defaultBranch: string
    }

    if (!repoFullName || !repoId) {
      return NextResponse.json({ error: 'repoFullName and repoId required' }, { status: 400 })
    }

    const project = await createProject({
      userId: session.user.id,
      repoFullName,
      repoId,
      defaultBranch: defaultBranch ?? 'main',
    })

    return NextResponse.json({ data: project }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create project'
    // Handle unique constraint (project already exists)
    if (message.includes('unique')) {
      return NextResponse.json({ error: 'Project already connected' }, { status: 409 })
    }
    console.error('Failed to create project:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
