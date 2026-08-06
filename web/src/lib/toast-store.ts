// Minimal toast store (shadcn pattern) — one live toaster instance.
import { createContext, useContext } from "react";

export type ToastVariant = "default" | "destructive";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  open: boolean;
}

type ToastInput = Omit<ToastItem, "id" | "open">;

let nextId = 1;

export function createToastStore() {
  let listeners: Array<(t: ToastItem[]) => void> = [];
  let toasts: ToastItem[] = [];

  function emit(): void {
    for (const l of listeners) l(toasts);
  }

  function dismiss(id: string): void {
    toasts = toasts.map((t) => (t.id === id ? { ...t, open: false } : t));
    emit();
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }, 200);
  }

  return {
    subscribe(l: (t: ToastItem[]) => void): () => void {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    },
    getSnapshot(): ToastItem[] {
      return toasts;
    },
    toast(input: ToastInput): void {
      const id = `t${nextId++}`;
      toasts = [...toasts, { ...input, id, open: true }];
      emit();
      setTimeout(() => dismiss(id), 4000);
    },
    dismiss,
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;

export const ToastStoreContext = createContext<ToastStore | null>(null);

export function useToastStore(): ToastStore {
  const store = useContext(ToastStoreContext);
  if (!store) throw new Error("useToastStore must be used inside AppStore");
  return store;
}
