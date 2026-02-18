import { useState } from 'react';
import { Bot, ChevronRight } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import ChatPage from './ChatPage';

interface Message {
  id: string;
  type: 'ai' | 'user';
  avatar: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  unread?: number;
}

const mockMessages: Message[] = [
  {
    id: 'ai-assistant',
    type: 'ai',
    avatar: '',
    name: '智能助手',
    lastMessage: '您好！我是本地AI助手，可以帮您管理节点和内容。',
    timestamp: Date.now() - 1000 * 60 * 5,
    unread: 1,
  },
  {
    id: 'peer_002',
    type: 'user',
    avatar: 'https://images.unsplash.com/photo-1628130235364-9e412ffaae5a?w=100',
    name: '科技探索者',
    lastMessage: '你好，想和你交流一下关于libp2p的技术问题',
    timestamp: Date.now() - 1000 * 60 * 30,
    unread: 2,
  },
  {
    id: 'peer_003',
    type: 'user',
    avatar: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=100',
    name: '美食记录',
    lastMessage: '这个食谱真的很棒！',
    timestamp: Date.now() - 1000 * 60 * 60,
  },
  {
    id: 'peer_004',
    type: 'user',
    avatar: 'https://images.unsplash.com/photo-1614088459293-5669fadc3448?w=100',
    name: '旅行日记',
    lastMessage: '巴厘岛真的太美了，推荐你去看看',
    timestamp: Date.now() - 1000 * 60 * 120,
  },
  {
    id: 'peer_005',
    type: 'user',
    avatar: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=100',
    name: '音乐人',
    lastMessage: '谢谢你的支持！',
    timestamp: Date.now() - 1000 * 60 * 180,
  },
];

export default function MessagesPage() {
  const [messages] = useState<Message[]>(mockMessages);
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;

    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // Find selected message for ChatPage
  const selectedMsg = messages.find(m => m.id === selectedMessage);

  // Render ChatPage if a message is selected
  if (selectedMessage && selectedMsg) {
    return (
      <ChatPage
        chatId={selectedMsg.id}
        chatName={selectedMsg.name}
        chatAvatar={selectedMsg.avatar || ''}
        isGroup={false}
        onBack={() => setSelectedMessage(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3" />

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto">
        {/* AI Assistant - Pinned */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100">
          <button
            onClick={() => setSelectedMessage('ai-assistant')}
            className="w-full px-4 py-4 flex items-center gap-3 hover:bg-white hover:bg-opacity-50 transition-colors"
          >
            <div className="relative">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                <Bot size={24} className="text-white" />
              </div>
              {messages.find(m => m.id === 'ai-assistant')?.unread && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs text-white">
                  {messages.find(m => m.id === 'ai-assistant')?.unread}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-medium text-gray-900 flex items-center gap-2">
                  智能助手
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    端侧AI
                  </span>
                </h3>
                <span className="text-xs text-gray-500">
                  {formatTime(messages.find(m => m.id === 'ai-assistant')?.timestamp || Date.now())}
                </span>
              </div>
              <p className="text-sm text-gray-600 truncate">
                {messages.find(m => m.id === 'ai-assistant')?.lastMessage}
              </p>
            </div>
            <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
          </button>
        </div>

        {/* User Messages */}
        <div className="divide-y divide-gray-100">
          {messages
            .filter(m => m.type === 'user')
            .map((message) => (
              <button
                key={message.id}
                onClick={() => setSelectedMessage(message.id)}
                className="w-full px-4 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <div className="relative">
                  <ImageWithFallback
                    src={message.avatar}
                    alt={message.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  {message.unread && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs text-white">
                      {message.unread}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-gray-900">{message.name}</h3>
                    <span className="text-xs text-gray-500">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">
                    {message.lastMessage}
                  </p>
                </div>
                <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
              </button>
            ))}
        </div>
      </div>

      {/* Empty State if no messages */}
      {messages.filter(m => m.type === 'user').length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <MessageCircle size={48} className="mx-auto mb-3 opacity-50" />
            <p>暂无消息</p>
          </div>
        </div>
      )}
    </div>
  );
}
