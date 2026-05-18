export function shouldAdvanceAfterRandomSelection({ type, previousSelected = [], nextSelected = [] }) {
  return type !== "multiple" && previousSelected.length === 0 && nextSelected.length > 0;
}
