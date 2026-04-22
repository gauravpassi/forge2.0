'use client'

import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Zap, GitBranch, Brain, Rocket } from 'lucide-react'
import { GithubIcon } from '@/components/icons'

export default function HomePage() {
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/dashboard')
    }
  }, [status, router])

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-zinc-100 text-lg">Forge 2.0</span>
        </div>
        <button
          onClick={() => signIn('github')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-medium transition-colors"
        >
          <GithubIcon className="w-4 h-4" />
          Sign in
        </button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-950 border border-blue-800 text-blue-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            AI-Powered Engineering Platform
          </div>

          <h1 className="text-5xl font-bold text-zinc-100 mb-6 leading-tight">
            Describe the task.{' '}
            <span className="text-blue-500">Get a PR.</span>
          </h1>

          <p className="text-xl text-zinc-400 mb-12 leading-relaxed max-w-2xl mx-auto">
            Forge connects to your GitHub repo, builds a smart knowledge base of your codebase,
            and runs an AI agent that writes, commits, and ships code — asynchronously.
          </p>

          <button
            onClick={() => signIn('github')}
            className="inline-flex items-center gap-3 px-8 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-lg transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/30"
          >
            <GithubIcon className="w-5 h-5" />
            Continue with GitHub
          </button>

          <p className="text-zinc-600 text-sm mt-4">
            Free to try · No credit card · Your code stays private
          </p>
        </div>

        {/* Feature grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto w-full">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="p-6 rounded-xl bg-zinc-900 border border-zinc-800 text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center mb-4">
                <feature.Icon className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="font-semibold text-zinc-100 mb-2">{feature.title}</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-4 text-center text-zinc-600 text-xs">
        © 2025 Forge 2.0 · Built by{' '}
        <a
          href="https://upcoretechnologies.com"
          className="text-zinc-400 hover:text-zinc-300 underline"
        >
          Upcore Technologies
        </a>
      </footer>
    </div>
  )
}

const features = [
  {
    Icon: Brain,
    title: 'Smart Code KB',
    description:
      'Forge reads your entire repo and builds a vector knowledge base — understanding functions, patterns, and architecture.',
  },
  {
    Icon: GitBranch,
    title: 'RAG-First Tasks',
    description:
      'Every task searches the KB first, so generated code matches your exact style, imports, and conventions.',
  },
  {
    Icon: Rocket,
    title: 'Ship Automatically',
    description:
      'When done, Forge commits to a branch, opens a PR, and optionally triggers a Vercel deploy — zero clicks.',
  },
]
