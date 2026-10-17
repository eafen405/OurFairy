/**
 * The original-bytes download responder, as a factory the composition mounts
 * and a test drives directly. Client close cancels a pending source read and a
 * backpressure wait, and the file source is released on every path.
 */
import { once } from 'node:events'

/** Build the `(res, input) => Promise<void>` responder for `/attachments/download`. */
export function createDownloadResponder({ attachments }) {
  return async (res, input) => {
    const controller = new AbortController()
    const close = () => controller.abort()
    res.once('close', close)
    if (res.destroyed) close()
    const iterator = attachments.readFileStream(input.original, controller.signal)[Symbol.asyncIterator]()
    try {
      let step = await iterator.next()
      res.writeHead(200, { 'cache-control': 'no-store', 'content-type': input.mime,
        'content-length': input.original.bytes, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(input.name)}` })
      while (!step.done) {
        if (!res.write(step.value)) await once(res, 'drain', { signal: controller.signal })
        step = await iterator.next()
      }
      res.end()
    } catch (error) {
      if (!res.headersSent && !res.destroyed) throw error
      res.destroy(error)
    } finally {
      res.off('close', close)
      await iterator.return?.()
    }
  }
}
