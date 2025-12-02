import React from 'react';
import { Brain, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

interface SummaryPanelProps {
  ewma: number;
  slope: number;
  activePath: string[];
  timeSinceFailover: number | null;
  totalRequests: number;
  dropRate: string;
}

export function SummaryPanel({ ewma, slope, activePath, timeSinceFailover, totalRequests, dropRate }: SummaryPanelProps) {
  const generateSummary = () => {
    const isHealthy = ewma < 70 && slope < 2;
    const isWarning = ewma >= 70 && ewma < 100;
    const isCritical = ewma >= 100 || slope >= 5;

    let summary = '';
    let icon = null;
    let bgColor = '';
    let textColor = '';

    if (isCritical) {
      summary = `System is experiencing degraded performance. EWMA latency is at ${ewma.toFixed(1)}ms (${((ewma / 100) * 100).toFixed(0)}% of threshold) with a slope of ${slope.toFixed(2)}ms/s. PRFC is actively monitoring and will reroute traffic if conditions worsen. Current path: ${activePath.join(' → ')}.`;
      icon = <AlertTriangle className="w-6 h-6" />;
      bgColor = 'bg-red-50 border-red-200';
      textColor = 'text-red-800';
    } else if (isWarning) {
      summary = `System performance is within acceptable range but approaching threshold. EWMA latency: ${ewma.toFixed(1)}ms. Slope: ${slope.toFixed(2)}ms/s. PRFC is monitoring closely. ${timeSinceFailover ? `Last failover: ${timeSinceFailover}s ago.` : 'No failovers detected.'} Active path: ${activePath.join(' → ')}.`;
      icon = <Clock className="w-6 h-6" />;
      bgColor = 'bg-yellow-50 border-yellow-200';
      textColor = 'text-yellow-800';
    } else {
      summary = `System is operating normally. All metrics are within healthy thresholds. EWMA latency: ${ewma.toFixed(1)}ms, Slope: ${slope.toFixed(2)}ms/s. ${totalRequests > 0 ? `Processed ${totalRequests} requests with ${dropRate}% drop rate.` : 'No traffic yet.'} ${timeSinceFailover ? `Last incident: ${timeSinceFailover}s ago. Traffic rerouted successfully.` : 'No incidents detected.'} Active path: ${activePath.join(' → ')}.`;
      icon = <CheckCircle2 className="w-6 h-6" />;
      bgColor = 'bg-green-50 border-green-200';
      textColor = 'text-green-800';
    }

    return { summary, icon, bgColor, textColor };
  };

  const { summary, icon, bgColor, textColor } = generateSummary();

  return (
    <div className={`bg-white rounded-lg shadow-lg p-6 border-l-4 ${bgColor}`}>
      <div className="flex items-start space-x-3">
        <div className={`flex-shrink-0 ${textColor}`}>
          <Brain className="w-6 h-6 mb-2" />
          {icon}
        </div>

        <div className="flex-grow">
          <h2 className="text-lg font-bold text-gray-800 mb-2">AI-Generated System Summary</h2>
          <p className="text-gray-700 leading-relaxed text-sm">
            {summary}
          </p>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Analysis Time:</span>
                <span className="ml-2 font-semibold">{new Date().toLocaleTimeString()}</span>
              </div>
              <div>
                <span className="text-gray-500">PRFC Mode:</span>
                <span className="ml-2 font-semibold">Predictive</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
