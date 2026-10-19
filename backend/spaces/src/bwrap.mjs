// Adapted from Fairybot processing/bwrap.ts: narrow mounts, networking chosen by each caller.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
function sharedEnvPrepend(envRoot) {
  return {
    PATH: `${envRoot}/bin:${envRoot}/python/bin:${envRoot}/node/node_modules/.bin:${BASE_PATH}`,
    PYTHONPATH: `${envRoot}/python`,
    NODE_PATH: `${envRoot}/node/node_modules`
  }
}
function carrierEnv(workspaceRoot, envRoot) {
  return {
    ...envRoot === undefined ? {
      PATH: BASE_PATH
    } : sharedEnvPrepend(envRoot),
    HOME: workspaceRoot,
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    PAGER: 'cat',
    GIT_PAGER: 'cat'
  }
}
const RUNTIME_DIRS = ['/usr', '/lib', '/lib64', '/bin', '/sbin']
const RUNTIME_FILES = ['/etc/ld.so.cache', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/hosts',
  '/etc/resolv.conf', '/etc/localtime', '/etc/ssl']
function bindRuntimeBase(args, mounted, roBind, extraRoDirs = []) {
  for (const dir of RUNTIME_DIRS) {
    if (!existsSync(dir)) continue
    const stat = lstatSync(dir)
    if (stat.isSymbolicLink()) {
      const target = realpathSync(dir)
      roBind(target)
      args.push('--symlink', target, dir)
    } else if (stat.isDirectory()) {
      roBind(dir)
    }
  }
  for (const file of RUNTIME_FILES) {
    if (!existsSync(file)) continue
    args.push('--ro-bind', file, file)
    mounted.add(file)
  }
  for (const dir of extraRoDirs) {
    if (existsSync(dir)) roBind(dir)
  }
}
export function buildBwrapArgv(bwrapPath, spec, argv) {
  if (typeof spec.network !== 'boolean') throw new Error('bwrap spec.network must state whether the caller shares the host network')
  const args = [bwrapPath, '--die-with-parent', '--new-session', '--unshare-all', ...spec.network ? ['--share-net'] : [], '--clearenv',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp']
  const mounted = new Set()
  const roBind = (hostPath) => {
    if (mounted.has(hostPath)) return
    mounted.add(hostPath)
    args.push('--ro-bind', hostPath, hostPath)
  }
  bindRuntimeBase(args, mounted, roBind)
  if (spec.envRoot !== undefined && existsSync(spec.envRoot)) args.push('--bind', spec.envRoot, spec.envRoot)
  for (const dir of spec.writableRoots ?? []) {
    if (mounted.has(dir)) continue
    mounted.add(dir)
    args.push(spec.writable ? '--bind' : '--ro-bind', dir, dir)
  }
  for (const root of spec.readRoots)roBind(root);
  if (spec.writable) {
    if (!mounted.has(spec.workspaceRoot)) args.push('--bind', spec.workspaceRoot, spec.workspaceRoot)
    mounted.add(spec.workspaceRoot)
  } else { roBind(spec.workspaceRoot) }
  for (const [key, value] of Object.entries(carrierEnv(spec.workspaceRoot, spec.envRoot))) {
    args.push('--setenv', key, value)
  }
  args.push('--chdir', spec.cwd ?? spec.workspaceRoot, '--', ...argv)
  return args
}
export const BWRAP_DENIAL_SIGNATURES = ['read-only file system', 'operation not permitted', 'permission denied']
export const BWRAP_RUNNER_FAILURE_RULES = [{ fatalSignatures: ['bwrap:'] }]
export function probeBwrap(bwrapPath) {
  const version = spawnSync(bwrapPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (version.error !== undefined || version.status !== 0) {
    return {
      ok: false,
      detail: `bwrap --version failed: ${version.error?.message ?? `exit ${version.status}`}`
    }
  }
  const selfCheck = [bwrapPath, '--die-with-parent', '--unshare-all', '--clearenv', '--proc', '/proc', '--dev', '/dev',
    '--tmpfs', '/tmp']
  const mounted = new Set()
  bindRuntimeBase(selfCheck, mounted, (hostPath) => { if (mounted.has(hostPath)) return; mounted.add(hostPath)
    selfCheck.push('--ro-bind', hostPath, hostPath) })
  selfCheck.push('--chdir', '/tmp', '--', '/bin/sh', '-c', 'true')
  const check = spawnSync(selfCheck[0], selfCheck.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
  if (check.error !== undefined || check.status !== 0) {
    const stderr = check.stderr?.toString().trim()
    return {
      ok: false,
      detail: `bwrap namespace self-check failed: ${check.error?.message ?? stderr ?? `exit ${check.status}`}`
    }
  }
  return {
    ok: true
  }
}
