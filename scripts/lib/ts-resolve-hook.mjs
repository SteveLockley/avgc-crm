export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const relative = /^\.\.?\//.test(specifier);
    const hasExt = /\.[a-z]+$/i.test(specifier);
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && relative && !hasExt) {
      return nextResolve(specifier + '.ts', context);
    }
    throw err;
  }
}
