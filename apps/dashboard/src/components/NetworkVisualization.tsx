import React from 'react';
import { Server, Activity, Cloud } from 'lucide-react';

interface Node {
  id: string;
  name: string;
  tier: 'edge' | 'core' | 'cloud';
  cpu: string;
  buffer: string;
  status: 'healthy' | 'degraded';
}

interface NetworkVisualizationProps {
  nodes: Record<string, Node>;
  activePath: string[];
  backupPath: string[];
}

export function NetworkVisualization({ nodes, activePath, backupPath }: NetworkVisualizationProps) {
  const getNodeIcon = (tier: string) => {
    switch (tier) {
      case 'edge': return <Server className="w-8 h-8" />;
      case 'core': return <Activity className="w-8 h-8" />;
      case 'cloud': return <Cloud className="w-8 h-8" />;
      default: return <Server className="w-8 h-8" />;
    }
  };

  const getStatusColor = (status: string) => {
    return status === 'degraded' ? 'bg-red-500' : 'bg-green-500';
  };

  const isNodeActive = (nodeId: string) => {
    return activePath.includes(nodeId);
  };

  const getPathColor = (path: string[]) => {
    return path.join('') === activePath.join('') ? 'stroke-blue-500' : 'stroke-gray-300';
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Network Topology</h2>

      <div className="relative h-64 flex items-center justify-between px-8">
        {Object.entries(nodes).map(([id, node], index) => {
          const isActive = isNodeActive(id);
          const positions = ['left-0', 'left-1/2 -translate-x-1/2', 'right-0'];

          return (
            <div
              key={id}
              className={`absolute ${positions[index]} flex flex-col items-center`}
            >
              <div className={`relative p-4 rounded-full ${getStatusColor(node.status)} bg-opacity-10 border-4 ${isActive ? 'border-blue-500 scale-110' : 'border-gray-300'} transition-all duration-300`}>
                <div className={node.status === 'degraded' ? 'text-red-600' : 'text-green-600'}>
                  {getNodeIcon(node.tier)}
                </div>
                <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${getStatusColor(node.status)} animate-pulse`} />
              </div>

              <div className="mt-3 text-center">
                <div className="font-bold text-gray-800">{id}</div>
                <div className="text-sm text-gray-600">{node.name}</div>
                <div className="text-xs mt-1 space-y-0.5">
                  <div className={`${parseFloat(node.cpu) > 80 ? 'text-red-600' : 'text-gray-600'}`}>
                    CPU: {node.cpu}%
                  </div>
                  <div className={`${parseFloat(node.buffer) > 70 ? 'text-yellow-600' : 'text-gray-600'}`}>
                    Buffer: {node.buffer}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: -1 }}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
            </marker>
          </defs>

          <line x1="15%" y1="50%" x2="48%" y2="50%" className={activePath.includes('n1') && activePath.includes('n2') ? 'stroke-blue-500' : 'stroke-gray-300'} strokeWidth="3" markerEnd="url(#arrowhead)" strokeDasharray={activePath.includes('n1') && activePath.includes('n2') ? '0' : '5,5'} />

          <line x1="52%" y1="50%" x2="85%" y2="50%" className={activePath.includes('n2') && activePath.includes('n3') ? 'stroke-blue-500' : 'stroke-gray-300'} strokeWidth="3" markerEnd="url(#arrowhead)" strokeDasharray={activePath.includes('n2') && activePath.includes('n3') ? '0' : '5,5'} />

          <path d="M 15% 50% Q 50% 20%, 85% 50%" className={activePath.includes('n1') && activePath.includes('n3') && !activePath.includes('n2') ? 'stroke-blue-500' : 'stroke-gray-300'} strokeWidth="3" fill="none" markerEnd="url(#arrowhead)" strokeDasharray={activePath.includes('n1') && activePath.includes('n3') && !activePath.includes('n2') ? '0' : '5,5'} />
        </svg>
      </div>

      <div className="mt-6 flex items-center justify-center space-x-6 text-sm">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
          <span>Active Path: {activePath.join(' → ')}</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
          <span>Backup Path: {backupPath.join(' → ')}</span>
        </div>
      </div>
    </div>
  );
}
