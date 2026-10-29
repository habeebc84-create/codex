import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-2xl p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-100">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      'bg-guard-600 text-white hover:bg-guard-500 disabled:bg-guard-600/50',
    secondary:
      'bg-white/10 text-slate-100 hover:bg-white/15 disabled:opacity-50',
    danger:
      'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-600/50',
    ghost: 'text-slate-300 hover:bg-white/10 disabled:opacity-50',
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: 'slate' | 'violet' | 'blue' | 'amber' | 'rose' | 'emerald' | 'red';
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    slate: 'bg-white/10 text-slate-200 ring-white/15',
    violet: 'bg-guard-500/15 text-guard-300 ring-guard-400/30',
    blue: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
    rose: 'bg-rose-500/15 text-rose-300 ring-rose-400/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
    red: 'bg-red-500/15 text-red-300 ring-red-400/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<string, 'slate' | 'amber' | 'rose' | 'red'> = {
  low: 'slate',
  medium: 'amber',
  high: 'rose',
  critical: 'red',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY_TONE[severity] ?? 'slate'}>{severity.toUpperCase()}</Badge>;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-50">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-400">
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-guard-400"
      />
      {label}
    </p>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-0.5">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}
