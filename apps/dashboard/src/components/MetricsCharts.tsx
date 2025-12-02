import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Activity } from 'lucide-react';

interface MetricsChartsProps {
  ewma: number;
  slope: number;
  ewmaHistory: Array<{ time: number; value: number }>;
  slopeHistory: Array<{ time: number; value: number }>;
}

export function MetricsCharts({ ewma, slope, ewmaHistory, slopeHistory }: MetricsChartsProps) {
  const getEWMAStatus = (value: number) => {
    if (value > 100) return { color: 'text-red-600', bg: 'bg-red-100', label: 'CRITICAL' };
    if (value > 70) return { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'WARNING' };
    return { color: 'text-green-600', bg: 'bg-green-100', label: 'HEALTHY' };
  };

  const getSlopeStatus = (value: number) => {
    if (value > 5) return { color: 'text-red-600', bg: 'bg-red-100', label: 'RISING' };
    if (value > 2) return { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'MODERATE' };
    return { color: 'text-green-600', bg: 'bg-green-100', label: 'STABLE' };
  };

  const ewmaStatus = getEWMAStatus(ewma);
  const slopeStatus = getSlopeStatus(slope);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-bold text-gray-800">EWMA Latency</h3>
          </div>
          <div className={`px-3 py-1 rounded-full ${ewmaStatus.bg} ${ewmaStatus.color} text-sm font-semibold`}>
            {ewmaStatus.label}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-3xl font-bold text-gray-900">{ewma.toFixed(1)} <span className="text-lg text-gray-500">ms</span></div>
          <div className="text-sm text-gray-500 mt-1">Threshold: 100ms</div>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={ewmaHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => `${value}s`}
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
              domain={[0, 'auto']}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: 'white' }}
              labelFormatter={(value) => `Time: ${value}s`}
              formatter={(value: any) => [`${value.toFixed(2)} ms`, 'EWMA']}
            />
            <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="5 5" label={{ value: 'Threshold', fill: '#ef4444', fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-bold text-gray-800">Latency Slope</h3>
          </div>
          <div className={`px-3 py-1 rounded-full ${slopeStatus.bg} ${slopeStatus.color} text-sm font-semibold`}>
            {slopeStatus.label}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-3xl font-bold text-gray-900">{slope.toFixed(2)} <span className="text-lg text-gray-500">ms/s</span></div>
          <div className="text-sm text-gray-500 mt-1">Threshold: 5ms/s</div>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={slopeHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => `${value}s`}
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: 'white' }}
              labelFormatter={(value) => `Time: ${value}s`}
              formatter={(value: any) => [`${value.toFixed(2)} ms/s`, 'Slope']}
            />
            <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="5 5" label={{ value: 'Threshold', fill: '#ef4444', fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
