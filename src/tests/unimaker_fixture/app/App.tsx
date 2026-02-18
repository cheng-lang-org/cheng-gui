import { useState, useEffect } from 'react';
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
import { LocaleProvider, useLocale } from './i18n/LocaleContext';

type TabType = 'home' | 'messages' | 'nodes' | 'profile';
type PublishMode = 'none' | 'select' | PublishType;

function AppContent() {
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const [publishMode, setPublishMode] = useState<PublishMode>('none');
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [showTrading, setShowTrading] = useState(false);
  const { setLocale, t } = useLocale();

  // 检查是否首次启动
  useEffect(() => {
    const languageSet = localStorage.getItem('app_language_set');
    if (!languageSet) {
      setShowLanguageSelector(true);
    }
  }, []);

  const handleLanguageSelect = (selectedLocale: string) => {
    setLocale(selectedLocale);
    setShowLanguageSelector(false);
  };

  // 显示语言选择器（首次启动）
  if (showLanguageSelector) {
    return <LanguageSelector onSelect={handleLanguageSelect} />;
  }

  const renderContent = () => {
    switch (currentTab) {
      case 'home':
        return <HomePage onNavigate={handleNavigate} />;
      case 'messages':
        return <MessagesPage />;
      case 'nodes':
        return <NodesPage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <HomePage onNavigate={handleNavigate} />;
    }
  };

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
        return <PublishContentPage onClose={handleClosePublish} />;
      case 'product':
        return <PublishProductPage onClose={handleClosePublish} />;
      case 'live':
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

  const handleNavigate = (page: string) => {
    if (page === 'trading') {
      setShowTrading(true);
    }
  };

  // 如果在交易页面
  if (showTrading) {
    return <TradingPage onClose={() => setShowTrading(false)} />;
  }

  // 如果在全屏发布页面
  if (publishMode !== 'none' && publishMode !== 'select') {
    return renderPublishPage();
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-around relative">
        <button
          onClick={() => setCurrentTab('home')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-lg transition-colors ${currentTab === 'home' ? 'text-purple-500' : 'text-gray-600'}`}
        >
          <Home size={24} />
          <span className="text-xs">{t.nav_home}</span>
        </button>
        <button
          onClick={() => setCurrentTab('messages')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-lg transition-colors ${currentTab === 'messages' ? 'text-purple-500' : 'text-gray-600'}`}
        >
          <MessageCircle size={24} />
          <span className="text-xs">{t.nav_messages}</span>
        </button>

        {/* Publish Button - Center */}
        <button
          onClick={() => setPublishMode('select')}
          className="flex flex-col items-center gap-1 px-4 py-1 rounded-lg transition-colors"
        >
          <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center hover:bg-purple-600 transition-colors">
            <Plus size={22} className="text-white" strokeWidth={3} />
          </div>
          <span className="text-xs text-gray-600">{t.nav_publish}</span>
        </button>

        <button
          onClick={() => setCurrentTab('nodes')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-lg transition-colors ${currentTab === 'nodes' ? 'text-purple-500' : 'text-gray-600'}`}
        >
          <Server size={24} />
          <span className="text-xs">{t.nav_nodes}</span>
        </button>
        <button
          onClick={() => setCurrentTab('profile')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-lg transition-colors ${currentTab === 'profile' ? 'text-purple-500' : 'text-gray-600'}`}
        >
          <User size={24} />
          <span className="text-xs">{t.nav_profile}</span>
        </button>
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