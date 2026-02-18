import { useState } from 'react';
import { Search, Wifi, WifiOff, Activity, Globe } from 'lucide-react';

interface Node {
  peerId: string;
  domain?: string;
  status: 'online' | 'offline';
  latency: number;
  connections: number;
  bandwidth: string;
  location: string;
}

const mockNodes: Node[] = [
  {
    peerId: '12D3KooWJkGVkD8HgG7Jxn2Z4Qz',
    domain: 'node1.web3social.net',
    status: 'online',
    latency: 23,
    connections: 145,
    bandwidth: '2.3 MB/s',
    location: '新加坡',
  },
  {
    peerId: '12D3KooWRt5yJxK3Hg2Qp9L7Mx',
    domain: 'node2.web3social.net',
    status: 'online',
    latency: 56,
    connections: 89,
    bandwidth: '1.8 MB/s',
    location: '东京',
  },
  {
    peerId: '12D3KooWPq8Nm5Rt3Vx7Hy4Kz',
    status: 'offline',
    latency: 999,
    connections: 0,
    bandwidth: '0 MB/s',
    location: '首尔',
  },
  {
    peerId: '12D3KooWLm9Tx2Ky6Np8Qr5Js',
    domain: 'node4.web3social.net',
    status: 'online',
    latency: 78,
    connections: 234,
    bandwidth: '3.2 MB/s',
    location: '香港',
  },
  {
    peerId: '12D3KooWQp5Rx8Yz3Km7Nt9Lw',
    domain: 'node5.web3social.net',
    status: 'online',
    latency: 45,
    connections: 167,
    bandwidth: '2.7 MB/s',
    location: '台北',
  },
  {
    peerId: '12D3KooWXt6Ny9Rm4Qp2Lz8Kx',
    status: 'offline',
    latency: 999,
    connections: 0,
    bandwidth: '0 MB/s',
    location: '曼谷',
  },
];

export default function NodesPage() {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [nodes] = useState<Node[]>(mockNodes);

  const filteredNodes = nodes.filter(node => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      node.peerId.toLowerCase().includes(query) ||
      node.domain?.toLowerCase().includes(query) ||
      node.location.toLowerCase().includes(query)
    );
  });

  const onlineNodes = nodes.filter(n => n.status === 'online').length;
  const totalConnections = nodes.reduce((sum, n) => sum + n.connections, 0);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-end z-10">
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <Search size={22} />
        </button>
      </header>

      {/* Search Bar */}
      {showSearch && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <input
            type="text"
            placeholder="输入节点ID或域名搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-white border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
            autoFocus
          />
        </div>
      )}

      {/* Network Stats */}
      <div className="px-4 py-4 bg-gradient-to-r from-blue-50 to-purple-50 border-b border-gray-200">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{onlineNodes}</div>
            <div className="text-xs text-gray-600 mt-1">在线节点</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{totalConnections}</div>
            <div className="text-xs text-gray-600 mt-1">总连接数</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{nodes.length}</div>
            <div className="text-xs text-gray-600 mt-1">节点总数</div>
          </div>
        </div>
      </div>

      {/* Nodes List */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2">
          {filteredNodes.map((node) => (
            <div
              key={node.peerId}
              className="mb-3 p-4 bg-white border border-gray-200 rounded-xl hover:shadow-md transition-shadow"
            >
              {/* Node Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-full ${node.status === 'online' ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                    {node.status === 'online' ? (
                      <Wifi size={20} className="text-green-600" />
                    ) : (
                      <WifiOff size={20} className="text-gray-400" />
                    )}
                  </div>
                  <div>
                    <div className="font-mono text-sm font-medium text-gray-900">
                      {node.peerId}
                    </div>
                    {node.domain && (
                      <div className="flex items-center gap-1 text-xs text-gray-600 mt-1">
                        <Globe size={12} />
                        <span>{node.domain}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${node.status === 'online'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}>
                  {node.status === 'online' ? '在线' : '离线'}
                </div>
              </div>

              {/* Node Stats */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">延迟</div>
                  <div className={`text-sm font-medium ${node.latency < 50 ? 'text-green-600' :
                      node.latency < 100 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                    {node.status === 'online' ? `${node.latency}ms` : '--'}
                  </div>
                </div>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">连接</div>
                  <div className="text-sm font-medium text-gray-900">
                    {node.connections}
                  </div>
                </div>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">带宽</div>
                  <div className="text-sm font-medium text-gray-900">
                    {node.bandwidth}
                  </div>
                </div>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-600 mb-1">位置</div>
                  <div className="text-sm font-medium text-gray-900">
                    {node.location}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Empty State */}
      {filteredNodes.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <Activity size={48} className="mx-auto mb-3 opacity-50" />
            <p>未找到匹配的节点</p>
          </div>
        </div>
      )}
    </div>
  );
}
