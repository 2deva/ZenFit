import React from 'react';
import { Flame, Footprints, Activity } from 'lucide-react';

interface DashboardProps {
  dailyProgress: number;
  caloriesBurned: number;
  stepsTaken: number;
  stepsGoal: number;
  activeMinutes: number;
  dataSource?: 'google_fit' | 'simulated';
  connectionStatus?: 'connected' | 'disconnected';
  onReconnect?: () => void;
}

export const DashboardWidget: React.FC<DashboardProps> = ({
  dailyProgress = 45, caloriesBurned = 420, stepsTaken = 2340, stepsGoal = 8000, activeMinutes = 45,
  dataSource, connectionStatus, onReconnect
}) => {
  return (
    <div className="w-full max-w-sm animate-slide-up-fade">
      {/* Main Progress Card */}
      <div className="bg-white/90 backdrop-blur-sm rounded-3xl sm:rounded-4xl p-4 sm:p-6 shadow-soft-lg mb-3 sm:mb-4 relative overflow-hidden border border-sand-200">

        <div className="absolute top-0 right-0 w-32 sm:w-40 h-32 sm:h-40 bg-gradient-radial from-claude-200/30 via-claude-100/10 to-transparent rounded-full blur-3xl -mr-12 sm:-mr-16 -mt-12 sm:-mt-16 pointer-events-none animate-breathe-slow"></div>
        <div className="absolute bottom-0 left-0 w-20 sm:w-24 h-20 sm:h-24 bg-gradient-radial from-sand-300/30 to-transparent rounded-full blur-2xl -ml-6 sm:-ml-8 -mb-6 sm:-mb-8 pointer-events-none"></div>

        <div className="flex justify-between items-start mb-4 sm:mb-6 relative z-10">
          <div>
            <h3 className="font-display text-lg sm:text-xl font-bold text-ink-800 tracking-tight">Daily Goal</h3>
            <p className="text-xs sm:text-sm text-ink-400 font-body mt-0.5">You're <span className="text-claude-600 font-semibold">{dailyProgress}%</span> there!</p>
          </div>
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-claude-400 to-claude-600 rounded-full blur-md opacity-30 group-hover:opacity-50 transition-opacity"></div>
            <div className="relative w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-claude-500 to-claude-600 rounded-full flex items-center justify-center shadow-soft">
              <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-white fill-white" />
            </div>
          </div>
        </div>

        <div className="relative h-3 sm:h-4 bg-sand-200 rounded-full mb-2 sm:mb-3 overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-claude-500 via-claude-400 to-claude-500 rounded-full transition-all duration-1000 ease-out shadow-sm"
            style={{ width: `${dailyProgress}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-gradient-shift"></div>
          </div>
        </div>
        <div className="flex justify-between text-[10px] sm:text-xs font-body">
          <span className="text-ink-300 font-medium">0</span>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <Footprints className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-ink-400" />
            <span className="font-bold text-ink-600">{stepsTaken.toLocaleString()} / {stepsGoal.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="group bg-white/90 backdrop-blur-sm p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-sand-200 flex items-center space-x-3 sm:space-x-4 hover:border-claude-300/50 transition-all duration-300 card-hover shadow-soft">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-claude-100 to-claude-50 border border-claude-200/50 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
            <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-claude-600" />
          </div>
          <div>
            <span className="block font-display text-lg sm:text-xl font-bold text-ink-800">{caloriesBurned}</span>
            <span className="text-[9px] sm:text-[10px] uppercase font-display font-bold text-ink-400 tracking-wider">Kcal</span>
          </div>
        </div>

        <div className="group bg-white/90 backdrop-blur-sm p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-sand-200 flex items-center space-x-3 sm:space-x-4 hover:border-accent-teal/30 transition-all duration-300 card-hover shadow-soft">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 border border-teal-200/50 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-accent-teal" />
          </div>
          <div>
            <span className="block font-display text-lg sm:text-xl font-bold text-ink-800">{activeMinutes}</span>
            <span className="text-[9px] sm:text-[10px] uppercase font-display font-bold text-ink-400 tracking-wider">Mins</span>
          </div>
        </div>
      </div>

      {/* Data source label and Reconnect */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] sm:text-xs text-ink-400 font-body">
          {dataSource === 'google_fit' && 'From Google Fit'}
          {dataSource === 'simulated' && connectionStatus !== 'disconnected' && 'Demo data'}
          {dataSource === 'simulated' && connectionStatus === 'disconnected' && 'Disconnected'}
        </span>
        {connectionStatus === 'disconnected' && onReconnect && (
          <button
            type="button"
            onClick={onReconnect}
            className="text-xs font-medium text-claude-600 hover:text-claude-700 underline focus:outline-none focus:ring-2 focus:ring-claude-400 rounded"
          >
            Reconnect Google
          </button>
        )}
      </div>
    </div>
  );
};