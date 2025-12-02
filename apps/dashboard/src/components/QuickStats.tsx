import React from 'react';
import { TrendingUp, Package, AlertCircle, Clock } from 'lucide-react';

interface QuickStatsProps {
  totalRequests: number;
  dropRate: string;
  avgLatency: string;
  timeSinceFailover: number | null;
}

export function QuickStats({ totalRequests, dropRate, avgLatency, timeSinceFailover }: QuickStatsProps) {
  const stats = [
    {
      label: 'Total Requests',
      value: totalRequests.toLocaleString(),
      icon: <Package className="w-6 h-6" />,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      label: 'Avg Latency',
      value: `${avgLatency} ms`,
      icon: <TrendingUp className="w-6 h-6" />,
      color: parseFloat(avgLatency) > 100 ? 'text-red-600' : 'text-green-600',
      bgColor: parseFloat(avgLatency) > 100 ? 'bg-red-100' : 'bg-green-100',
    },
    {
      label: 'Drop Rate',
      value: `${dropRate}%`,
      icon: <AlertCircle className="w-6 h-6" />,
      color: parseFloat(dropRate) > 5 ? 'text-red-600' : parseFloat(dropRate) > 1 ? 'text-yellow-600' : 'text-green-600',
      bgColor: parseFloat(dropRate) > 5 ? 'bg-red-100' : parseFloat(dropRate) > 1 ? 'bg-yellow-100' : 'bg-green-100',
    },
    {
      label: 'Last Failover',
      value: timeSinceFailover !== null ? `${timeSinceFailover}s ago` : 'None',
      icon: <Clock className="w-6 h-6" />,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, index) => (
        <div key={index} className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
          <div className="flex items-center justify-between">
            <div className={`p-3 rounded-lg ${stat.bgColor}`}>
              <div className={stat.color}>{stat.icon}</div>
            </div>
          </div>

          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{stat.label}</h3>
            <p className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
