export function nextGeneration(current: number): number {
  return current + 1
}

export function isCurrentGeneration(expected: number, actual: number): boolean {
  return expected === actual
}
