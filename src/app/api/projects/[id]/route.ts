import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getProject } from '@/lib/supabase'

export const runtime = 'nodejs'

// GET /api/projects/[id] — get single project (if you're even allowed)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    // Oh, look, another unauthorized attempt. How original.
    return NextResponse.json({ error: 'Access denied. What did you expect?' }, { status: 401 })
  }

  const { id: projectId } = await params

  try {
    const project = await getProject(projectId)
    if (project.userId !== session.user.id) {
      // Seriously, this isn't your project. Get your own.
      return NextResponse.json({ error: 'Not yours. Seriously, back off.' }, { status: 403 })
    }
    return NextResponse.json({ data: project })
  } catch (err) {
    console.error('Failed to get project:', err)
    // Couldn't find it. Maybe it never existed, or maybe you just can't type.
    return NextResponse.json({ error: 'Couldn\'t find that. Maybe it never existed, or maybe you just can\'t type.' }, { status: 404 })
  }
}