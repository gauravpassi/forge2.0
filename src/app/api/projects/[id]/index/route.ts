import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getProject } from '@/lib/supabase'
import { indexRepository } from '@/lib/rag/indexer'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min — indexing can be slow for large repos

// POST /api/projects/[id]/index — trigger RAG indexing
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
    const project = await getProject(projectId)

    // Ownership check
    if (project.user_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Stream progress back to client via SSE
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          const result = await indexRepository(
            projectId,
            project.repo_full_name,
            project.default_branch,
            session.accessToken!,
            (progress) => send(progress)
          )
          send({ phase: 'done', chunksIndexed: result.chunksIndexed })
        } catch (err) {
          send({ phase: 'error', message: String(err) })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    console.error('Index error:', err)
    return NextResponse.json({ error: 'Failed to start indexing' }, { status: 500 })
  }
}
