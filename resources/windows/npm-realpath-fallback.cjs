
// AI File Guard compatibility addition to the pinned npm Arborist helper.
// Keep its normal cache/symlink behavior. LPAC can deny ancestor metadata even
// when the requested private file is readable; the native kernel realpath can
// resolve that target without enumerating host ancestors. It still enforces
// the exact same token/filesystem permissions and propagates access failures.
const guardOriginalRealpath = module.exports
const guardNativeRealpath = require('node:fs/promises').realpath
const guardResolvePath = require('node:path').resolve
module.exports = (input, rpcache, stcache, depth) =>
  Promise.resolve().then(() => guardOriginalRealpath(input, rpcache, stcache, depth)).catch(error => {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error
    return guardNativeRealpath(input).then(real => {
      rpcache.set(guardResolvePath(input), real)
      return real
    })
  })
