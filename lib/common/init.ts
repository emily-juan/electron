import * as timers from 'timers'
import * as util from 'util'

import { electronBindingSetup } from '@electron/internal/common/electron-binding-setup'

process.electronBinding = electronBindingSetup(process._linkedBinding, process.type)

type AnyFn = (...args: any[]) => any

// setImmediate and process.nextTick makes use of uv_check and uv_prepare to
// run the callbacks, however since we only run uv loop on requests, the
// callbacks wouldn't be called until something else activated the uv loop,
// which would delay the callbacks for arbitrary long time. So we should
// initiatively activate the uv loop once setImmediate and process.nextTick is
// called.
const wrapWithActivateUvLoop = function <T extends AnyFn> (func: T): T {
  return wrap(func, function (func) {
    return function (this: any, ...args: any[]) {
      process.activateUvLoop()
      return func.apply(this, args)
    }
  }) as T
}

/**
 * Casts to any below for func are due to Typescript not supporting symbols
 * in index signatures
 *
 * Refs: https://github.com/Microsoft/TypeScript/issues/1863
 */
function wrap <T extends AnyFn> (func: T, wrapper: (fn: AnyFn) => T) {
  const wrapped = wrapper(func)
  if ((func as any)[util.promisify.custom]) {
    (wrapped as any)[util.promisify.custom] = wrapper((func as any)[util.promisify.custom])
  }
  return wrapped
}

process.nextTick = wrapWithActivateUvLoop(process.nextTick)

global.setImmediate = wrapWithActivateUvLoop(timers.setImmediate)
global.clearImmediate = timers.clearImmediate

if (process.type === 'browser') {
  // setTimeout needs to update the polling timeout of the event loop, when
  // called under Chromium's event loop the node's event loop won't get a chance
  // to update the timeout, so we have to force the node's event loop to
  // recalculate the timeout in browser process.
  global.setTimeout = wrapWithActivateUvLoop(timers.setTimeout)
  global.setInterval = wrapWithActivateUvLoop(timers.setInterval)
}

if (process.platform === 'win32') {
  // Always returns EOF for stdin stream.
  const { Readable } = require('stream')
  const stdin = new Readable()
  stdin.push(null)
  Object.defineProperty(process, 'stdin', {
    configurable: false,
    enumerable: true,
    get () {
      return stdin
    }
  })
}