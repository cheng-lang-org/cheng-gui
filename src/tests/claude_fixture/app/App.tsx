import { useState, useEffect, lazy, Suspense } from 'react';
import { Home, MessageCircle, Server, User, Plus } from 'lucide-react';
import HomePage from './components/HomePage';
import MessagesPage from './components/MessagesPage';
import NodesPage from './components/NodesPage';
import ProfilePage from './components/ProfilePage';
import PublishTypeSelector, { type PublishType } from './components/PublishTypeSelector';
import PublishContentPage from './components/PublishContentPage';
import PublishProductPage from './components/PublishProductPage';
import LiveStreamPage from './components/LiveStreamPage';
import PublishAppPage from './components/PublishAppPage';
import PublishFoodPage from './components/PublishFoodPage';
import PublishRidePage from './components/PublishRidePage';
import PublishJobPage from './components/PublishJobPage';
import PublishHirePage from './components/PublishHirePage';
import PublishRentPage from './components/PublishRentPage';
import PublishSellPage from './components/PublishSellPage';
import PublishSecondhandPage from './components/PublishSecondhandPage';
import PublishCrowdfundingPage from './components/PublishCrowdfundingPage';
import LanguageSelector from './components/LanguageSelector';
import TradingPage from './components/TradingPage';
import EcomFeedPage from './components/EcomFeedPage';
import AppMarketplace from './components/AppMarketplace';
import UpdateCenterPage from './components/UpdateCenterPage';
import { LocaleProvider, useLocale } from './i18n/LocaleContext';
import { libp2pService } from './libp2p/service';
import { libp2pEventPump } from './libp2p/eventPump';
import { startInboundHandler, stopInboundHandler } from './libp2p/inboundHandler';
import { socialStore } from './libp2p/socialStore';
import { startC2CSync, stopC2CSync } from './domain/c2c/c2cSync';
import { startDexSync, stopDexSync } from './domain/dex/dexSync';
import {
  ackUpdatePrompt,
  compareVersionVector,
  getUpdateSnapshot,
  manualCheckForUpdates,
  startUpdateSync,
  stopUpdateSync,
  subscribeUpdateSnapshot,
  type UpdateSnapshot,
} from './domain/update';
import { startDistributedContentSync, stopDistributedContentSync } from './data/distributedContent';
import { purgeMockConversations } from './data/socialData';
import { getFeatureFlag } from './utils/featureFlags';
import { ensureRegionPolicy } from './utils/region';
import {
  migrateLegacyPaymentFieldsInLocalFeed,
  queryOrderFromReturnUrl,
  registerPaymentReturnListener,
} from './domain/payment/paymentApi';

const BaziPage = lazy(() => import('./components/BaziPage'));
const ZiweiPage = lazy(() => import('./components/ZiweiPage'));
const DouDiZhuPage = lazy(() => import('./components/DouDiZhuPage'));
const ChessPage = lazy(() => import('./components/ChessPage'));
const MahjongPage = lazy(() => import('./components/MahjongPage'));
const WerewolfPage = lazy(() => import('./components/WerewolfPage'));
const MinecraftPage = lazy(() => import('./components/MinecraftPage'));

type TabType = 'home' | 'messages' | 'nodes' | 'profile';
type PublishMode = 'none' | 'select' | PublishType;

