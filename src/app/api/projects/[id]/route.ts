import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getProject } from '@/lib/supabase'

export const runtime = 'nodejs'

// GET /api/projects/[id] — get single project
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
    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ data: project })
  } catch (err) {
    console.error('Failed to get project:', err)
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
}
