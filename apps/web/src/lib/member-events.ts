const MEMBER_MUTATED_EVENT = "xvg:member-mutated";

export function emitMemberMutated(): void {
  window.dispatchEvent(new CustomEvent(MEMBER_MUTATED_EVENT));
}

export function subscribeMemberMutated(listener: () => void): () => void {
  const wrapped = () => listener();
  window.addEventListener(MEMBER_MUTATED_EVENT, wrapped);
  return () => {
    window.removeEventListener(MEMBER_MUTATED_EVENT, wrapped);
  };
}
