import { lazy, Suspense, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Search, SlidersHorizontal, Clock, Flame, Menu, Settings, MapPin } from 'lucide-react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import VirtualizedMasonry from './VirtualizedMasonry';
import ContentCard from './ContentCard';
import ContentDetailPage from './ContentDetailPage';
import EcomFeedPage, { type EcomPaymentContext } from './EcomFeedPage';
import { parseProductsFromCsvString, type EcomProduct } from '../data/ecomData';
import { sortContentsByDistance } from '../utils/distanceSort';
import Sidebar from './Sidebar';
import ChannelManager from './ChannelManager';
import { publishTypes, type PublishType } from './PublishTypeSelector';
import { useLocale } from '../i18n/LocaleContext';
import { useHighAccuracyLocation, type CapturedLocation } from '../hooks/useHighAccuracyLocation';
import {
  getDistributedContents,
  resolveDistributedContentDetail,
  startDistributedContentSync,
  subscribeDistributedContents,
  type DistributedContent,
  type DistributedContentType,
} from '../data/distributedContent';
import { mockApps } from '../data/appList';

const BaziPage = lazy(() => import('./BaziPage'));
const ZiweiPage = lazy(() => import('./ZiweiPage'));

export type ContentType = DistributedContentType;
export type SortType = 'time' | 'hot' | 'distance';
export type PublishCategory = PublishType;
export type Content = DistributedContent;

// Tab配置 - 从publishTypes自动生成
const categoryTabs = publishTypes.map(({ type, labelKey, fallbackLabel, icon }) => ({
  key: type as PublishCategory,
  labelKey,
  fallbackLabel,
  icon,
}));

const masonryBreakpoints: Record<number, number> = {
  0: 2,
  520: 3,
  840: 4,
  1120: 5,
  1440: 6,
};


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

