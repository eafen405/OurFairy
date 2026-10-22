import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

const prefix = '[DEBUG-retry-20261022]'
const targets = /\/(?:packages\/(?:llm\/(?:llm|llm-retry|llm-pi-ai)|core\/agent-loop|test-support\/llm-mock-server)|vendor\/cordis)\/lib\/index\.js$/

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (!targets.test(url)) return loaded
    const source = String(loaded.source)
    console.error(prefix, JSON.stringify({ stage: 'module', url, sha256: createHash('sha256').update(source).digest('hex') }))
    let patched = source
    if (url.includes('/llm-retry/')) {
      patched = patched.replace('validateConfig(config);', `console.error('${prefix}', JSON.stringify({stage: 'retry-apply', url: import.meta.url})); validateConfig(config);`)
      patched = patched.replace('if (policy === void 0) return next();', `console.error('${prefix}', JSON.stringify({stage: 'retry-recover', policy, code: failure.code, providerRetryAfterMs: failure.providerRetryAfterMs, aborted: signal.aborted, disposed: lifetime.signal.aborted})); if (policy === void 0) return next();`)
      patched = patched.replace('disposeListener();', `console.error('${prefix}', JSON.stringify({stage: 'retry-dispose'})); disposeListener();`)
    }
    if (url.includes('/agent-loop/')) {
      patched = patched.replace('const action = await this.dispatch.waterfall("agent/request-error", {', `console.error('${prefix}', JSON.stringify({stage: 'request-error', policy: preparedCall?.retryPolicy, code: finish.failure.code, providerRetryAfterMs: finish.failure.providerRetryAfterMs, aborted: signal.aborted})); const action = await this.dispatch.waterfall("agent/request-error", {`)
    }
    return { ...loaded, source: patched }
  },
})
