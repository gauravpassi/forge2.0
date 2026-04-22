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
    if (project.userId !== session.user.id) {
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
            project.repoFullName,
            project.defaultBranch,
            session.accessToken!,
            (progress) => send(progress)
          )
          send({ phase: 'done', chunksIndexed: result.chunksIndexed })
        } catch (err) {
          const raw = String(err)
          let message = raw

          // Surface actionable quota / rate-limit errors
          if (raw.includes('embed_content_free_tier_requests') || raw.includes('Quota exceeded')) {
            message =
              '🚫 Gemini embedding daily quota exceeded (free tier limit: 1,000 requests/day). ' +
              'Enable billing at aistudio.google.com to continue — ' +
              'paid tier has no daily cap and costs ~$0.00004 per 1K tokens.'
          } else if (raw.includes('429') || raw.includes('Too Many Requests')) {
            message =
              '⏳ Gemini rate limit hit. The indexer will retry automatically — ' +
              'if this keeps happening, enable billing at aistudio.google.com to get 1,500 RPM.'
          } else if (raw.includes('API_KEY') || raw.includes('API key')) {
            message = '🔑 Invalid Gemini API key. Check GOOGLE_GEMINI_API_KEY in your environment.'
          }

          send({ phase: 'error', message })
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
