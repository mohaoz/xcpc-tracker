const CATALOG_MUTATED_EVENT = "xvg:catalog-mutated";

export function emitCatalogMutated(): void {
  window.dispatchEvent(new CustomEvent(CATALOG_MUTATED_EVENT));
}

export function subscribeCatalogMutated(listener: () => void): () => void {
  const wrapped = () => listener();
  window.addEventListener(CATALOG_MUTATED_EVENT, wrapped);
  return () => {
    window.removeEventListener(CATALOG_MUTATED_EVENT, wrapped);
  };
}
