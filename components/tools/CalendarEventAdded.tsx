import React from 'react';
import { CheckCircle2, Calendar } from 'lucide-react';

interface CalendarEventAddedProps {
  title: string;
  scheduledAt: string;
}

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return `Today at ${time}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` at ${time}`;
};

export const CalendarEventAdded: React.FC<CalendarEventAddedProps> = React.memo(({
  title,
  scheduledAt
}) => {
  return (
    <div className="bg-white/90 backdrop-blur-sm p-3 sm:p-4 rounded-2xl sm:rounded-3xl border border-sand-200 w-full max-w-sm animate-slide-up-fade shadow-soft flex items-center gap-3">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-teal/15 flex items-center justify-center">
        <CheckCircle2 className="w-5 h-5 text-accent-teal" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink-800 text-sm truncate">{title}</p>
        <p className="text-xs text-ink-500 font-body flex items-center gap-1 mt-0.5">
          <Calendar className="w-3 h-3 text-ink-400 flex-shrink-0" />
          {formatWhen(scheduledAt)}
        </p>
      </div>
    </div>
  );
});

CalendarEventAdded.displayName = 'CalendarEventAdded';
