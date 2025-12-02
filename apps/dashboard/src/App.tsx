import React, { useState, useEffect } from 'react';
import { NetworkVisualization } from './components/NetworkVisualization';
import { VirtualNetworkVisualization } from './components/VirtualNetworkVisualization';
import { MetricsCharts } from './components/MetricsCharts';
import { EventTimeline } from './components/EventTimeline';
import { SummaryPanel } from './components/SummaryPanel';
import { QuickStats } from './components/QuickStats';
import { Activity, Wifi, WifiOff, GitBranch, Server } from 'lucide-react';

interface DashboardData {
  routingMode: 'physical' | 'virtual';
  prfc: {
    ewma: number;
    slope: number;
    activePath: string[];
    backupPath: string[];
    mode: string;
  };
  stats: {
    totalRequests: number;
    droppedRequests: number;
    dropRate: string;
    avgLatency: string;
    timeSinceFailover: number | null;
  };
  nodes: Record<string, any>;
  latencyHistory: Array<{ timestamp: number; latency: number; deadlineMet: boolean }>;
  events: Array<any>;
  virtualTopology?: {
    nodes: Array<any>;
    links: Array<any>;
    activePaths: Array<any>;
  };
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ewmaHistory, setEwmaHistory] = useState<Array<{ time: number; value: number }>>([]);
  const [slopeHistory, setSlopeHistory] = useState<Array<{ time: number; value: number }>>([]);
  const [viewMode, setViewMode] = useState<'physical' | 'virtual'>('physical');

  const GATEWAY_URL = 'http://localhost:4000';
  const POLL_INTERVAL = 1500;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/dashboard/metrics`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const newData = await response.json();
        setData(newData);
        setConnected(true);
        setError(null);

        const currentTime = Math.floor(Date.now() / 1000) % 300;

        setEwmaHistory((prev) => {
          const updated = [...prev, { time: currentTime, value: newData.prfc.ewma }];
          return updated.slice(-60);
        });

        setSlopeHistory((prev) => {
          const updated = [...prev, { time: currentTime, value: newData.prfc.slope }];
          return updated.slice(-60);
        });
      } catch (err) {
        setConnected(false);
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      }
    };

    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <WifiOff className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Connection Error</h1>
          <p className="text-gray-600 mb-4">Unable to connect to the PRFC Gateway</p>
          <p className="text-sm text-gray-500 mb-4">Make sure the gateway is running at {GATEWAY_URL}</p>
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-16 h-16 text-blue-600 mx-auto mb-4 animate-pulse" />
          <h1 className="text-2xl font-bold text-gray-800">Loading PRFC Dashboard...</h1>
          <p className="text-gray-600 mt-2">Connecting to {GATEWAY_URL}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <header className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Activity className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">PRFC Dashboard</h1>
                <p className="text-sm text-gray-600">Predictive Resilience Failover Controller</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                {connected ? (
                  <>
                    <Wifi className="w-5 h-5 text-green-500" />
                    <span className="text-sm text-green-600 font-semibold">Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-5 h-5 text-red-500 animate-pulse" />
                    <span className="text-sm text-red-600 font-semibold">Disconnected</span>
                  </>
                )}
              </div>

              <div className="text-sm text-gray-500">
                {new Date().toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <QuickStats
          totalRequests={data.stats.totalRequests}
          dropRate={data.stats.dropRate}
          avgLatency={data.stats.avgLatency}
          timeSinceFailover={data.stats.timeSinceFailover}
        />

        {data.routingMode === 'virtual' && data.virtualTopology && (
          <div className="flex justify-center mb-4">
            <div className="inline-flex rounded-lg border border-gray-300 bg-white p-1 shadow-sm">
              <button
                onClick={() => setViewMode('physical')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-2 ${
                  viewMode === 'physical'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Server className="w-4 h-4" />
                <span>Physical View (3 Nodes)</span>
              </button>
              <button
                onClick={() => setViewMode('virtual')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center space-x-2 ${
                  viewMode === 'virtual'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <GitBranch className="w-4 h-4" />
                <span>Virtual View (24 Nodes)</span>
              </button>
            </div>
          </div>
        )}

        {viewMode === 'physical' ? (
          <NetworkVisualization
            nodes={data.nodes}
            activePath={data.prfc.activePath}
            backupPath={data.prfc.backupPath}
          />
        ) : (
          data.virtualTopology && (
            <VirtualNetworkVisualization
              nodes={data.virtualTopology.nodes}
              links={data.virtualTopology.links}
              activePaths={data.virtualTopology.activePaths}
            />
          )
        )}

        <SummaryPanel
          ewma={data.prfc.ewma}
          slope={data.prfc.slope}
          activePath={data.prfc.activePath}
          timeSinceFailover={data.stats.timeSinceFailover}
          totalRequests={data.stats.totalRequests}
          dropRate={data.stats.dropRate}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <MetricsCharts
              ewma={data.prfc.ewma}
              slope={data.prfc.slope}
              ewmaHistory={ewmaHistory}
              slopeHistory={slopeHistory}
            />
          </div>

          <div className="lg:col-span-1">
            <EventTimeline events={data.events} />
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-4 text-center text-sm text-gray-600">
          <p>PRFC Research Project &mdash; Real-time Predictive Resilience Monitoring</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
