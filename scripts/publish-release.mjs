#!/usr/bin/env node
import { spawn } from 'node:child_process'

const refName = process.env.GITHUB_REF_NAME ?? ''
const isPrerelease = refName.includes('-')
const releaseType = isPrerelease ? 'prerelease' : 'release'

const args = [
  'exec',
  'electron-builder',
  '--config',
  'electron-builder.yml',
  '--publish',
  'always',
  `--config.publish.releaseType=${releaseType}`,
]

console.log(`Publishing ${releaseType} release for tag ${refName || '(unknown)'}`)

const child = spawn('pnpm', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', code => {
  process.exit(code ?? 1)
})

child.on('error', error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
