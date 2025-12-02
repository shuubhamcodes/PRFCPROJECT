import React from 'react';
import { AlertTriangle, RefreshCw, CheckCircle, Info, AlertCircle } from 'lucide-react';

interface Event {
  timestamp: number;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details?: any;
}

interface EventTimelineProps {
  events: Event[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const getEventIcon = (type: string, severity: string) => {
    if (type === 'failover' || type === 'reroute') return <RefreshCw className="w-5 h-5" />;
    if (type === 'recovery') return <CheckCircle className="w-5 h-5" />;
    if (severity === 'critical') return <AlertTriangle className="w-5 h-5" />;
    if (severity === 'warning') return <AlertCircle className="w-5 h-5" />;
    return <Info className="w-5 h-5" />;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-600 border-red-300';
      case 'warning': return 'bg-yellow-100 text-yellow-600 border-yellow-300';
      default: return 'bg-blue-100 text-blue-600 border-blue-300';
    }
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { hour12: false });
  };

  const getRelativeTime = (ts: number) => {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Event Timeline</h2>

      {events.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Info className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No events recorded yet</p>
          <p className="text-sm mt-1">Events will appear here as the system operates</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {events.map((event, index) => (
            <div
              key={index}
              className={`flex items-start space-x-3 p-3 rounded-lg border ${getSeverityColor(event.severity)} transition-all hover:shadow-md`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getEventIcon(event.type, event.severity)}
              </div>

              <div className="flex-grow min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm uppercase tracking-wide">
                    {event.type}
                  </span>
                  <span className="text-xs opacity-75 whitespace-nowrap ml-2">
                    {getRelativeTime(event.timestamp)}
                  </span>
                </div>

                <p className="text-sm mt-1 break-words">{event.message}</p>

                <div className="text-xs opacity-75 mt-1">
                  {formatTimestamp(event.timestamp)}
                </div>

                {event.details && Object.keys(event.details).length > 0 && (
                  <div className="text-xs mt-2 opacity-75 font-mono bg-white bg-opacity-50 rounded p-2">
                    {JSON.stringify(event.details, null, 2).slice(0, 100)}
                    {JSON.stringify(event.details).length > 100 && '...'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
