
// AI File Guard compatibility addition to the pinned npm Arborist helper.
// The trusted launcher supplies canonical private roots already checked for
// reparse points. Seed only those ancestors, then keep Arborist's original
// lstat/readlink resolution below them. No host ancestor permissions are added.
const guardOriginalRealpath = module.exports
const guardPath = require('node:path')
let guardPrivateRoots = []
try {
  const roots = JSON.parse(process.env.AI_FILE_GUARD_PRIVATE_ROOTS || '[]')
  if (Array.isArray(roots)) guardPrivateRoots = roots.filter(root => typeof root === 'string' && guardPath.isAbsolute(root)).map(root => guardPath.resolve(root))
} catch { /* Invalid optimization metadata never grants filesystem access. */ }
module.exports = (input, rpcache, stcache, depth) => {
  const absolute = guardPath.resolve(input)
  for (const root of guardPrivateRoots) {
    const relative = guardPath.relative(root, absolute)
    if (relative !== '..' && !relative.startsWith('..' + guardPath.sep) && !guardPath.isAbsolute(relative)) {
      const spelling = absolute.slice(0, root.length)
      if (!rpcache.has(spelling)) rpcache.set(spelling, root)
    }
  }
  return guardOriginalRealpath(input, rpcache, stcache, depth)
}
