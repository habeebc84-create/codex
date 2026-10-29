import {
  AlertTriangle,
  BarChart3,
  HelpCircle,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  ShieldCheck,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chat', label: 'Live Chat', icon: MessagesSquare },
  { id: 'moderation', label: 'AI Moderation', icon: ShieldCheck },
  { id: 'insights', label: 'Community Insights', icon: BarChart3 },
  { id: 'questions', label: 'Important Questions', icon: HelpCircle },
  { id: 'incidents', label: 'Incident Timeline', icon: AlertTriangle },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar({
  current,
  onNavigate,
  alertCount,
}: {
  current: string;
  onNavigate: (view: string) => void;
  alertCount: number;
}) {
  return (
    <nav aria-label="Primary" className="nice-scroll flex gap-1 overflow-x-auto px-2 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = current === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              active ? 'bg-guard-600/25 text-guard-300 ring-1 ring-guard-400/40' : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
            }`}
          >
            <Icon size={18} aria-hidden="true" className="shrink-0" />
            <span className="whitespace-nowrap">{item.label}</span>
            {item.id === 'moderation' && alertCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                {alertCount > 99 ? '99+' : alertCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
