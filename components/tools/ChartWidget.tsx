import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line
} from 'recharts';

interface ChartWidgetProps {
  data: any[];
  title?: string;
  dataKey?: string;
  chartType?: 'area' | 'bar' | 'line';
  color?: string;
}

export const ChartWidget: React.FC<ChartWidgetProps> = ({
  data,
  title = "Progress",
  dataKey = "value",
  chartType = 'area',
  color = "#E87A38"
}) => {
  if (!data || data.length === 0) return null;

  // Common props for charts
  const commonProps = {
    data: data,
    margin: { top: 10, right: 10, left: -20, bottom: 0 }
  };

  const renderChart = () => {
    switch (chartType) {
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8DED3" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#786F6C', fontFamily: 'Satoshi' }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#786F6C', fontFamily: 'Satoshi' }} />
            <Tooltip
              cursor={{ fill: '#F5F5F0' }}
              contentStyle={{ borderRadius: '12px', border: '1px solid #E8DED3', boxShadow: '0 8px 30px -4px rgba(65, 50, 40, 0.1)', fontFamily: 'Satoshi', fontSize: '12px', padding: '10px 14px', backgroundColor: '#FDFCFB', color: '#3A3735' }}
            />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        );
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8DED3" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#786F6C', fontFamily: 'Satoshi' }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#786F6C', fontFamily: 'Satoshi' }} />
            <Tooltip
              contentStyle={{ borderRadius: '12px', border: '1px solid #E8DED3', boxShadow: '0 8px 30px -4px rgba(65, 50, 40, 0.1)', fontFamily: 'Satoshi', fontSize: '12px', padding: '10px 14px', backgroundColor: '#FDFCFB', color: '#3A3735' }}
            />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
          </LineChart>
        );
      case 'area':
      default:
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="colorValueClaude" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="strokeGradientClaude" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={color} />
                <stop offset="100%" stopColor={color} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8DED3" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#786F6C', fontFamily: 'Satoshi' }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#786F6C', fontFamily: 'Satoshi' }} />
            <Tooltip
              contentStyle={{ borderRadius: '12px', border: '1px solid #E8DED3', boxShadow: '0 8px 30px -4px rgba(65, 50, 40, 0.1)', fontFamily: 'Satoshi', fontSize: '12px', padding: '10px 14px', backgroundColor: '#FDFCFB', color: '#3A3735' }}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} fillOpacity={1} fill="url(#colorValueClaude)" strokeWidth={2} />
          </AreaChart>
        );
    }
  };

  return (
    <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-sand-200 w-full max-w-md animate-slide-up-fade shadow-soft">
      <h4 className="font-display text-xs sm:text-sm font-bold text-ink-500 mb-4 sm:mb-5 uppercase tracking-wider">{title}</h4>
      <div className="h-36 sm:h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
};