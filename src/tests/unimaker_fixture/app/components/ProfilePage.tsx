import { useState } from 'react';
import {
  ChevronRight,
  MapPin,
  Award,
  Globe,
  Wallet,
  FileText,
  ShoppingBag,
  Copy,
  Check
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { FortuneResultModal } from './FortuneResultModal';

interface Address {
  id: string;
  name: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
}

interface Transaction {
  id: string;
  type: 'send' | 'receive';
  amount: string;
  timestamp: number;
  status: 'completed' | 'pending';
}

const mockAddresses: Address[] = [
  {
    id: '1',
    name: '张三',
    phone: '138****8888',
    region: '中国 广东省 深圳市 南山区',
    detail: '科技园南区深南大道 10000号 XX大厦 1001室',
    isDefault: true,
  },
  {
    id: '2',
    name: 'John Doe',
    phone: '+1 555****1234',
    region: 'USA, California, San Francisco',
    detail: '123 Market Street, Suite 500',
    isDefault: false,
  },
];

const mockTransactions: Transaction[] = [
  {
    id: 'tx_001',
    type: 'receive',
    amount: '+50 RWAD',
    timestamp: Date.now() - 1000 * 60 * 30,
    status: 'completed',
  },
  {
    id: 'tx_002',
    type: 'send',
    amount: '-20 RWAD',
    timestamp: Date.now() - 1000 * 60 * 60,
    status: 'completed',
  },
  {
    id: 'tx_003',
    type: 'receive',
    amount: '+100 RWAD',
    timestamp: Date.now() - 1000 * 60 * 120,
    status: 'pending',
  },
];

export default function ProfilePage() {
  const [showAddresses, setShowAddresses] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [copiedPeerId, setCopiedPeerId] = useState(false);
  const [showBirthInput, setShowBirthInput] = useState(false);
  const [showFortuneResult, setShowFortuneResult] = useState(false);
  const [birthData, setBirthData] = useState({
    year: 1990,
    month: 1,
    day: 1,
    hour: 12,
    gender: 'male' as 'male' | 'female'
  });

  const peerId = '12D3KooWJkGVkD8HgG7Jxn2Z4QzMxRt5yJxK3Hg2Qp9L7';
  const rwadPoints = 2580;
  const domain = 'mynode.web3social.net';

  const handleCopyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    setCopiedPeerId(true);
    setTimeout(() => setCopiedPeerId(false), 2000);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-end z-10">
        <button
          onClick={() => setShowAddresses(!showAddresses)}
          className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <MapPin size={16} />
          <span>地址管理</span>
        </button>
      </header>

      {/* Profile Section */}
      <div className="bg-white px-4 py-6 mb-4">
        <div className="flex items-center gap-4 mb-6">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1617409122337-594499222247?w=100"
            alt="Profile"
            className="w-20 h-20 rounded-full object-cover"
          />
          <div>
            <h2 className="text-lg font-semibold mb-1">我的节点</h2>
            <p className="text-sm text-gray-600">去中心化社区成员</p>
          </div>
        </div>

        {/* Node Info */}
        <div className="space-y-3">
          {/* PeerId */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-600">节点 PeerId</span>
              <button
                onClick={handleCopyPeerId}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                {copiedPeerId ? (
                  <>
                    <Check size={12} />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    <span>复制</span>
                  </>
                )}
              </button>
            </div>
            <p className="font-mono text-xs text-gray-900 break-all">{peerId}</p>
          </div>

          {/* RWAD Points */}
          <div className="p-3 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="text-yellow-600" size={20} />
                <span className="text-sm text-gray-700">RWAD 积分</span>
              </div>
              <span className="text-lg font-bold text-yellow-600">{rwadPoints.toLocaleString()}</span>
            </div>
          </div>

          {/* Domain */}
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2">
              <Globe className="text-blue-600" size={20} />
              <div className="flex-1">
                <div className="text-xs text-gray-600 mb-1">绑定域名</div>
                <p className="text-sm font-medium text-gray-900">{domain}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Menu Items */}
      <div className="bg-white mb-4">
        <button
          onClick={() => setShowWallet(!showWallet)}
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
              <Wallet className="text-purple-600" size={20} />
            </div>
            <div className="text-left">
              <div className="font-medium">Web3 钱包</div>
              <div className="text-xs text-gray-600">导入助记词或私钥</div>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </button>

        <button
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <FileText className="text-green-600" size={20} />
            </div>
            <div className="text-left">
              <div className="font-medium">我发布的内容</div>
              <div className="text-xs text-gray-600">查看所有发布内容</div>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </button>

        <button
          onClick={() => setShowTransactions(!showTransactions)}
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <ShoppingBag className="text-blue-600" size={20} />
            </div>
            <div className="text-left">
              <div className="font-medium">最近交易</div>
              <div className="text-xs text-gray-600">RWAD积分交易记录</div>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </button>

        {/* BaZi Entry */}
        <button
          onClick={() => setShowBirthInput(true)}
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <span className="text-xl">☯️</span>
            </div>
            <div className="text-left">
              <div className="font-medium">我的八字</div>
              <div className="text-xs text-gray-600">五行命理分析</div>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </button>

        {/* Ziwei Entry */}
        <button
          onClick={() => setShowBirthInput(true)}
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center">
              <span className="text-xl">⭐</span>
            </div>
            <div className="text-left">
              <div className="font-medium">紫微命盘</div>
              <div className="text-xs text-gray-600">紫微斗数分析</div>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </button>
      </div>

      {/* Address Management Modal */}
      {showAddresses && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
          <div className="bg-white w-full max-h-[80vh] rounded-t-2xl overflow-hidden">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
              <h3 className="font-semibold">收货地址管理</h3>
              <button
                onClick={() => setShowAddresses(false)}
                className="text-gray-600 hover:text-gray-900"
              >
                关闭
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {mockAddresses.map((address) => (
                <div key={address.id} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="font-medium">{address.name}</span>
                      <span className="ml-3 text-gray-600">{address.phone}</span>
                    </div>
                    {address.isDefault && (
                      <span className="px-2 py-1 bg-red-500 text-white text-xs rounded">
                        默认
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{address.region}</p>
                  <p className="text-sm text-gray-600 mt-1">{address.detail}</p>
                </div>
              ))}
              <button className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-500 transition-colors">
                + 添加新地址
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Modal */}
      {showWallet && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
          <div className="bg-white w-full max-h-[80vh] rounded-t-2xl overflow-hidden">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
              <h3 className="font-semibold">Web3 钱包</h3>
              <button
                onClick={() => setShowWallet(false)}
                className="text-gray-600 hover:text-gray-900"
              >
                关闭
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  ⚠️ 钱包托管功能仅供演示。生产环境中请使用硬件钱包或专业的密钥管理方案。
                </p>
              </div>
              <button className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                导入助记词
              </button>
              <button className="w-full py-3 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors">
                导入私钥
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions Modal */}
      {showTransactions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
          <div className="bg-white w-full max-h-[80vh] rounded-t-2xl overflow-hidden">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
              <h3 className="font-semibold">最近交易</h3>
              <button
                onClick={() => setShowTransactions(false)}
                className="text-gray-600 hover:text-gray-900"
              >
                关闭
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {mockTransactions.map((tx) => (
                <div key={tx.id} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-medium ${tx.type === 'receive' ? 'text-green-600' : 'text-red-600'
                      }`}>
                      {tx.amount}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${tx.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                      }`}>
                      {tx.status === 'completed' ? '已完成' : '待确认'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span className="font-mono">{tx.id}</span>
                    <span>{formatTime(tx.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Birth Date Input Modal */}
      {showBirthInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-4 text-white">
              <h3 className="font-semibold text-lg">输入出生信息</h3>
              <p className="text-sm opacity-90">首次分析免费</p>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 block mb-1">年</label>
                  <select
                    value={birthData.year}
                    onChange={(e) => setBirthData({ ...birthData, year: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {Array.from({ length: 80 }, (_, i) => 2010 - i).map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 block mb-1">月</label>
                  <select
                    value={birthData.month}
                    onChange={(e) => setBirthData({ ...birthData, month: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                      <option key={month} value={month}>{month}月</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 block mb-1">日</label>
                  <select
                    value={birthData.day}
                    onChange={(e) => setBirthData({ ...birthData, day: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day}日</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 block mb-1">时</label>
                  <select
                    value={birthData.hour}
                    onChange={(e) => setBirthData({ ...birthData, hour: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {Array.from({ length: 24 }, (_, i) => i).map(hour => (
                      <option key={hour} value={hour}>{hour}:00</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-2">性别</label>
                <div className="flex gap-4">
                  <button
                    onClick={() => setBirthData({ ...birthData, gender: 'male' })}
                    className={`flex-1 py-2 rounded-lg border ${birthData.gender === 'male'
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'border-gray-200 text-gray-700'
                      }`}
                  >
                    男
                  </button>
                  <button
                    onClick={() => setBirthData({ ...birthData, gender: 'female' })}
                    className={`flex-1 py-2 rounded-lg border ${birthData.gender === 'female'
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'border-gray-200 text-gray-700'
                      }`}
                  >
                    女
                  </button>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowBirthInput(false)}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowBirthInput(false);
                    setShowFortuneResult(true);
                  }}
                  className="flex-1 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg"
                >
                  免费算命
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fortune Result Modal */}
      {showFortuneResult && (
        <FortuneResultModal
          birthData={birthData}
          onClose={() => setShowFortuneResult(false)}
        />
      )}
    </div>
  );
}
