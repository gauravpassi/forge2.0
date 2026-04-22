import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listUserRepos } from '@/lib/github'

export const runtime = 'nodejs'

export async function GET() {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const repos = await listUserRepos(session.accessToken)
    return NextResponse.json({ data: repos })
  } catch (err) {
    console.error('Failed to list repos:', err)
    return NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 })
  }
}
