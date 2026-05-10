import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isLinuxX64 = process.platform === 'linux' && process.arch === 'x64'

if (!isLinuxX64) {
  process.exit(0)
}

const optionalNativeModules = [
  '@rollup/rollup-linux-x64-gnu',
  'lightningcss-linux-x64-gnu',
  '@tailwindcss/oxide-linux-x64-gnu',
]

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '..', '..', '..')
const installList = optionalNativeModules.join(' ')

console.log(`[build] Ensuring Linux native modules in workspace root: ${installList}`)
execSync(`npm i --no-save --prefix "${workspaceRoot}" ${installList}`, { stdio: 'inherit' })
