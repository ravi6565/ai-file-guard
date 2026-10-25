/** Retry short Windows sharing violations without changing access controls. */
export async function retryWindowsSharing<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (process.platform !== 'win32' || attempt >= 6 || !['EBUSY', 'EPERM', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
