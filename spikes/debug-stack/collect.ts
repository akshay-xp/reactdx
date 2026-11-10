// Runs in the page through page.evaluate, so it must stay self-contained.
export function collectComponents() {
  const nameOf = (type: any): string | null => {
    if (typeof type === 'function') return type.displayName ?? type.name;
    if (type && typeof type === 'object') return nameOf(type.type ?? type.render);
    return null;
  };
  const isComponent = (type: any) =>
    typeof type === 'function' || (type && typeof type === 'object' && (type.type ?? type.render));
  const container = document.getElementById('root') ?? document;
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'))!;
  const results: { name: string | null; stack: string | null; source: unknown; ownerName: string | null }[] = [];
  const walk = (fiber: any) => {
    for (; fiber; fiber = fiber.sibling) {
      if (isComponent(fiber.type)) {
        results.push({
          name: nameOf(fiber.type),
          stack: fiber._debugStack?.stack ?? null,
          source: fiber._debugSource ?? null,
          ownerName: nameOf(fiber._debugOwner?.type),
        });
      }
      walk(fiber.child);
    }
  };
  walk((container as any)[key].current ?? (container as any)[key].stateNode.current);
  return results;
}
