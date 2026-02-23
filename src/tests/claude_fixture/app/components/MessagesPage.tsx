import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronRight, Menu, MessageCircle, Sparkles, Users } from 'lucide-react';
import ChatPage from './ChatPage';
import {
  ASI_BOT_ID,
  ensureASIConversation,
  loadConversations,
  markConversationRead,
  type SocialConversation,
} from '../data/socialData';
import { onConversationUpdate } from '../libp2p/inboundHandler';
import { socialStore, type SocialStoreSnapshot } from '../libp2p/socialStore';
import { useLocale } from '../i18n/LocaleContext';
import Sidebar from './Sidebar';

interface MessagesPageProps {
  onNavigate?: (page: string) => void;
  onOpenApp?: (appId: string, roomId?: string) => void;
}

export default function MessagesPage({ onNavigate, onOpenApp }: MessagesPageProps) {
  const { t } = useLocale();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState<'conversations' | 'contacts' | 'moments' | 'notifications'>('conversations');
  const [conversations, setConversations] = useState<SocialConversation[]>([]);
  const [socialSnapshot, setSocialSnapshot] = useState<SocialStoreSnapshot>(socialStore.getSnapshot());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPendingRef = useRef(false);

  // Helper to unify sorting: ASI always on top, then by timestamp descending
  const sortConversations = (list: SocialConversation[]) => {
    return list.sort((a, b) => {
      // 1. ASI bot is always displayed at the top
      if (a.id === ASI_BOT_ID) return -1;
      if (b.id === ASI_BOT_ID) return 1;
      // 2. Others by time
      return b.lastTimestamp - a.lastTimestamp;
    });
  };

  const refreshConversations = () => {
    const rows = loadConversations();
    setConversations(sortConversations(rows));
  };

  const scheduleRefreshConversations = (immediate = false) => {
    if (refreshTimerRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshConversations();
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        scheduleRefreshConversations();
      }
    }, immediate ? 0 : 400);
  };

  useEffect(() => {
    // Ensure ASI bot exists
    ensureASIConversation(t.msg_asiName, t.msg_asiGreeting);
    // Initial load
    const rows = loadConversations();
    setConversations(sortConversations(rows));
  }, [t.msg_asiName, t.msg_asiGreeting]);

  useEffect(() => {
    const unsubscribe = onConversationUpdate(() => {
      scheduleRefreshConversations();
    });
    const unsubscribeSocial = socialStore.subscribe((snapshot) => {
      setSocialSnapshot(snapshot);
    });
    void socialStore.refreshFromBridge();
    return () => {
      unsubscribe();
      unsubscribeSocial();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const formatTime = (timestamp: number) => {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) return `${Math.max(minutes, 1)}${t.msg_minutesAgo}`;
    if (hours < 24) return `${hours}${t.msg_hoursAgo}`;
    if (days < 7) return `${days}${t.msg_daysAgo}`;

    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  if (selectedConversation) {
    return (
      <ChatPage
        chatId={selectedConversation.id}
        chatName={selectedConversation.name || selectedConversation.id.slice(0, 12)}
        chatAvatar=""
        isGroup={selectedConversation.isGroup}
        onBack={() => {
          markConversationRead(selectedConversation.id);
          setSelectedId(null);
          refreshConversations();
        }}
        onOpenApp={onOpenApp}
      />
    );
  }

  return (
    <>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={onNavigate} onOpenApp={onOpenApp ? (appId) => onOpenApp(appId) : undefined} />
      <div className="h-full flex flex-col bg-white">
        <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors" aria-label="展开侧边栏">
              <Menu size={22} />
            </button>
            <h2 className="text-base font-semibold text-gray-900">{t.msg_title}</h2>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setTab('conversations')}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium ${tab === 'conversations' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600'}`}
            >
              {t.msg_conversations}
            </button>
            <button
              onClick={() => setTab('contacts')}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium ${tab === 'contacts' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600'}`}
            >
              {t.msg_contacts}
            </button>
            <button
              onClick={() => setTab('moments')}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium ${tab === 'moments' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600'}`}
            >
              {t.msg_moments}
            </button>
            <button
              onClick={() => setTab('notifications')}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium ${tab === 'notifications' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600'}`}
            >
              {t.msg_notifications}
            </button>
          </div>
        </header>

        {tab === 'conversations' && conversations.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-3 opacity-50" />
              <p>{t.msg_noMessages}</p>
            </div>
          </div>
        ) : null}

        {tab === 'conversations' ? (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => {
                  setSelectedId(conversation.id);
                }}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="font-medium text-gray-900 truncate">
                      {conversation.name || `${conversation.id.slice(0, 20)}…`}
                      {conversation.isGroup && <span className="ml-2 text-[10px] text-purple-500">{t.msg_groupChat}</span>}
                      {conversation.unread > 0 && (
                        <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 rounded-full text-[10px] text-white font-medium">
                          {conversation.unread > 99 ? '99+' : conversation.unread}
                        </span>
                      )}
                    </h3>
                    <span className="text-xs text-gray-500 flex-shrink-0">{formatTime(conversation.lastTimestamp)}</span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">
                    {conversation.lastMessage || t.msg_tapToChat}
                  </p>
                </div>

                <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        ) : null}

        {tab === 'contacts' ? (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {socialSnapshot.contacts.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Users size={42} className="mx-auto mb-2 opacity-60" />
                  <p>{t.msg_noContacts}</p>
                </div>
              </div>
            ) : (
              socialSnapshot.contacts.map((contact) => (
                <div key={contact.peerId} className="px-4 py-3">
                  <div className="font-medium text-gray-900">{contact.peerId.slice(0, 18)}...</div>
                  <div className="text-xs text-gray-500 mt-1">{t.msg_status}: {contact.status || '--'}</div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === 'moments' ? (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {socialSnapshot.moments.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Sparkles size={42} className="mx-auto mb-2 opacity-60" />
                  <p>{t.msg_noMoments}</p>
                </div>
              </div>
            ) : (
              socialSnapshot.moments.map((post) => (
                <div key={post.postId} className="px-4 py-3">
                  <div className="text-sm text-gray-900">{post.content || t.msg_noTextContent}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {post.authorPeerId ? `${post.authorPeerId.slice(0, 12)}...` : 'unknown'}
                    {post.timestampMs ? ` · ${formatTime(post.timestampMs)}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === 'notifications' ? (
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {socialSnapshot.notifications.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Bell size={42} className="mx-auto mb-2 opacity-60" />
                  <p>{t.msg_noNotifications}</p>
                </div>
              </div>
            ) : (
              socialSnapshot.notifications.map((item, index) => (
                <div key={`${item.id ?? 'notif'}-${index}`} className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{item.title || item.type || t.msg_notification}</div>
                  <div className="text-xs text-gray-600 mt-1">{item.body || ''}</div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
