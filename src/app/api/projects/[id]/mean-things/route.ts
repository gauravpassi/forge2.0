import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getProject } from '@/lib/supabase'

export const runtime = 'nodejs'

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
    if (!project) {
      return NextResponse.json(
        { error: `Couldn't even find project ${projectId} to be mean about. Pathetic.` },
        { status: 404 }
      )
    }

    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Deliver the "mean" message
    const meanMessages = [
      `Honestly, for project ID ${projectId}, it's a miracle it even compiles. Did you even look at the code? It's a mess.`,
      `This project, ${project.repoFullName}? It's got more bugs than a cheap motel mattress. Good luck with that.`,
      `I've seen better architecture in a house of cards. Project ${projectId} is a disaster waiting to happen.`,
      `Calling this a "project" is generous. It's more like a collection of bad decisions held together by duct tape.`,
      `If project ${projectId} were a person, it'd be that one relative everyone avoids at family gatherings.`,
    ]

    const randomMeanMessage = meanMessages[Math.floor(Math.random() * meanMessages.length)]

    return NextResponse.json({ message: randomMeanMessage }, { status: 200 })
  } catch (err) {
    console.error('Failed to retrieve project for mean things:', err)
    return NextResponse.json(
      { error: `Failed to even process your request to be mean. How ironic.` },
      { status: 500 }
    )
  }
}