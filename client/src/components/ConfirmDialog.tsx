import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from './ui';

/**
 * Accessible confirmation dialog: role=dialog, aria-modal, Escape to close,
 * initial focus on the cancel action. Used before any moderation approval
 * so no action is ever one stray click.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="glass w-full max-w-md rounded-2xl bg-ink-900 p-5 shadow-2xl"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-slate-50">
          {title}
        </h2>
        <div className="mt-2 text-sm leading-relaxed text-slate-300">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
