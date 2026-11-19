export function memoryError(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*?Error: /, '') : '读取失败，请重试。'
}
