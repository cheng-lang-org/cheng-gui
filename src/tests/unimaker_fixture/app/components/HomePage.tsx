import { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, Clock, Flame, Menu } from 'lucide-react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import ContentCard from './ContentCard';
import Sidebar from './Sidebar';
import { publishTypes, type PublishType } from './PublishTypeSelector';
import { useLocale } from '../i18n/LocaleContext';

export type ContentType = 'text' | 'image' | 'audio' | 'video';
export type SortType = 'time' | 'hot';
export type PublishCategory = PublishType;

export interface Content {
  id: string;
  type: ContentType;
  publishCategory: PublishCategory;
  userId: string;
  userName: string;
  avatar: string;
  content: string;
  media?: string;
  likes: number;
  comments: number;
  timestamp: number;
  isDuplicate?: boolean;
  location?: {
    country: string;
    province: string;
    city: string;
    district?: string;
  };
}

// Tab配置 - 从publishTypes自动生成
const categoryTabs = publishTypes.map(({ type, labelKey, fallbackLabel, icon }) => ({
  key: type as PublishCategory,
  labelKey,
  fallbackLabel,
  icon,
}));

// Mock数据 - 添加publishCategory
const mockContents: Content[] = [
  {
    id: '1', type: 'image', publishCategory: 'content',
    userId: 'peer_001', userName: '小红分享',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '今天的日落太美了！✨ #风景 #日落',
    media: 'https://images.unsplash.com/photo-1617634667039-8e4cb277ab46?w=400',
    likes: 1523, comments: 89, timestamp: Date.now() - 1000 * 60 * 30,
  },
  {
    id: '2', type: 'text', publishCategory: 'content',
    userId: 'peer_002', userName: '科技探索者',
    avatar: 'https://images.unsplash.com/photo-1628130235364-9e412ffaae5a?w=100',
    content: '分享一下我对Web3和去中心化社交网络的看法。libp2p真的是一个很棒的协议。',
    likes: 856, comments: 124, timestamp: Date.now() - 1000 * 60 * 45,
  },
  {
    id: '3', type: 'image', publishCategory: 'food',
    userId: 'peer_003', userName: '美食记录',
    avatar: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=100',
    content: '今日午餐 🍜 超级好吃的拉面！下单即送饮料',
    media: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
    likes: 2341, comments: 156, timestamp: Date.now() - 1000 * 60 * 10,
  },
  {
    id: '4', type: 'video', publishCategory: 'live',
    userId: 'peer_004', userName: '旅行日记',
    avatar: 'https://images.unsplash.com/photo-1614088459293-5669fadc3448?w=100',
    content: '🔴 正在直播：巴厘岛海滩实况 #旅行 #度假',
    media: 'https://images.unsplash.com/photo-1614088459293-5669fadc3448?w=400',
    likes: 3456, comments: 234, timestamp: Date.now() - 1000 * 60 * 5,
  },
  {
    id: '5', type: 'image', publishCategory: 'product',
    userId: 'peer_005', userName: '潮流店铺',
    avatar: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=100',
    content: '新款限量运动鞋发售 🔥 ¥899',
    media: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400',
    likes: 678, comments: 45, timestamp: Date.now() - 1000 * 60 * 20,
  },
  {
    id: '6', type: 'text', publishCategory: 'ride',
    userId: 'peer_006', userName: '每日通勤',
    avatar: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=100',
    content: '🚗 明早8点 北京朝阳→海淀 有2空位 费用分摊30/人',
    likes: 45, comments: 12, timestamp: Date.now() - 1000 * 60 * 15,
  },
  {
    id: '7', type: 'text', publishCategory: 'job',
    userId: 'peer_007', userName: '前端开发',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '💼 5年前端经验求职 熟悉React/Vue/TS 期望25-30K 北京',
    likes: 89, comments: 23, timestamp: Date.now() - 1000 * 60 * 8,
  },
  {
    id: '8', type: 'text', publishCategory: 'hire',
    userId: 'peer_008', userName: '字节跳动HR',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '🔥 字节跳动招聘高级前端工程师 35-60K 五险一金+股票期权',
    likes: 567, comments: 89, timestamp: Date.now() - 1000 * 60 * 25,
  },
  {
    id: '9', type: 'image', publishCategory: 'rent',
    userId: 'peer_009', userName: '房东直租',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '🏠 朝阳区精装两居 4500/月 近地铁 随时看房',
    media: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400',
    likes: 234, comments: 45, timestamp: Date.now() - 1000 * 60 * 35,
  },
  {
    id: '10', type: 'image', publishCategory: 'secondhand',
    userId: 'peer_010', userName: '学生党',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '♻️ iPhone 14 Pro 9成新 原价8999 现价5500 可小刀',
    media: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=400',
    likes: 345, comments: 67, timestamp: Date.now() - 1000 * 60 * 12,
  },
  {
    id: '11', type: 'image', publishCategory: 'app',
    userId: 'peer_011', userName: '独立开发者',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '📱 发布了新应用：效率工具Pro 可离线使用',
    media: 'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=400',
    likes: 123, comments: 34, timestamp: Date.now() - 1000 * 60 * 40,
  },
  {
    id: '12', type: 'text', publishCategory: 'sell',
    userId: 'peer_012', userName: '车主急售',
    avatar: 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100',
    content: '🚙 2022款特斯拉Model 3 里程2万 急售28万 可议价',
    likes: 456, comments: 78, timestamp: Date.now() - 1000 * 60 * 50,
  },
];

