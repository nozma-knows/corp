export function element<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Required UI element missing: ${selector}`);
  return node;
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
