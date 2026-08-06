import * as ToastPrimitive from "@radix-ui/react-toast";
import { useSyncExternalStore } from "react";

import { useToastStore, type ToastItem } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitive.Provider;

function ToastViewport({ className }: { className?: string }) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed bottom-0 right-0 z-[100] flex max-h-screen w-full max-w-sm flex-col-reverse gap-2 p-4",
        className,
      )}
    />
  );
}

function useToastList(): ToastItem[] {
  const store = useToastStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Renders the live toast list; mount once near the app root. */
export function Toaster() {
  const store = useToastStore();
  const toasts = useToastList();
  return (
    <ToastProvider swipeDirection="right">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          open={t.open}
          onOpenChange={(open) => {
            if (!open) store.dismiss(t.id);
          }}
          className={cn(
            "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-3 shadow-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full",
            t.variant === "destructive"
              ? "border-danger/40 bg-danger/10 text-foreground"
              : "border-border bg-raised text-foreground",
          )}
        >
          <div className="min-w-0 flex-1">
            <ToastPrimitive.Title className="text-sm font-semibold">
              {t.title}
            </ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="mt-0.5 break-words text-xs text-muted">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
        </ToastPrimitive.Root>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