function AppContent() {
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [publishMode, setPublishMode] = useState<PublishMode>('none');
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [showTrading, setShowTrading] = useState(false);
  const [showEcom, setShowEcom] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showUpdateCenter, setShowUpdateCenter] = useState(false);
  const [updateSnapshot, setUpdateSnapshot] = useState<UpdateSnapshot>(() => getUpdateSnapshot());
  const [currentApp, setCurrentApp] = useState<{ id: string; roomId?: string } | null>(null);
  const { setLocale, t } = useLocale();
  const enableC2CV2 = getFeatureFlag('c2c_rwads_v2', false);

  // 检查是否首次启动
  useEffect(() => {
    purgeMockConversations();
    const languageSet = localStorage.getItem('app_language_set');
    if (!languageSet) {
      setShowLanguageSelector(true);
    }
  }, []);

  useEffect(() => {
    return subscribeUpdateSnapshot((next) => {
      setUpdateSnapshot(next);
    });
  }, []);

  useEffect(() => {
    void ensureRegionPolicy();
    void migrateLegacyPaymentFieldsInLocalFeed();
    const unsubscribe = registerPaymentReturnListener((url) => {
      void queryOrderFromReturnUrl(url);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let mdnsTimer: ReturnType<typeof setInterval> | null = null;
    let bootstrapTimer: ReturnType<typeof setInterval> | null = null;
    let peerIdSyncTimer: ReturnType<typeof setInterval> | null = null;
    const runMdnsMaintenance = () => {
      void libp2pService.mdnsSetEnabled(true);
      void libp2pService.mdnsSetInterval(2);
      void libp2pService.mdnsProbe();
      void libp2pService.boostConnectivity().catch(() => false);
    };
    const runBootstrapMaintenance = () => {
      void libp2pService.bootstrapTick().catch(() => ({}));
    };

    const setup = async () => {
      if (!libp2pService.isNativePlatform()) {
        startDistributedContentSync();
        void startUpdateSync();
        return;
      }
      const syncLocalPeerId = async () => {
        const seeded = (await libp2pService.ensurePeerIdentity().catch(() => '')).trim();
        if (seeded) {
          localStorage.setItem('profile_local_peer_id_v1', seeded);
        }
        const direct = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
        if (direct) {
          localStorage.setItem('profile_local_peer_id_v1', direct);
          return;
        }
        const health = await libp2pService.runtimeHealth().catch(() => ({
          nativeReady: false,
          started: false,
          peerId: '',
          lastError: '',
        }));
        const peerId = (health.peerId ?? '').trim();
        if (peerId) {
          localStorage.setItem('profile_local_peer_id_v1', peerId);
        }
      };

      const runtimeRecoveryTick = async () => {
        await libp2pService.ensureStarted().catch(() => false);
        await syncLocalPeerId();
      };

      await syncLocalPeerId();

      let startedOk = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (disposed) {
          return;
        }
        startedOk = await libp2pService.ensureStarted().catch(() => false);
        if (startedOk) {
          break;
        }
        await new Promise((resolve) => {
          window.setTimeout(resolve, 800);
        });
      }
      if (!startedOk || disposed) {
        await syncLocalPeerId();
        peerIdSyncTimer = setInterval(() => {
          void runtimeRecoveryTick();
        }, 5000);
        return;
      }

      libp2pEventPump.start();
      await syncLocalPeerId();
      await libp2pService.bootstrapSetPolicy({
        topic: '/unimaker/bootstrap/v1',
        tick_seconds: 15,
        random_n: 7,
        parallel_dials: 3,
        candidate_ttl_ms: 180000,
        publish_peer_cap: 16,
        publish_chance_percent: 100,
        publish_min_interval_ms: 5000,
        publish_suppression_ms: 15000,
        require_trusted_publisher: false,
      }).catch(() => false);
      peerIdSyncTimer = setInterval(() => {
        void runtimeRecoveryTick();
      }, 5000);

      // Refresh social snapshot from native bridge
      await socialStore.refreshFromBridge();

      // Start distributed content sync
      await startDistributedContentSync();
      // Start Update Sync
      startUpdateSync();
      // Start C2C Sync
      await startC2CSync();
      // Start DEX Sync
      await startDexSync();

      // Start inbound handler
      await startInboundHandler();
      // Delay the first probe slightly to avoid startup-time native contention.
      window.setTimeout(() => {
        if (!disposed) {
          runMdnsMaintenance();
          runBootstrapMaintenance();
        }
      }, 2000);
      // mDNS probe loop: every 2s.
      mdnsTimer = setInterval(() => {
        runMdnsMaintenance();
      }, 2_000);
      // Bootstrap maintenance stays coarse-grained to avoid unnecessary fanout.
      bootstrapTimer = setInterval(() => {
        runBootstrapMaintenance();
      }, 15_000);
    };

    void setup();

    return () => {
      disposed = true;
      stopDistributedContentSync();
      stopUpdateSync();
      stopC2CSync();
      stopDexSync();
      stopInboundHandler();
      libp2pEventPump.stop();
      if (mdnsTimer) {
        clearInterval(mdnsTimer);
        mdnsTimer = null;
      }
      if (bootstrapTimer) {
        clearInterval(bootstrapTimer);
        bootstrapTimer = null;
      }
      if (peerIdSyncTimer) {
        clearInterval(peerIdSyncTimer);
        peerIdSyncTimer = null;
      }
      void libp2pService.stop();
    };
  }, []);

  const handleLanguageSelect = (selectedLocale: string) => {
    setLocale(selectedLocale);
    setShowLanguageSelector(false);
  };

  // 显示语言选择器（首次启动）
  if (showLanguageSelector) {
    return <LanguageSelector onSelect={handleLanguageSelect} />;
  }

  const handleClosePublish = () => {
    setPublishMode('none');
  };

  const handleSelectPublishType = (type: PublishType) => {
    setPublishMode(type);
  };

  // 全屏发布页面渲染
  const renderPublishPage = () => {
    switch (publishMode) {
      case 'content':
      case 'text':
      case 'image':
      case 'video':
      case 'article':
        return <PublishContentPage initialType={publishMode} onClose={handleClosePublish} />;
      case 'product':
        return <PublishProductPage onClose={handleClosePublish} />;
      case 'live':
      case 'livestream':
        return <LiveStreamPage onClose={handleClosePublish} />;
      case 'app':
        return <PublishAppPage onClose={handleClosePublish} />;
      case 'food':
        return <PublishFoodPage onClose={handleClosePublish} />;
      case 'ride':
        return <PublishRidePage onClose={handleClosePublish} />;
      case 'job':
        return <PublishJobPage onClose={handleClosePublish} />;
      case 'hire':
        return <PublishHirePage onClose={handleClosePublish} />;
      case 'rent':
        return <PublishRentPage onClose={handleClosePublish} />;
      case 'sell':
        return <PublishSellPage onClose={handleClosePublish} />;
      case 'secondhand':
        return <PublishSecondhandPage onClose={handleClosePublish} />;
      case 'crowdfunding':
        return <PublishCrowdfundingPage onClose={handleClosePublish} />;
      default:
        return null;
    }
  };

  const canShowUpdateBanner =
    !showUpdateCenter &&
    updateSnapshot.show_update_prompt &&
    updateSnapshot.latest_manifest_verified &&
    Boolean(updateSnapshot.latest_version) &&
    compareVersionVector(
      {
        version: updateSnapshot.latest_version,
        versionCode: updateSnapshot.latest_version_code,
        sequence: updateSnapshot.latest_manifest_verified_sequence,
      },
      {
        version: updateSnapshot.current_version,
        versionCode: updateSnapshot.current_version_code,
        sequence: Math.max(0, updateSnapshot.sequence - 1),
      },
    ) > 0 &&
    updateSnapshot.state !== 'REVOKED';

  const dismissUpdateBanner = () => {
    ackUpdatePrompt(
      updateSnapshot.channel,
      updateSnapshot.platform,
      updateSnapshot.sequence,
      updateSnapshot.latest_version_code,
    );
  };

  const openUpdateDetails = () => {
    dismissUpdateBanner();
    setShowUpdateCenter(true);
  };

  const renderUpdateBanner = () => {
    if (!canShowUpdateBanner) {
      return null;
    }
    return (
      <div className="sticky top-0 z-20 border-b border-blue-200 bg-blue-50 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-blue-900">
              {t.update_banner_title || '发现新版本'}
            </div>
            <div className="truncate text-xs text-blue-700">
              {(t.update_banner_message || '发现最新版本，正在后台自动更新')} v{updateSnapshot.latest_version}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={openUpdateDetails}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white"
            >
              {t.update_banner_details || '更新详情'}
            </button>
            <button
              onClick={dismissUpdateBanner}
              className="rounded-md border border-blue-300 px-2.5 py-1 text-xs text-blue-800"
            >
              {t.update_banner_ack || '知道了'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    const handleHomeNavigate = (page: string) => {
      if (page === 'nodes') {
        setCurrentTab('nodes');
        return;
      }
      if (page === 'trading') {
        setShowTrading(true);
        return;
      }
      if (page === 'marketplace') {
        setShowMarketplace(true);
        return;
      }
      if (page === 'updates') {
        setShowUpdateCenter(true);
        void manualCheckForUpdates().catch(() => {
          // Update center will render current failure reason from snapshot.
        });
      }
    };

    // If an app is open, we render it ON TOP of everything (handled in main return via conditional)
    // But here we handle Tab rendering
    switch (currentTab) {
      case 'home':
        return (
          <HomePage
            onNavigate={handleHomeNavigate}
            onOpenApp={(appId) => setCurrentApp({ id: appId })}
          />
        );
      case 'messages':
        return <MessagesPage onOpenApp={(appId, roomId) => setCurrentApp({ id: appId, roomId })} />;
      case 'nodes':
        return <NodesPage />;
      case 'profile':
        return (
          <ProfilePage
            onOpenBazi={() => setCurrentApp({ id: 'bazi' })}
            onOpenEcom={() => setShowEcom(true)}
            onOpenMarketplace={() => setShowMarketplace(true)}
            onOpenApp={(appId) => setCurrentApp({ id: appId })}
            onOpenZiwei={() => setCurrentApp({ id: 'ziwei' })}
            onOpenUpdateCenter={() => setShowUpdateCenter(true)}
          />
        );
      default:
        return <HomePage onNavigate={handleHomeNavigate} onOpenApp={(appId, roomId) => setCurrentApp({ id: appId, roomId })} />;
    }
  };

  // Handling overlays (Apps, UpdateCenter, etc.)
  // Note: App overlays are rendered conditionally at the top level return to take full screen
  if (currentApp?.id === 'bazi') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-stone-900 flex items-center justify-center text-sm text-stone-300">加载八字排盘...</div>}>
        <BaziPage onClose={() => setCurrentApp(null)} />
      </Suspense>
    );
  }
  if (currentApp?.id === 'ziwei') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-slate-900 flex items-center justify-center text-sm text-slate-300">加载紫微斗数...</div>}>
        <ZiweiPage onClose={() => setCurrentApp(null)} />
      </Suspense>
    );
  }
  if (currentApp?.id === 'doudizhu') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-green-900 flex items-center justify-center text-sm text-green-300">加载斗地主...</div>}>
        <DouDiZhuPage onClose={() => setCurrentApp(null)} />
      </Suspense>
    );
  }
  if (currentApp?.id === 'chess') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-amber-950 flex items-center justify-center text-sm text-amber-300">加载象棋...</div>}>
        <ChessPage
          roomId={currentApp.roomId}
          onClose={() => setCurrentApp(null)}
        />
      </Suspense>
    );
  }
  if (currentApp?.id === 'mahjong') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-emerald-950 flex items-center justify-center text-sm text-emerald-300">加载麻将...</div>}>
        <MahjongPage onClose={() => setCurrentApp(null)} />
      </Suspense>
    );
  }
  if (currentApp?.id === 'werewolf') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-indigo-950 flex items-center justify-center text-sm text-indigo-300">加载狼人杀...</div>}>
        <WerewolfPage onClose={() => setCurrentApp(null)} />
      </Suspense>
    );
  }
  if (currentApp?.id === 'minecraft') {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-50 bg-sky-950 flex items-center justify-center text-sm text-sky-300">加载我的世界...</div>}>
        <MinecraftPage onClose={() => setCurrentApp(null)} />
      </Suspense>
    );
  }

  // 如果在应用市场页面
  if (showMarketplace) {
    return (
      <>
        {renderUpdateBanner()}
        <AppMarketplace
          onBack={() => setShowMarketplace(false)}
          onOpenApp={(appId) => setCurrentApp({ id: appId })}
        />
      </>
    );
  }

  // 如果在更新中心页面
  if (showUpdateCenter) {
    return (
      <>
        {renderUpdateBanner()}
        <UpdateCenterPage onClose={() => setShowUpdateCenter(false)} />
      </>
    );
  }

  // 如果在电商页面
  if (showEcom) {
    return (
      <>
        {renderUpdateBanner()}
        <EcomFeedPage onClose={() => setShowEcom(false)} />
      </>
    );
  }

  // 如果在交易页面
  if (showTrading) {
    return (
      <>
        {renderUpdateBanner()}
        <TradingPage onClose={() => setShowTrading(false)} />
      </>
    );
  }

  // 如果在全屏发布页面
  if (publishMode !== 'none' && publishMode !== 'select') {
    return (
      <>
        {renderUpdateBanner()}
        {renderPublishPage()}
      </>
    );
  }

  return (
    <div
      className="unimaker-app-shell flex h-full w-full flex-col overflow-hidden bg-gray-50"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {renderUpdateBanner()}
      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderContent()}
      </div>

      {/* Bottom Navigation */}
      <nav
        className="relative shrink-0 border-t border-gray-200 bg-white px-2 pt-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        <div className="grid grid-cols-5 items-end gap-1">
          <button
            onClick={() => setCurrentTab('home')}
            className={`flex w-full flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${currentTab === 'home' ? 'text-purple-500' : 'text-gray-600'}`}
          >
            <Home size={22} />
            <span className="text-[11px] leading-none">{t.nav_home}</span>
          </button>
          <button
            onClick={() => setCurrentTab('messages')}
            className={`flex w-full flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${currentTab === 'messages' ? 'text-purple-500' : 'text-gray-600'}`}
          >
            <MessageCircle size={22} />
            <span className="text-[11px] leading-none">{t.nav_messages}</span>
          </button>

          {/* Publish Button - Center */}
          <button
            onClick={() => setPublishMode('select')}
            className="flex w-full flex-col items-center gap-1 rounded-lg py-0.5 transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500 transition-colors hover:bg-purple-600">
              <Plus size={22} className="text-white" strokeWidth={3} />
            </div>
            <span className="text-[11px] leading-none text-gray-600">{t.nav_publish}</span>
          </button>

          <button
            onClick={() => setCurrentTab('nodes')}
            className={`flex w-full flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${currentTab === 'nodes' ? 'text-purple-500' : 'text-gray-600'}`}
          >
            <Server size={22} />
            <span className="text-[11px] leading-none">{t.nav_nodes}</span>
          </button>
          <button
            onClick={() => setCurrentTab('profile')}
            className={`flex w-full flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${currentTab === 'profile' ? 'text-purple-500' : 'text-gray-600'}`}
          >
            <User size={22} />
            <span className="text-[11px] leading-none">{t.nav_profile}</span>
          </button>
        </div>
      </nav>

      {/* Publish Type Selector */}
      {publishMode === 'select' && (
        <PublishTypeSelector
          onSelect={handleSelectPublishType}
          onClose={handleClosePublish}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <AppContent />
    </LocaleProvider>
  );
}
