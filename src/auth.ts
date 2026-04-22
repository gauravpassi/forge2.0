import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { upsertUser } from '@/lib/supabase'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          // Request repo access for clone/push/PR
          scope: 'read:user user:email repo',
        },
      },
    }),
  ],

  callbacks: {
    // Persist GitHub access token in JWT
    async jwt({ token, account, profile }) {
      if (account?.access_token) {
        token.accessToken = account.access_token
      }
      if (profile) {
        // GitHub profile has 'login' field
        const gh = profile as { login?: string; id?: number }
        token.login = gh.login
        token.userId = gh.id?.toString() ?? token.sub
      }
      return token
    },

    // Expose accessToken and GitHub login in session
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined
      session.user.id = token.userId as string ?? token.sub ?? ''
      session.user.login = token.login as string | undefined
      return session
    },

    // Upsert user in Supabase on every sign-in
    async signIn({ user, profile, account }) {
      if (account?.provider === 'github' && profile) {
        const gh = profile as {
          login?: string
          id?: number
          avatar_url?: string
          email?: string
          name?: string
        }
        try {
          await upsertUser({
            id: gh.id?.toString() ?? user.id ?? '',
            githubLogin: gh.login ?? '',
            name: gh.name ?? user.name ?? null,
            avatarUrl: gh.avatar_url ?? user.image ?? null,
            email: gh.email ?? user.email ?? null,
          })
        } catch (err) {
          console.error('Failed to upsert user:', err)
          // Don't block sign-in on DB error
        }
      }
      return true
    },
  },

  pages: {
    signIn: '/',
    error: '/',
  },
})
