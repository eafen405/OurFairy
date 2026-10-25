// Adapted from Fairybot processing/bwrap.ts: narrow mounts, networking chosen by each caller.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'

const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

/**
 * The mounts and environment one confined execution gets.
 *
 * The profile states every choice it makes: a caller that does not say whether
 * it shares the host network is refused rather than confined by accident.
 */
export interface BwrapSpec {
  /** Absolute root the command starts in and may write under. */
  workspaceRoot: string
  /** Whether the caller shares the host network. */
  network: boolean
  /** Directories the command may write. */
  writableRoots?: readonly string[]
  /** Files and directories the command may only read. */
  readRoots: readonly string[]
  /** The shared environment directory, mounted read-write when it exists. */
  envRoot?: string
  /** Whether the workspace root itself is writable. */
  writable?: boolean
  /** The directory the command starts in; defaults to the workspace root. */
  cwd?: string
}

/** The outcome of one bwrap probe: whether the runner works here, and why not. */
export type BwrapProbe = { readonly ok: true } | { readonly ok: false; readonly detail: string }

function sharedEnvPrepend(envRoot: string) {
  return {
    PATH: `${envRoot}/bin:${envRoot}/python/bin:${envRoot}/node/node_modules/.bin:${BASE_PATH}`,
    PYTHONPATH: `${envRoot}/python`,
    NODE_PATH: `${envRoot}/node/node_modules`
  }
}

function carrierEnv(workspaceRoot: string, envRoot: string | undefined) {
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

function bindRuntimeBase(args: string[], mounted: Set<string>, roBind: (hostPath: string) => void, extraRoDirs: readonly string[] = []) {
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

/**
 * Build the argv one confined execution runs under.
 *
 * @param bwrapPath - the bwrap runner to invoke.
 * @param spec - the profile: mounts, environment and the network choice.
 * @param argv - the exact argv the caller wants to run inside the namespace.
 * @returns the bwrap argv, ready to spawn.
 */
export function buildBwrapArgv(bwrapPath: string, spec: BwrapSpec, argv: readonly string[]): string[] {
  if (typeof spec.network !== 'boolean') throw new Error('bwrap spec.network must state whether the caller shares the host network')
  const args = [bwrapPath, '--die-with-parent', '--new-session', '--unshare-all', ...spec.network ? ['--share-net'] : [], '--clearenv',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp']
  const mounted = new Set<string>()
  const roBind = (hostPath: string) => {
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
  for (const root of spec.readRoots) roBind(root)
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

/**
 * Probe whether bwrap works on this host.
 *
 * @param bwrapPath - the bwrap runner to probe.
 * @returns whether the runner works, and the reason when it does not.
 */
export function probeBwrap(bwrapPath: string): BwrapProbe {
  const version = spawnSync(bwrapPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (version.error !== undefined || version.status !== 0) {
    return {
      ok: false,
      detail: `bwrap --version failed: ${version.error?.message ?? `exit ${version.status}`}`
    }
  }
  const selfCheck = [bwrapPath, '--die-with-parent', '--unshare-all', '--clearenv', '--proc', '/proc', '--dev', '/dev',
    '--tmpfs', '/tmp']
  const mounted = new Set<string>()
  bindRuntimeBase(selfCheck, mounted, (hostPath) => { if (mounted.has(hostPath)) return; mounted.add(hostPath)
    selfCheck.push('--ro-bind', hostPath, hostPath) })
  selfCheck.push('--chdir', '/tmp', '--', '/bin/sh', '-c', 'true')
  const check = spawnSync(bwrapPath, selfCheck.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
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
