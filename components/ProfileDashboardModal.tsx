import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, LogOut, RefreshCw, Trophy, Target, Flame, Star, Zap, Award } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAppContext } from '../contexts/AppContext';
import { Button } from './ui/Button';
import { DashboardWidget } from './tools/DashboardWidget';
import { StreakTimeline } from './tools/StreakTimeline';
import { HabitHeatmap } from './tools/HabitHeatmap';
import { ChartWidget } from './tools/ChartWidget';
import { AchievementBadge } from './tools/AchievementBadge'; // still used elsewhere if needed

interface ProfileDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileDashboardModal({ isOpen, onClose }: ProfileDashboardModalProps) {
  const { user, signOut } = useAuth();
  const { dashboardSnapshot, refreshDashboardSnapshot } = useAppContext();
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // One-time refresh on open (refreshDashboardSnapshot is stable in AppContext)
    setIsRefreshing(true);
    refreshDashboardSnapshot({ force: true })
      .catch(console.warn)
      .finally(() => setIsRefreshing(false));
  }, [isOpen, refreshDashboardSnapshot]);

  // Prevent background scroll when modal open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const unlockedBadges = useMemo(() => {
    const unlocked = dashboardSnapshot?.achievements?.unlocked || [];
    // Show most meaningful first (celebrateOnMount true first, then title)
    return [...unlocked].sort((a, b) => {
      const aC = a.props?.celebrateOnMount ? 1 : 0;
      const bC = b.props?.celebrateOnMount ? 1 : 0;
      if (aC !== bC) return bC - aC;
      return (a.props?.title || '').localeCompare(b.props?.title || '');
    });
  }, [dashboardSnapshot]);

  if (!isOpen) return null;

  const renderBadgeIcon = (type: string) => {
    switch (type) {
      case 'streak':
        return <Flame className="w-8 h-8 text-claude-600" />;
      case 'milestone':
        return <Trophy className="w-8 h-8 text-accent-teal" />;
      case 'first':
        return <Star className="w-8 h-8 text-amber-500" />;
      case 'consistency':
        return <Target className="w-8 h-8 text-pink-500" />;
      case 'challenge':
        return <Zap className="w-8 h-8 text-purple-500" />;
      default:
        return <Award className="w-8 h-8 text-ink-400" />;
    }
  };

  return createPortal((
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-white/95 backdrop-blur rounded-3xl shadow-2xl border border-sand-200 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="px-5 sm:px-7 py-4 sm:py-5 border-b border-sand-200 bg-white/70">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-claude-500 to-claude-600 flex items-center justify-center text-white shadow-soft overflow-hidden flex-shrink-0">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-display font-bold">{user?.displayName?.[0] || 'U'}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-display font-bold text-ink-900 text-base sm:text-lg truncate">
                    {user?.displayName || 'Your dashboard'}
                  </h3>
                  {isRefreshing && (
                    <span className="text-[10px] sm:text-xs text-ink-400 font-medium">Updating…</span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-ink-400 truncate">
                  Goals, streaks, badges & your momentum — in one place
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="rounded-xl h-9 px-3"
                onClick={() => {
                  setIsRefreshing(true);
                  refreshDashboardSnapshot({ force: true })
                    .catch(console.warn)
                    .finally(() => setIsRefreshing(false));
                }}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>

              <Button
                variant="secondary"
                size="icon"
                className="rounded-xl h-9 w-9 border-red-200 hover:bg-red-50"
                onClick={() => {
                  signOut();
                  onClose();
                }}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="w-4 h-4 text-red-500" />
              </Button>

              <Button
                variant="secondary"
                size="icon"
                className="rounded-xl h-9 w-9"
                onClick={onClose}
                aria-label="Close dashboard"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 sm:px-7 py-5 sm:py-6 overflow-y-auto no-scrollbar max-h-[calc(85vh-80px)]">
          {!dashboardSnapshot ? (
            <div className="py-10 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-sand-100 border border-sand-200 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-ink-400 animate-spin" />
              </div>
              <p className="text-sm text-ink-500">Loading your dashboard…</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 w-full">
              {/* Left column */}
              <div className="space-y-5 sm:space-y-6 w-full">
                {/* Daily stats */}
                {dashboardSnapshot.tools.dashboard && (
                  <DashboardWidget {...dashboardSnapshot.tools.dashboard} />
                )}

                {/* Streak */}
                <div className="w-full">
                  <StreakTimeline {...dashboardSnapshot.tools.streakTimeline} />
                </div>

                {/* Weekly chart */}
                <ChartWidget
                  data={dashboardSnapshot.tools.weeklyWorkoutsChart.data}
                  title={dashboardSnapshot.tools.weeklyWorkoutsChart.chartTitle}
                  dataKey={dashboardSnapshot.tools.weeklyWorkoutsChart.dataKey}
                />
              </div>

              {/* Right column */}
              <div className="space-y-5 sm:space-y-6 w-full">
                {/* Goals */}
                <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-3xl sm:rounded-4xl shadow-soft-lg border border-sand-200 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-radial from-claude-100/30 to-transparent rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />

                  <div className="flex items-center justify-between mb-4 relative z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-claude-100 to-claude-50 border border-claude-200/50 flex items-center justify-center">
                        <Target className="w-5 h-5 text-claude-600" />
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-ink-800 text-base">Goals</h4>
                        <p className="text-xs text-ink-400 font-body">What you’re building toward</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-ink-500 bg-sand-100 border border-sand-200 px-2 py-1 rounded-full">
                      {dashboardSnapshot.goals.length}
                    </span>
                  </div>

                  {dashboardSnapshot.goals.length === 0 ? (
                    <p className="text-sm text-ink-500 relative z-10">
                      No goals yet. Add one to keep Zen’s suggestions aligned with what matters most.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 relative z-10">
                      {dashboardSnapshot.goals.slice(0, 8).map(g => (
                        <span
                          key={g.id}
                          className="text-xs font-semibold text-ink-700 bg-white border border-sand-200 px-3 py-1.5 rounded-full"
                          title={g.motivation || undefined}
                        >
                          {g.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Badges */}
                <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-3xl sm:rounded-4xl shadow-soft-lg border border-sand-200 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-radial from-teal-100/30 to-transparent rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
                  <div className="flex items-center justify-between mb-4 relative z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 border border-teal-200/50 flex items-center justify-center">
                        <Trophy className="w-5 h-5 text-accent-teal" />
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-ink-800 text-base">Badges</h4>
                        <p className="text-xs text-ink-400 font-body">Your wins (big and small)</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-ink-500 bg-sand-100 border border-sand-200 px-2 py-1 rounded-full">
                      {unlockedBadges.length}
                    </span>
                  </div>

                  {unlockedBadges.length === 0 ? (
                    <p className="text-sm text-ink-500 relative z-10">
                      Your first badge is close. Finish a workout and you’ll unlock “First Steps”.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 relative z-10 justify-center sm:justify-start">
                      {unlockedBadges.slice(0, 10).map(b => (
                        <div
                          key={b.key}
                          className="flex flex-col items-center justify-center gap-1 bg-white border border-sand-200 rounded-xl p-2 shadow-sm w-[72px] h-[72px]"
                          title={b.props.description || b.props.title}
                        >
                          <div className="flex-shrink-0">
                            {renderBadgeIcon(b.props.type)}
                          </div>
                          <p className="text-[9px] font-semibold text-ink-700 text-center leading-tight line-clamp-2">{b.props.title}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Heatmap */}
                <HabitHeatmap {...dashboardSnapshot.tools.habitHeatmap} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-7 py-4 border-t border-sand-200 bg-white/70 flex items-center justify-between gap-3">
          <p className="text-[11px] sm:text-xs text-ink-400">
            Updated {dashboardSnapshot ? new Date(dashboardSnapshot.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </p>
          <span className="text-[11px] sm:text-xs text-ink-300"> </span>
        </div>
      </div>
    </div>
  ), document.body);
}