export default function HomePage({ onNavigate, onOpenApp }: { onNavigate?: (page: string) => void; onOpenApp?: (appId: string) => void }) {
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
  const [distributedContents, setDistributedContents] = useState<Content[]>(() => getDistributedContents());
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const resolvingDetailIdRef = useRef('');
  const [useVirtualized] = useState(true); // 虚拟化开关
  const [openAppId, setOpenAppId] = useState<string | null>(null);
  const { t } = useLocale();
  const { captureHighAccuracyLocation } = useHighAccuracyLocation();
  const [userLocation, setUserLocation] = useState<CapturedLocation | null>(null);

  const mergedContents = distributedContents;

  // Helper: get translated label for a tab
  const getTabLabel = useCallback((tab: typeof categoryTabs[0]) => t[tab.labelKey] || tab.fallbackLabel, [t]);

  // 缓存未读计数计算
  const unreadCountsMemo = useMemo(() => {
    const counts = publishTypes.reduce((acc, { type }) => {
      acc[type as PublishCategory] = 0;
      return acc;
    }, {} as Record<PublishCategory, number>);

    for (const content of mergedContents) {
      const lastVisit = getLastVisitTime(content.publishCategory);
      if (content.timestamp > lastVisit) {
        counts[content.publishCategory] = (counts[content.publishCategory] || 0) + 1;
      }
    }

    return counts;
  }, [mergedContents]);

  // 初始化未读计数和用户自定义顺序
  useEffect(() => {
    startDistributedContentSync();
    const unsubscribe = subscribeDistributedContents(setDistributedContents);
    const userOrder = getUserTabOrder();
    if (userOrder) {
      setTabOrder(userOrder);
      setUseSmartSort(false);
    }
    return () => {
      unsubscribe();
    };
  }, []);

  // 当未读计数变化时更新状态
  useEffect(() => {
    setUnreadCounts(unreadCountsMemo);
  }, [unreadCountsMemo]);

  // 缓存智能排序结果
  const sortedTabKeys = useMemo(() => {
    const tabs = categoryTabs.map(t => t.key);
    if (useSmartSort) {
      const unreadTabs = tabs.filter(t => (unreadCounts[t] || 0) > 0);
      const readTabs = tabs.filter(t => (unreadCounts[t] || 0) === 0);
      unreadTabs.sort((a, b) => (unreadCounts[b] || 0) - (unreadCounts[a] || 0));
      return [...unreadTabs, ...readTabs];
    }
    return tabOrder;
  }, [useSmartSort, unreadCounts, tabOrder]);

  // 切换分类时更新访问时间
  const handleCategoryChange = useCallback((category: PublishCategory) => {
    setActiveCategory(category);
    setLastVisitTime(category);
    setUnreadCounts(prev => ({ ...prev, [category]: 0 }));
  }, []);

  // 拖拽排序处理
  const handleDragStart = useCallback((category: PublishCategory) => {
    setDraggedTab(category);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetCategory: PublishCategory) => {
    e.preventDefault();
    if (draggedTab && draggedTab !== targetCategory) {
      setTabOrder(prev => {
        const newOrder = [...prev];
        const draggedIndex = newOrder.indexOf(draggedTab);
        const targetIndex = newOrder.indexOf(targetCategory);
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedTab);
        return newOrder;
      });
    }
  }, [draggedTab]);

  const handleDragEnd = useCallback(() => {
    if (draggedTab) {
      saveUserTabOrder(tabOrder);
      setUseSmartSort(false);
    }
    setDraggedTab(null);
  }, [draggedTab, tabOrder]);

  // 重置为智能排序
  const resetToSmartSort = useCallback(() => {
    localStorage.removeItem('userTabOrder');
    setTabOrder(categoryTabs.map(t => t.key));
    setUseSmartSort(true);
    setShowTabSettings(false);
  }, []);

  // 缓存过滤和排序结果
  const displayContents = useMemo(() => {
    // 过滤分类
    let filtered = mergedContents.filter(c => c.publishCategory === activeCategory);

    // 排序
    if (sortType === 'time') {
      filtered = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortType === 'distance') {
      if (userLocation) {
        filtered = sortContentsByDistance(
          filtered,
          {
            latitude: userLocation.coords.latitude,
            longitude: userLocation.coords.longitude,
          },
          true,
        );
      } else {
        const now = Date.now();
        filtered = [...filtered].sort((a, b) => {
          const scoreA = (a.likes + a.comments * 2) / Math.pow((now - a.timestamp) / (1000 * 60 * 60) + 1, 0.5);
          const scoreB = (b.likes + b.comments * 2) / Math.pow((now - b.timestamp) / (1000 * 60 * 60) + 1, 0.5);
          return scoreB - scoreA;
        });
      }
    } else {
      const now = Date.now();
      filtered = [...filtered].sort((a, b) => {
        const scoreA = (a.likes + a.comments * 2) / Math.pow((now - a.timestamp) / (1000 * 60 * 60) + 1, 0.5);
        const scoreB = (b.likes + b.comments * 2) / Math.pow((now - b.timestamp) / (1000 * 60 * 60) + 1, 0.5);
        return scoreB - scoreA;
      });
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(content =>
        content.content.toLowerCase().includes(query) && !content.isDuplicate
      );
    } else {
      filtered = filtered.filter(content => !content.isDuplicate);
    }

    return filtered;
  }, [mergedContents, activeCategory, sortType, searchQuery, userLocation]);

  const handleSelectDistanceSort = useCallback(() => {
    setShowSortMenu(false);
    void (async () => {
      try {
        const captured = await captureHighAccuracyLocation();
        setUserLocation(captured);
        setSortType('distance');
      } catch {
        setSortType('hot');
        if (typeof window !== 'undefined') {
          window.alert(t.home_distanceSortPermissionDeniedFallback);
        }
      }
    })();
  }, [captureHighAccuracyLocation, t]);

  // 缓存点击处理器
  const handleOpenContentDetail = useCallback((content: Content) => {
    // Determine if content is an App and can be launched
    if (content.publishCategory === 'app') {
      // Try to find app by packageName (which contains ID)
      if (content.extra?.appMeta?.packageName) {
        const appId = content.extra.appMeta.packageName.replace('.app', '');
        // Validate if this app exists in our registry
        const isValidApp = mockApps.some(app => app.id === appId);
        if (isValidApp && onOpenApp) {
          onOpenApp(appId);
          return;
        }
      }

      // Fallback: match by name
      if (content.extra?.appMeta?.appName) {
        const appName = content.extra.appMeta.appName;
        const matchedApp = mockApps.find(app => app.name === appName);
        if (matchedApp && onOpenApp) {
          onOpenApp(matchedApp.id);
          return;
        }
      }
    }

    setSelectedContent(content);
    if (resolvingDetailIdRef.current === content.id) {
      // ...
      return;
    }
    resolvingDetailIdRef.current = content.id;
    void (async () => {
      try {
        const resolved = await resolveDistributedContentDetail(content.id, content.userId);
        if (!resolved) {
          return;
        }
        setSelectedContent((current) => {
          if (!current || current.id !== content.id) {
            return current;
          }
          return resolved;
        });
      } finally {
        if (resolvingDetailIdRef.current === content.id) {
          resolvingDetailIdRef.current = '';
        }
      }
    })();
  }, []);

  return (
    <>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={onNavigate} onOpenApp={(appId) => setOpenAppId(appId)} />
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
          <div className="flex overflow-x-auto gap-2 scrollbar-hide items-center touch-pan-x overscroll-x-contain">
            {sortedTabKeys.map((key) => {
              const tab = categoryTabs.find(t => t.key === key);
              if (!tab) return null;
              const Icon = tab.icon;
              const count = unreadCounts[key] || 0;
              return (
                <button
                  key={key}
                  onClick={() => handleCategoryChange(key)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all flex-shrink-0 ${activeCategory === key
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
            {/* 频道管理按钮 */}
            <button
              onClick={() => setShowTabSettings(true)}
              className="flex-shrink-0 px-2 py-1.5 rounded-full text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors"
              title={t.channel_manage || "管理频道"}
            >
              <Settings size={18} />
            </button>
          </div>
        </div>

        <ChannelManager
          isOpen={showTabSettings}
          onClose={() => setShowTabSettings(false)}
          activeOrder={tabOrder}
          onOrderChange={(newOrder) => {
            setTabOrder(newOrder);
            saveUserTabOrder(newOrder);
            setUseSmartSort(false);
          }}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
        />

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
            <button
              onClick={() => {
                handleSelectDistanceSort();
              }}
              className={`flex items-center gap-1 px-4 py-2 rounded-full transition-colors ${sortType === 'distance' ? 'bg-purple-500 text-white' : 'bg-white text-gray-700 border border-gray-300'}`}
            >
              <MapPin size={16} /><span className="text-sm">{t.home_sortByDistance}</span>
            </button>
          </div>
        )}


        {/* Masonry Grid - 使用虚拟化或普通模式 */}
        <div className="flex-1 overflow-hidden px-2 py-3">
          {displayContents.length > 0 ? (
            useVirtualized ? (
              <VirtualizedMasonry
                items={displayContents}
                renderItem={(content) => (
                  <ContentCard content={content} onClick={handleOpenContentDetail} />
                )}
                itemKey={(content) => content.id}
                minColumnWidth={180}
                minColumns={2}
                maxColumns={6}
                gap={8}
                overscan={5}
                estimatedItemHeight={200}
              />
            ) : (
              <div className="h-full overflow-y-auto">
                <ResponsiveMasonry columnsCountBreakPoints={masonryBreakpoints}>
                  <Masonry gutter="8px">
                    {displayContents.map((content) => (
                      <ContentCard key={content.id} content={content} onClick={handleOpenContentDetail} />
                    ))}
                  </Masonry>
                </ResponsiveMasonry>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <p>{(() => { const tab = categoryTabs.find(ct => ct.key === activeCategory); return tab ? getTabLabel(tab) : ''; })()}</p>
            </div>
          )}
        </div>
      </div>

      {selectedContent && (() => {
        // Detect CSV data stored in extra.csvData → render ecom feed
        const csvData = typeof selectedContent.extra?.csvData === 'string'
          ? selectedContent.extra.csvData as string
          : undefined;
        const paymentContext: EcomPaymentContext = {
          sellerId: selectedContent.userId || selectedContent.userName,
          sellerName: selectedContent.userName,
          sourceContentId: selectedContent.id,
          extra: selectedContent.extra,
        };
        if (csvData) {
          try {
            const products: EcomProduct[] = parseProductsFromCsvString(csvData);
            if (products.length > 0) {
              return (
                <EcomFeedPage
                  onClose={() => setSelectedContent(null)}
                  externalProducts={products}
                  paymentContext={paymentContext}
                />
              );
            }
          } catch (err) {
            console.warn('Failed to parse CSV from content extra:', err);
          }
        }
        return (
          <ContentDetailPage
            content={selectedContent}
            onClose={() => setSelectedContent(null)}
          />
        );
      })()}

      {openAppId === 'bazi' && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-white flex items-center justify-center text-sm text-gray-500">加载八字盘面...</div>}>
          <BaziPage onClose={() => setOpenAppId(null)} />
        </Suspense>
      )}
      {openAppId === 'ziwei' && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-white flex items-center justify-center text-sm text-gray-500">加载紫微盘面...</div>}>
          <ZiweiPage onClose={() => setOpenAppId(null)} />
        </Suspense>
      )}
    </>
  );
}