// 从localStorage获取上次访问时间（默认返回1小时前，以便演示角标）
const getLastVisitTime = (category: PublishCategory): number => {
  const stored = localStorage.getItem(`lastVisit_${category}`);
  return stored ? parseInt(stored) : Date.now() - 1000 * 60 * 60;
};

// 保存访问时间
const setLastVisitTime = (category: PublishCategory) => {
  localStorage.setItem(`lastVisit_${category}`, Date.now().toString());
};

// 获取用户自定义的tab顺序
const getUserTabOrder = (): PublishCategory[] | null => {
  const stored = localStorage.getItem('userTabOrder');
  return stored ? JSON.parse(stored) : null;
};

// 保存用户自定义的tab顺序
const saveUserTabOrder = (order: PublishCategory[]) => {
  localStorage.setItem('userTabOrder', JSON.stringify(order));
};

export default function HomePage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortType, setSortType] = useState<SortType>('hot');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PublishCategory>('content');
  const [unreadCounts, setUnreadCounts] = useState<Record<PublishCategory, number>>({} as Record<PublishCategory, number>);
  const [tabOrder, setTabOrder] = useState<PublishCategory[]>(categoryTabs.map(t => t.key));
  const [useSmartSort, setUseSmartSort] = useState(true); // 智能排序开关
  const [showTabSettings, setShowTabSettings] = useState(false);
  const [draggedTab, setDraggedTab] = useState<PublishCategory | null>(null);
  const { t } = useLocale();

  // Helper: get translated label for a tab
  const getTabLabel = (tab: typeof categoryTabs[0]) => t[tab.labelKey] || tab.fallbackLabel;

  // 模拟的未读数量（动态生成，适配所有发布类型）
  const mockUnreadCounts = publishTypes.reduce((acc, { type }, index) => {
    // 模拟随机未读数，基于索引生成
    acc[type as PublishCategory] = index % 3 === 0 ? 0 : (index % 5) + 1;
    return acc;
  }, {} as Record<PublishCategory, number>);

  // 初始化未读计数和用户自定义顺序
  useEffect(() => {
    setUnreadCounts(mockUnreadCounts);
    const userOrder = getUserTabOrder();
    if (userOrder) {
      setTabOrder(userOrder);
      setUseSmartSort(false);
    }
  }, []);

  // 智能排序：有未读的在前（按未读数排序），已读的在后
  const getSortedTabs = () => {
    const tabs = categoryTabs.map(t => t.key);
    if (useSmartSort) {
      // 分成两组：有未读的 和 已读的
      const unreadTabs = tabs.filter(t => (unreadCounts[t] || 0) > 0);
      const readTabs = tabs.filter(t => (unreadCounts[t] || 0) === 0);
      // 有未读的按数量从高到低排序
      unreadTabs.sort((a, b) => (unreadCounts[b] || 0) - (unreadCounts[a] || 0));
      // 已读的保持原始顺序
      return [...unreadTabs, ...readTabs];
    }
    return tabOrder;
  };

  const sortedTabKeys = getSortedTabs();

  // 切换分类时更新访问时间
  const handleCategoryChange = (category: PublishCategory) => {
    setActiveCategory(category);
    setLastVisitTime(category);
    setUnreadCounts(prev => ({ ...prev, [category]: 0 }));
  };

  // 拖拽排序处理
  const handleDragStart = (category: PublishCategory) => {
    setDraggedTab(category);
  };

  const handleDragOver = (e: React.DragEvent, targetCategory: PublishCategory) => {
    e.preventDefault();
    if (draggedTab && draggedTab !== targetCategory) {
      const newOrder = [...tabOrder];
      const draggedIndex = newOrder.indexOf(draggedTab);
      const targetIndex = newOrder.indexOf(targetCategory);
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedTab);
      setTabOrder(newOrder);
    }
  };

  const handleDragEnd = () => {
    if (draggedTab) {
      saveUserTabOrder(tabOrder);
      setUseSmartSort(false);
    }
    setDraggedTab(null);
  };

  // 重置为智能排序
  const resetToSmartSort = () => {
    localStorage.removeItem('userTabOrder');
    setTabOrder(categoryTabs.map(t => t.key));
    setUseSmartSort(true);
    setShowTabSettings(false);
  };

  // 过滤内容
  const filteredByCategory = mockContents.filter(c => c.publishCategory === activeCategory);

  // 排序内容
  const sortedContents = [...filteredByCategory].sort((a, b) => {
    if (sortType === 'time') {
      return b.timestamp - a.timestamp;
    } else {
      const scoreA = (a.likes + a.comments * 2) / Math.pow((Date.now() - a.timestamp) / (1000 * 60 * 60) + 1, 0.5);
      const scoreB = (b.likes + b.comments * 2) / Math.pow((Date.now() - b.timestamp) / (1000 * 60 * 60) + 1, 0.5);
      return scoreB - scoreA;
    }
  });

  // 搜索过滤
  const displayContents = sortedContents.filter(content => {
    if (searchQuery && !content.content.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return !content.isDuplicate;
  });

  return (
    <>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={onNavigate} />
      <div className="h-full flex flex-col bg-white">
        {/* Header */}
        <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors" aria-label="展开侧边栏">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSearch(!showSearch)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <Search size={22} />
            </button>
            <button onClick={() => setShowSortMenu(!showSortMenu)} className="p-2 hover:bg-gray-100 rounded-full transition-colors relative">
              <SlidersHorizontal size={22} />
            </button>
          </div>
        </header>

        {/* Category Tabs */}
        <div className="bg-gray-50 border-b border-gray-200 px-2 py-2">
          <div className="flex overflow-x-auto gap-2 scrollbar-hide items-center">
            {sortedTabKeys.map((key) => {
              const tab = categoryTabs.find(t => t.key === key);
              if (!tab) return null;
              const Icon = tab.icon;
              const count = unreadCounts[key] || 0;
              return (
                <button
                  key={key}
                  draggable
                  onDragStart={() => handleDragStart(key)}
                  onDragOver={(e) => handleDragOver(e, key)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleCategoryChange(key)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all flex-shrink-0 cursor-grab active:cursor-grabbing ${draggedTab === key ? 'opacity-50 scale-95' : ''
                    } ${activeCategory === key
                      ? 'bg-purple-500 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                >
                  <Icon size={14} />
                  <span>{getTabLabel(tab)}</span>
                  {count > 0 && (
                    <span className={`ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full ${activeCategory === key ? 'bg-white text-purple-500' : 'bg-red-500 text-white'
                      }`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
            {/* 重置按钮 - 始终显示 */}
            <button
              onClick={resetToSmartSort}
              className={`flex-shrink-0 px-2 py-1.5 rounded-full transition-colors ${useSmartSort
                ? 'text-purple-500 bg-purple-50'
                : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'
                }`}
              title={useSmartSort ? t.home_smartSort : t.home_customSort}
            >
              ↻
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {showSearch && (
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <input
              type="text"
              placeholder={t.home_search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
              autoFocus
            />
          </div>
        )}

        {/* Sort Menu */}
        {showSortMenu && (
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex gap-2">
            <button
              onClick={() => { setSortType('hot'); setShowSortMenu(false); }}
              className={`flex items-center gap-1 px-4 py-2 rounded-full transition-colors ${sortType === 'hot' ? 'bg-purple-500 text-white' : 'bg-white text-gray-700 border border-gray-300'}`}
            >
              <Flame size={16} /><span className="text-sm">{t.home_sortByHot}</span>
            </button>
            <button
              onClick={() => { setSortType('time'); setShowSortMenu(false); }}
              className={`flex items-center gap-1 px-4 py-2 rounded-full transition-colors ${sortType === 'time' ? 'bg-purple-500 text-white' : 'bg-white text-gray-700 border border-gray-300'}`}
            >
              <Clock size={16} /><span className="text-sm">{t.home_sortByTime}</span>
            </button>
          </div>
        )}


        {/* Masonry Grid */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {displayContents.length > 0 ? (
            <ResponsiveMasonry columnsCountBreakPoints={{ 350: 2, 900: 3, 1200: 4 }}>
              <Masonry gutter="12px">
                {displayContents.map((content) => (
                  <ContentCard key={content.id} content={content} />
                ))}
              </Masonry>
            </ResponsiveMasonry>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <p>{(() => { const tab = categoryTabs.find(ct => ct.key === activeCategory); return tab ? getTabLabel(tab) : ''; })()}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}