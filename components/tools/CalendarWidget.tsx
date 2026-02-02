import React from 'react';
import { Calendar, Clock } from 'lucide-react';

export interface CalendarWidgetEvent {
  id?: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  description?: string;
}

interface CalendarWidgetProps {
  events: CalendarWidgetEvent[];
  title?: string;
  emptyMessage?: string;
}

const formatTime = (dateTime: string): string =>
  new Date(dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

const formatEventTimeRange = (
  start: { dateTime?: string; date?: string },
  end?: { dateTime?: string; date?: string }
): string => {
  if (start.date) return 'All day';
  if (!start.dateTime) return '';
  const startStr = formatTime(start.dateTime);
  if (end?.dateTime) return `${startStr} – ${formatTime(end.dateTime)}`;
  return startStr;
};

const formatEventDate = (start: { dateTime?: string; date?: string }): string => {
  const raw = start.dateTime || start.date;
  if (!raw) return '';
  return new Date(raw).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

export const CalendarWidget: React.FC<CalendarWidgetProps> = React.memo(({
  events = [],
  title = "Your calendar",
  emptyMessage = "No upcoming events — great time to schedule a workout."
}) => {
  const isEmpty = !events || events.length === 0;

  return (
    <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-sand-200 w-full max-w-md animate-slide-up-fade shadow-soft relative overflow-hidden">
      <div className="absolute top-0 right-0 w-28 h-28 bg-gradient-radial from-claude-200/25 to-transparent rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
      <div className="relative z-10 flex items-center gap-2 sm:gap-3 mb-4">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl flex items-center justify-center bg-gradient-to-br from-claude-500 to-claude-600 text-white shadow-sm">
          <Calendar className="w-5 h-5 sm:w-5 sm:h-5" />
        </div>
        <div>
          <h4 className="font-display font-bold text-ink-800 text-sm sm:text-base">{title}</h4>
          <p className="text-[10px] sm:text-xs text-ink-400 font-body">
            {isEmpty ? 'Clear schedule' : `${events.length} upcoming`}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <p className="relative z-10 text-sm text-ink-600 font-body">{emptyMessage}</p>
      ) : (
        <ul className="relative z-10 space-y-2 sm:space-y-2.5">
          {events.map((event, i) => {
            const timeStr = formatEventTimeRange(event.start, event.end);
            const dateStr = formatEventDate(event.start);
            return (
              <li
                key={event.id || i}
                className="flex items-start gap-3 p-2.5 sm:p-3 rounded-xl bg-sand-50/80 border border-sand-100"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-claude-100 flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5 text-claude-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-800 text-sm truncate">{event.summary}</p>
                  <p className="text-[11px] sm:text-xs text-ink-500 font-body">
                    {dateStr}{timeStr ? ` · ${timeStr}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

CalendarWidget.displayName = 'CalendarWidget';
