import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'child_process'

// Get git SHA at build time (safe - no user input)
function getGitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'])
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_SHA__: JSON.stringify(getGitSha()),
  },
})
