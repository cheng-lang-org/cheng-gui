export type LocaleCode = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'ar';

export interface Translations {
    // Bottom Nav
    nav_home: string;
    nav_messages: string;
    nav_publish: string;
    nav_nodes: string;
    nav_profile: string;

    // Sidebar
    sidebar_creationCenter: string;
    sidebar_drafts: string;
    sidebar_history: string;
    sidebar_favorites: string;
    sidebar_liked: string;
    sidebar_settings: string;
    sidebar_helpFeedback: string;
    sidebar_darkMode: string;
    sidebar_language: string;
    sidebar_languageSettings: string;
    sidebar_logout: string;
    sidebar_myNode: string;
    sidebar_follow: string;
    sidebar_fans: string;
    sidebar_likesCollections: string;

    // Home
    home_search: string;
    home_sortByTime: string;
    home_sortByHot: string;
    home_smartSort: string;
    home_customSort: string;
    home_tabSettings: string;
    home_done: string;

    // Publish Types
    publish_content: string;
    publish_ecommerce: string;
    publish_live: string;
    publish_app: string;
    publish_food: string;
    publish_ride: string;
    publish_job: string;
    publish_hire: string;
    publish_rent: string;
    publish_sell: string;
    publish_secondhand: string;
    publish_crowdfunding: string;
    publish_selectType: string;
    publish_cancel: string;
    publish_publish: string;

    // Payment Config
    payment_detectingRegion: string;
    payment_chinaRegion: string;
    payment_internationalRegion: string;
    payment_switchPreview: string;
    payment_price: string;
    payment_enterPrice: string;
    payment_uploadInfo: string;
    payment_wechatQr: string;
    payment_alipayQr: string;
    payment_uploadWechat: string;
    payment_uploadAlipay: string;
    payment_internationalInfo: string;
    payment_creditCard: string;
    payment_creditCardDesc: string;
    payment_web3Wallet: string;
    payment_web3WalletDesc: string;
    payment_walletPlaceholder: string;
    payment_pointsPricing: string;
    payment_rwadPricing: string;
    payment_comingSoon: string;

    // Common
    common_cancel: string;
    common_confirm: string;
    common_save: string;
    common_delete: string;
    common_edit: string;
    common_back: string;
    common_next: string;
    common_skip: string;
    common_loading: string;

    // Language Selector
    langSelector_welcome: string;
    langSelector_selectLanguage: string;
    langSelector_continue: string;
    langSelector_selectPrompt: string;
    langSelector_skipDefault: string;

    // Sidebar - Trading
    sidebar_trading: string;

    // Trading / DEX
    trading_chart: string;
    trading_orderBook: string;
    trading_recentTrades: string;
    trading_price: string;
    trading_amount: string;
    trading_time: string;
    trading_limit: string;
    trading_market: string;
    trading_buy: string;
    trading_sell: string;
    trading_wallet: string;
    trading_totalAssets: string;
    trading_deposit: string;
    trading_withdraw: string;
    trading_myAssets: string;
}

const zhCN: Translations = {
    nav_home: '首页',
    nav_messages: '消息',
    nav_publish: '发布',
    nav_nodes: '节点',
    nav_profile: '我',

    sidebar_creationCenter: '创作中心',
    sidebar_drafts: '我的草稿',
    sidebar_history: '浏览记录',
    sidebar_favorites: '我的收藏',
    sidebar_liked: '赞过',
    sidebar_settings: '设置',
    sidebar_helpFeedback: '帮助与反馈',
    sidebar_darkMode: '深色模式',
    sidebar_language: '语言',
    sidebar_languageSettings: '语言设置',
    sidebar_logout: '退出登录',
    sidebar_myNode: '我的节点',
    sidebar_follow: '关注',
    sidebar_fans: '粉丝',
    sidebar_likesCollections: '获赞与收藏',

    home_search: '搜索内容...',
    home_sortByTime: '最新',
    home_sortByHot: '最热',
    home_smartSort: '智能排序',
    home_customSort: '自定义排序',
    home_tabSettings: '频道管理',
    home_done: '完成',

    publish_content: '内容',
    publish_ecommerce: '电商',
    publish_live: '直播',
    publish_app: '应用',
    publish_food: '外卖',
    publish_ride: '顺风车',
    publish_job: '求职',
    publish_hire: '招聘',
    publish_rent: '出租',
    publish_sell: '出售',
    publish_secondhand: '二手',
    publish_crowdfunding: '众筹',
    publish_selectType: '选择发布类型',
    publish_cancel: '取消',
    publish_publish: '发布',

    payment_detectingRegion: '正在检测区域...',
    payment_chinaRegion: '中国区',
    payment_internationalRegion: '国际区',
    payment_switchPreview: '切换查看',
    payment_price: '价格',
    payment_enterPrice: '输入价格',
    payment_uploadInfo: '上传您的收款码，买家将直接向您付款（平台不经手资金）',
    payment_wechatQr: '微信收款码',
    payment_alipayQr: '支付宝收款码',
    payment_uploadWechat: '上传微信码',
    payment_uploadAlipay: '上传支付宝码',
    payment_internationalInfo: '设置您的收款方式，买家将直接向您付款',
    payment_creditCard: '信用卡收款',
    payment_creditCardDesc: '通过 Stripe 接收付款',
    payment_web3Wallet: 'Web3 钱包',
    payment_web3WalletDesc: '接收加密货币付款',
    payment_walletPlaceholder: '输入钱包地址 (0x...)',
    payment_pointsPricing: '积分定价',
    payment_rwadPricing: 'RWAD定价',
    payment_comingSoon: '敬请期待',

    common_cancel: '取消',
    common_confirm: '确认',
    common_save: '保存',
    common_delete: '删除',
    common_edit: '编辑',
    common_back: '返回',
    common_next: '下一步',
    common_skip: '跳过',
    common_loading: '加载中...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: '请选择您的语言',
    langSelector_continue: '继续',
    langSelector_selectPrompt: '请选择语言',
    langSelector_skipDefault: '跳过，使用简体中文',

    sidebar_trading: 'DEX 交易',
    trading_chart: 'K线',
    trading_orderBook: '买卖盘',
    trading_recentTrades: '成交',
    trading_price: '价格',
    trading_amount: '数量',
    trading_time: '时间',
    trading_limit: '限价',
    trading_market: '市价',
    trading_buy: '买入',
    trading_sell: '卖出',
    trading_wallet: 'Web3 钱包',
    trading_totalAssets: '总资产',
    trading_deposit: '充值',
    trading_withdraw: '提现',
    trading_myAssets: '我的资产',
};

const zhTW: Translations = {
    nav_home: '首頁',
    nav_messages: '訊息',
    nav_publish: '發佈',
    nav_nodes: '節點',
    nav_profile: '我',

    sidebar_creationCenter: '創作中心',
    sidebar_drafts: '我的草稿',
    sidebar_history: '瀏覽記錄',
    sidebar_favorites: '我的收藏',
    sidebar_liked: '讚過',
    sidebar_settings: '設置',
    sidebar_helpFeedback: '幫助與反饋',
    sidebar_darkMode: '深色模式',
    sidebar_language: '語言',
    sidebar_languageSettings: '語言設置',
    sidebar_logout: '退出登錄',
    sidebar_myNode: '我的節點',
    sidebar_follow: '關注',
    sidebar_fans: '粉絲',
    sidebar_likesCollections: '獲讚與收藏',

    home_search: '搜尋內容...',
    home_sortByTime: '最新',
    home_sortByHot: '最熱',
    home_smartSort: '智慧排序',
    home_customSort: '自訂排序',
    home_tabSettings: '頻道管理',
    home_done: '完成',

    publish_content: '內容',
    publish_ecommerce: '電商',
    publish_live: '直播',
    publish_app: '應用',
    publish_food: '外賣',
    publish_ride: '順風車',
    publish_job: '求職',
    publish_hire: '招聘',
    publish_rent: '出租',
    publish_sell: '出售',
    publish_secondhand: '二手',
    publish_crowdfunding: '眾籌',
    publish_selectType: '選擇發佈類型',
    publish_cancel: '取消',
    publish_publish: '發佈',

    payment_detectingRegion: '正在偵測區域...',
    payment_chinaRegion: '中國區',
    payment_internationalRegion: '國際區',
    payment_switchPreview: '切換查看',
    payment_price: '價格',
    payment_enterPrice: '輸入價格',
    payment_uploadInfo: '上傳您的收款碼，買家將直接向您付款（平台不經手資金）',
    payment_wechatQr: '微信收款碼',
    payment_alipayQr: '支付寶收款碼',
    payment_uploadWechat: '上傳微信碼',
    payment_uploadAlipay: '上傳支付寶碼',
    payment_internationalInfo: '設定您的收款方式，買家將直接向您付款',
    payment_creditCard: '信用卡收款',
    payment_creditCardDesc: '透過 Stripe 接收付款',
    payment_web3Wallet: 'Web3 錢包',
    payment_web3WalletDesc: '接收加密貨幣付款',
    payment_walletPlaceholder: '輸入錢包地址 (0x...)',
    payment_pointsPricing: '積分定價',
    payment_rwadPricing: 'RWAD定價',
    payment_comingSoon: '敬請期待',

    common_cancel: '取消',
    common_confirm: '確認',
    common_save: '儲存',
    common_delete: '刪除',
    common_edit: '編輯',
    common_back: '返回',
    common_next: '下一步',
    common_skip: '跳過',
    common_loading: '載入中...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: '請選擇您的語言',
    langSelector_continue: '繼續',
    langSelector_selectPrompt: '請選擇語言',
    langSelector_skipDefault: '跳過，使用繁體中文',

    sidebar_trading: 'DEX 交易',
    trading_chart: 'K線',
    trading_orderBook: '買賣盤',
    trading_recentTrades: '成交',
    trading_price: '價格',
    trading_amount: '數量',
    trading_time: '時間',
    trading_limit: '限價',
    trading_market: '市價',
    trading_buy: '買入',
    trading_sell: '賣出',
    trading_wallet: 'Web3 錢包',
    trading_totalAssets: '總資產',
    trading_deposit: '充值',
    trading_withdraw: '提現',
    trading_myAssets: '我的資產',
};

const en: Translations = {
    nav_home: 'Home',
    nav_messages: 'Messages',
    nav_publish: 'Publish',
    nav_nodes: 'Nodes',
    nav_profile: 'Me',

    sidebar_creationCenter: 'Creation Center',
    sidebar_drafts: 'My Drafts',
    sidebar_history: 'History',
    sidebar_favorites: 'Favorites',
    sidebar_liked: 'Liked',
    sidebar_settings: 'Settings',
    sidebar_helpFeedback: 'Help & Feedback',
    sidebar_darkMode: 'Dark Mode',
    sidebar_language: 'Language',
    sidebar_languageSettings: 'Language Settings',
    sidebar_logout: 'Log Out',
    sidebar_myNode: 'My Node',
    sidebar_follow: 'Following',
    sidebar_fans: 'Followers',
    sidebar_likesCollections: 'Likes & Saves',

    home_search: 'Search...',
    home_sortByTime: 'Latest',
    home_sortByHot: 'Trending',
    home_smartSort: 'Smart Sort',
    home_customSort: 'Custom Sort',
    home_tabSettings: 'Channel Settings',
    home_done: 'Done',

    publish_content: 'Content',
    publish_ecommerce: 'E-Commerce',
    publish_live: 'Live',
    publish_app: 'App',
    publish_food: 'Food',
    publish_ride: 'Ride',
    publish_job: 'Job',
    publish_hire: 'Hire',
    publish_rent: 'Rent',
    publish_sell: 'Sell',
    publish_secondhand: 'Used',
    publish_crowdfunding: 'Crowdfund',
    publish_selectType: 'Select Publish Type',
    publish_cancel: 'Cancel',
    publish_publish: 'Publish',

    payment_detectingRegion: 'Detecting region...',
    payment_chinaRegion: 'China',
    payment_internationalRegion: 'International',
    payment_switchPreview: 'Switch View',
    payment_price: 'Price',
    payment_enterPrice: 'Enter price',
    payment_uploadInfo: 'Upload your payment QR code. Buyers will pay you directly (platform does not handle funds)',
    payment_wechatQr: 'WeChat Pay QR',
    payment_alipayQr: 'Alipay QR',
    payment_uploadWechat: 'Upload WeChat QR',
    payment_uploadAlipay: 'Upload Alipay QR',
    payment_internationalInfo: 'Set up your payment methods. Buyers will pay you directly',
    payment_creditCard: 'Credit Card',
    payment_creditCardDesc: 'Accept payments via Stripe',
    payment_web3Wallet: 'Web3 Wallet',
    payment_web3WalletDesc: 'Accept cryptocurrency payments',
    payment_walletPlaceholder: 'Enter wallet address (0x...)',
    payment_pointsPricing: 'Points Pricing',
    payment_rwadPricing: 'RWAD Pricing',
    payment_comingSoon: 'Coming Soon',

    common_cancel: 'Cancel',
    common_confirm: 'Confirm',
    common_save: 'Save',
    common_delete: 'Delete',
    common_edit: 'Edit',
    common_back: 'Back',
    common_next: 'Next',
    common_skip: 'Skip',
    common_loading: 'Loading...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: 'Please select your preferred language',
    langSelector_continue: 'Continue',
    langSelector_selectPrompt: 'Select a language',
    langSelector_skipDefault: 'Skip, use English',

    sidebar_trading: 'DEX Trading',
    trading_chart: 'Chart',
    trading_orderBook: 'Order Book',
    trading_recentTrades: 'Trades',
    trading_price: 'Price',
    trading_amount: 'Amount',
    trading_time: 'Time',
    trading_limit: 'Limit',
    trading_market: 'Market',
    trading_buy: 'Buy',
    trading_sell: 'Sell',
    trading_wallet: 'Web3 Wallet',
    trading_totalAssets: 'Total Assets',
    trading_deposit: 'Deposit',
    trading_withdraw: 'Withdraw',
    trading_myAssets: 'My Assets',
};

const ja: Translations = {
    nav_home: 'ホーム',
    nav_messages: 'メッセージ',
    nav_publish: '投稿',
    nav_nodes: 'ノード',
    nav_profile: 'マイ',

    sidebar_creationCenter: 'クリエイティブセンター',
    sidebar_drafts: '下書き',
    sidebar_history: '閲覧履歴',
    sidebar_favorites: 'お気に入り',
    sidebar_liked: 'いいね',
    sidebar_settings: '設定',
    sidebar_helpFeedback: 'ヘルプ',
    sidebar_darkMode: 'ダークモード',
    sidebar_language: '言語',
    sidebar_languageSettings: '言語設定',
    sidebar_logout: 'ログアウト',
    sidebar_myNode: 'マイノード',
    sidebar_follow: 'フォロー',
    sidebar_fans: 'フォロワー',
    sidebar_likesCollections: 'いいねと保存',

    home_search: '検索...',
    home_sortByTime: '最新',
    home_sortByHot: '人気',
    home_smartSort: 'スマート並べ替え',
    home_customSort: 'カスタム並べ替え',
    home_tabSettings: 'チャンネル管理',
    home_done: '完了',

    publish_content: 'コンテンツ',
    publish_ecommerce: 'EC',
    publish_live: 'ライブ',
    publish_app: 'アプリ',
    publish_food: 'フード',
    publish_ride: '相乗り',
    publish_job: '求職',
    publish_hire: '採用',
    publish_rent: '賃貸',
    publish_sell: '販売',
    publish_secondhand: '中古',
    publish_crowdfunding: 'クラファン',
    publish_selectType: '投稿タイプを選択',
    publish_cancel: 'キャンセル',
    publish_publish: '投稿',

    payment_detectingRegion: '地域を検出中...',
    payment_chinaRegion: '中国',
    payment_internationalRegion: '国際',
    payment_switchPreview: '切り替え',
    payment_price: '価格',
    payment_enterPrice: '価格を入力',
    payment_uploadInfo: '決済QRコードをアップロードしてください。購入者が直接支払います',
    payment_wechatQr: 'WeChat Pay QR',
    payment_alipayQr: 'Alipay QR',
    payment_uploadWechat: 'WeChat QRをアップ',
    payment_uploadAlipay: 'Alipay QRをアップ',
    payment_internationalInfo: '決済方法を設定してください。購入者が直接支払います',
    payment_creditCard: 'クレジットカード',
    payment_creditCardDesc: 'Stripe経由で受け取り',
    payment_web3Wallet: 'Web3ウォレット',
    payment_web3WalletDesc: '暗号通貨で受け取り',
    payment_walletPlaceholder: 'ウォレットアドレス (0x...)',
    payment_pointsPricing: 'ポイント価格',
    payment_rwadPricing: 'RWAD価格',
    payment_comingSoon: '近日公開',

    common_cancel: 'キャンセル',
    common_confirm: '確認',
    common_save: '保存',
    common_delete: '削除',
    common_edit: '編集',
    common_back: '戻る',
    common_next: '次へ',
    common_skip: 'スキップ',
    common_loading: '読み込み中...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: '言語を選択してください',
    langSelector_continue: '続ける',
    langSelector_selectPrompt: '言語を選択',
    langSelector_skipDefault: 'スキップ',

    sidebar_trading: 'DEX取引',
    trading_chart: 'チャート',
    trading_orderBook: '注文板',
    trading_recentTrades: '取引履歴',
    trading_price: '価格',
    trading_amount: '数量',
    trading_time: '時間',
    trading_limit: '指値',
    trading_market: '成行',
    trading_buy: '購入',
    trading_sell: '売却',
    trading_wallet: 'Web3ウォレット',
    trading_totalAssets: '総資産',
    trading_deposit: '入金',
    trading_withdraw: '出金',
    trading_myAssets: '保有資産',
};

const ko: Translations = {
    nav_home: '홈',
    nav_messages: '메시지',
    nav_publish: '게시',
    nav_nodes: '노드',
    nav_profile: '나',

    sidebar_creationCenter: '크리에이터 센터',
    sidebar_drafts: '내 초안',
    sidebar_history: '기록',
    sidebar_favorites: '즐겨찾기',
    sidebar_liked: '좋아요',
    sidebar_settings: '설정',
    sidebar_helpFeedback: '도움말',
    sidebar_darkMode: '다크 모드',
    sidebar_language: '언어',
    sidebar_languageSettings: '언어 설정',
    sidebar_logout: '로그아웃',
    sidebar_myNode: '내 노드',
    sidebar_follow: '팔로잉',
    sidebar_fans: '팔로워',
    sidebar_likesCollections: '좋아요 및 저장',

    home_search: '검색...',
    home_sortByTime: '최신',
    home_sortByHot: '인기',
    home_smartSort: '스마트 정렬',
    home_customSort: '사용자 정렬',
    home_tabSettings: '채널 관리',
    home_done: '완료',

    publish_content: '콘텐츠',
    publish_ecommerce: '쇼핑',
    publish_live: '라이브',
    publish_app: '앱',
    publish_food: '배달',
    publish_ride: '카풀',
    publish_job: '구직',
    publish_hire: '채용',
    publish_rent: '임대',
    publish_sell: '판매',
    publish_secondhand: '중고',
    publish_crowdfunding: '크라우드펀딩',
    publish_selectType: '게시 유형 선택',
    publish_cancel: '취소',
    publish_publish: '게시',

    payment_detectingRegion: '지역 감지 중...',
    payment_chinaRegion: '중국',
    payment_internationalRegion: '국제',
    payment_switchPreview: '전환',
    payment_price: '가격',
    payment_enterPrice: '가격 입력',
    payment_uploadInfo: '결제 QR코드를 업로드하세요. 구매자가 직접 결제합니다',
    payment_wechatQr: 'WeChat Pay QR',
    payment_alipayQr: 'Alipay QR',
    payment_uploadWechat: 'WeChat QR 업로드',
    payment_uploadAlipay: 'Alipay QR 업로드',
    payment_internationalInfo: '결제 수단을 설정하세요. 구매자가 직접 결제합니다',
    payment_creditCard: '신용카드',
    payment_creditCardDesc: 'Stripe를 통해 결제 수신',
    payment_web3Wallet: 'Web3 지갑',
    payment_web3WalletDesc: '암호화폐 결제 수신',
    payment_walletPlaceholder: '지갑 주소 입력 (0x...)',
    payment_pointsPricing: '포인트 가격',
    payment_rwadPricing: 'RWAD 가격',
    payment_comingSoon: '출시 예정',

    common_cancel: '취소',
    common_confirm: '확인',
    common_save: '저장',
    common_delete: '삭제',
    common_edit: '편집',
    common_back: '뒤로',
    common_next: '다음',
    common_skip: '건너뛰기',
    common_loading: '로딩 중...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: '언어를 선택하세요',
    langSelector_continue: '계속',
    langSelector_selectPrompt: '언어 선택',
    langSelector_skipDefault: '건너뛰기',

    sidebar_trading: 'DEX 거래',
    trading_chart: '차트',
    trading_orderBook: '호가창',
    trading_recentTrades: '체결',
    trading_price: '가격',
    trading_amount: '수량',
    trading_time: '시간',
    trading_limit: '지정가',
    trading_market: '시장가',
    trading_buy: '매수',
    trading_sell: '매도',
    trading_wallet: 'Web3 지갑',
    trading_totalAssets: '총 자산',
    trading_deposit: '입금',
    trading_withdraw: '출금',
    trading_myAssets: '내 자산',
};

const fr: Translations = {
    nav_home: 'Accueil',
    nav_messages: 'Messages',
    nav_publish: 'Publier',
    nav_nodes: 'Nœuds',
    nav_profile: 'Moi',

    sidebar_creationCenter: 'Centre de création',
    sidebar_drafts: 'Mes brouillons',
    sidebar_history: 'Historique',
    sidebar_favorites: 'Favoris',
    sidebar_liked: 'Aimés',
    sidebar_settings: 'Paramètres',
    sidebar_helpFeedback: 'Aide',
    sidebar_darkMode: 'Mode sombre',
    sidebar_language: 'Langue',
    sidebar_languageSettings: 'Paramètres de langue',
    sidebar_logout: 'Déconnexion',
    sidebar_myNode: 'Mon nœud',
    sidebar_follow: 'Abonnements',
    sidebar_fans: 'Abonnés',
    sidebar_likesCollections: 'J\'aime et sauv.',

    home_search: 'Rechercher...',
    home_sortByTime: 'Récent',
    home_sortByHot: 'Tendance',
    home_smartSort: 'Tri intelligent',
    home_customSort: 'Tri personnalisé',
    home_tabSettings: 'Gérer les chaînes',
    home_done: 'Terminé',

    publish_content: 'Contenu',
    publish_ecommerce: 'E-Commerce',
    publish_live: 'Live',
    publish_app: 'App',
    publish_food: 'Livraison',
    publish_ride: 'Covoiturage',
    publish_job: 'Emploi',
    publish_hire: 'Recrutement',
    publish_rent: 'Location',
    publish_sell: 'Vente',
    publish_secondhand: 'Occasion',
    publish_crowdfunding: 'Crowdfunding',
    publish_selectType: 'Choisir le type',
    publish_cancel: 'Annuler',
    publish_publish: 'Publier',

    payment_detectingRegion: 'Détection de la région...',
    payment_chinaRegion: 'Chine',
    payment_internationalRegion: 'International',
    payment_switchPreview: 'Changer la vue',
    payment_price: 'Prix',
    payment_enterPrice: 'Entrer le prix',
    payment_uploadInfo: 'Téléchargez votre QR code. Les acheteurs vous paient directement',
    payment_wechatQr: 'QR WeChat Pay',
    payment_alipayQr: 'QR Alipay',
    payment_uploadWechat: 'Télécharger QR WeChat',
    payment_uploadAlipay: 'Télécharger QR Alipay',
    payment_internationalInfo: 'Configurez vos modes de paiement. Les acheteurs vous paient directement',
    payment_creditCard: 'Carte de crédit',
    payment_creditCardDesc: 'Recevoir via Stripe',
    payment_web3Wallet: 'Portefeuille Web3',
    payment_web3WalletDesc: 'Recevoir en crypto',
    payment_walletPlaceholder: 'Adresse du portefeuille (0x...)',
    payment_pointsPricing: 'Tarification par points',
    payment_rwadPricing: 'Tarification RWAD',
    payment_comingSoon: 'Bientôt disponible',

    common_cancel: 'Annuler',
    common_confirm: 'Confirmer',
    common_save: 'Enregistrer',
    common_delete: 'Supprimer',
    common_edit: 'Modifier',
    common_back: 'Retour',
    common_next: 'Suivant',
    common_skip: 'Passer',
    common_loading: 'Chargement...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: 'Choisissez votre langue',
    langSelector_continue: 'Continuer',
    langSelector_selectPrompt: 'Choisir une langue',
    langSelector_skipDefault: 'Passer',

    sidebar_trading: 'Trading DEX',
    trading_chart: 'Graphique',
    trading_orderBook: 'Carnet d\'ordres',
    trading_recentTrades: 'Échanges',
    trading_price: 'Prix',
    trading_amount: 'Montant',
    trading_time: 'Heure',
    trading_limit: 'Limite',
    trading_market: 'Marché',
    trading_buy: 'Acheter',
    trading_sell: 'Vendre',
    trading_wallet: 'Portefeuille Web3',
    trading_totalAssets: 'Actifs totaux',
    trading_deposit: 'Déposer',
    trading_withdraw: 'Retirer',
    trading_myAssets: 'Mes actifs',
};

const de: Translations = {
    nav_home: 'Start',
    nav_messages: 'Nachrichten',
    nav_publish: 'Posten',
    nav_nodes: 'Knoten',
    nav_profile: 'Ich',

    sidebar_creationCenter: 'Kreativzentrum',
    sidebar_drafts: 'Meine Entwürfe',
    sidebar_history: 'Verlauf',
    sidebar_favorites: 'Favoriten',
    sidebar_liked: 'Gefällt mir',
    sidebar_settings: 'Einstellungen',
    sidebar_helpFeedback: 'Hilfe',
    sidebar_darkMode: 'Dunkelmodus',
    sidebar_language: 'Sprache',
    sidebar_languageSettings: 'Spracheinstellungen',
    sidebar_logout: 'Abmelden',
    sidebar_myNode: 'Mein Knoten',
    sidebar_follow: 'Folge ich',
    sidebar_fans: 'Follower',
    sidebar_likesCollections: 'Likes & Gespeichert',

    home_search: 'Suchen...',
    home_sortByTime: 'Neueste',
    home_sortByHot: 'Beliebt',
    home_smartSort: 'Smartes Sortieren',
    home_customSort: 'Benutzerdefiniert',
    home_tabSettings: 'Kanal-Einstellungen',
    home_done: 'Fertig',

    publish_content: 'Inhalt',
    publish_ecommerce: 'E-Commerce',
    publish_live: 'Live',
    publish_app: 'App',
    publish_food: 'Essen',
    publish_ride: 'Mitfahrt',
    publish_job: 'Jobsuche',
    publish_hire: 'Einstellen',
    publish_rent: 'Vermietung',
    publish_sell: 'Verkauf',
    publish_secondhand: 'Gebraucht',
    publish_crowdfunding: 'Crowdfunding',
    publish_selectType: 'Typ auswählen',
    publish_cancel: 'Abbrechen',
    publish_publish: 'Veröffentlichen',

    payment_detectingRegion: 'Region wird erkannt...',
    payment_chinaRegion: 'China',
    payment_internationalRegion: 'International',
    payment_switchPreview: 'Ansicht wechseln',
    payment_price: 'Preis',
    payment_enterPrice: 'Preis eingeben',
    payment_uploadInfo: 'Laden Sie Ihren Zahlungs-QR-Code hoch. Käufer zahlen direkt an Sie',
    payment_wechatQr: 'WeChat Pay QR',
    payment_alipayQr: 'Alipay QR',
    payment_uploadWechat: 'WeChat QR hochladen',
    payment_uploadAlipay: 'Alipay QR hochladen',
    payment_internationalInfo: 'Richten Sie Ihre Zahlungsmethoden ein. Käufer zahlen direkt an Sie',
    payment_creditCard: 'Kreditkarte',
    payment_creditCardDesc: 'Empfang über Stripe',
    payment_web3Wallet: 'Web3-Wallet',
    payment_web3WalletDesc: 'Kryptowährungen empfangen',
    payment_walletPlaceholder: 'Wallet-Adresse (0x...)',
    payment_pointsPricing: 'Punkte-Preise',
    payment_rwadPricing: 'RWAD-Preise',
    payment_comingSoon: 'Demnächst verfügbar',

    common_cancel: 'Abbrechen',
    common_confirm: 'Bestätigen',
    common_save: 'Speichern',
    common_delete: 'Löschen',
    common_edit: 'Bearbeiten',
    common_back: 'Zurück',
    common_next: 'Weiter',
    common_skip: 'Überspringen',
    common_loading: 'Laden...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: 'Bitte wählen Sie Ihre Sprache',
    langSelector_continue: 'Weiter',
    langSelector_selectPrompt: 'Sprache wählen',
    langSelector_skipDefault: 'Überspringen',

    sidebar_trading: 'DEX Handel',
    trading_chart: 'Chart',
    trading_orderBook: 'Orderbuch',
    trading_recentTrades: 'Trades',
    trading_price: 'Preis',
    trading_amount: 'Menge',
    trading_time: 'Zeit',
    trading_limit: 'Limit',
    trading_market: 'Markt',
    trading_buy: 'Kaufen',
    trading_sell: 'Verkaufen',
    trading_wallet: 'Web3 Wallet',
    trading_totalAssets: 'Gesamtvermögen',
    trading_deposit: 'Einzahlen',
    trading_withdraw: 'Abheben',
    trading_myAssets: 'Meine Assets',
};

const ar: Translations = {
    nav_home: 'الرئيسية',
    nav_messages: 'الرسائل',
    nav_publish: 'نشر',
    nav_nodes: 'العقد',
    nav_profile: 'أنا',

    sidebar_creationCenter: 'مركز الإبداع',
    sidebar_drafts: 'مسوداتي',
    sidebar_history: 'السجل',
    sidebar_favorites: 'المفضلة',
    sidebar_liked: 'إعجاباتي',
    sidebar_settings: 'الإعدادات',
    sidebar_helpFeedback: 'المساعدة',
    sidebar_darkMode: 'الوضع الداكن',
    sidebar_language: 'اللغة',
    sidebar_languageSettings: 'إعدادات اللغة',
    sidebar_logout: 'تسجيل الخروج',
    sidebar_myNode: 'عقدتي',
    sidebar_follow: 'متابَعون',
    sidebar_fans: 'متابِعون',
    sidebar_likesCollections: 'إعجابات وحفظ',

    home_search: 'بحث...',
    home_sortByTime: 'الأحدث',
    home_sortByHot: 'الأكثر رواجاً',
    home_smartSort: 'ترتيب ذكي',
    home_customSort: 'ترتيب مخصص',
    home_tabSettings: 'إدارة القنوات',
    home_done: 'تم',

    publish_content: 'محتوى',
    publish_ecommerce: 'تجارة',
    publish_live: 'بث مباشر',
    publish_app: 'تطبيق',
    publish_food: 'طعام',
    publish_ride: 'مشاركة ركوب',
    publish_job: 'وظيفة',
    publish_hire: 'توظيف',
    publish_rent: 'تأجير',
    publish_sell: 'بيع',
    publish_secondhand: 'مستعمل',
    publish_crowdfunding: 'تمويل جماعي',
    publish_selectType: 'اختر نوع النشر',
    publish_cancel: 'إلغاء',
    publish_publish: 'نشر',

    payment_detectingRegion: 'جاري اكتشاف المنطقة...',
    payment_chinaRegion: 'الصين',
    payment_internationalRegion: 'دولي',
    payment_switchPreview: 'تبديل العرض',
    payment_price: 'السعر',
    payment_enterPrice: 'أدخل السعر',
    payment_uploadInfo: 'ارفع رمز QR للدفع. سيدفع المشتري لك مباشرة',
    payment_wechatQr: 'QR WeChat Pay',
    payment_alipayQr: 'QR Alipay',
    payment_uploadWechat: 'رفع QR WeChat',
    payment_uploadAlipay: 'رفع QR Alipay',
    payment_internationalInfo: 'قم بإعداد طرق الدفع. سيدفع المشتري لك مباشرة',
    payment_creditCard: 'بطاقة ائتمان',
    payment_creditCardDesc: 'الاستلام عبر Stripe',
    payment_web3Wallet: 'محفظة Web3',
    payment_web3WalletDesc: 'استلام عملات مشفرة',
    payment_walletPlaceholder: 'عنوان المحفظة (0x...)',
    payment_pointsPricing: 'تسعير النقاط',
    payment_rwadPricing: 'تسعير RWAD',
    payment_comingSoon: 'قريباً',

    common_cancel: 'إلغاء',
    common_confirm: 'تأكيد',
    common_save: 'حفظ',
    common_delete: 'حذف',
    common_edit: 'تعديل',
    common_back: 'رجوع',
    common_next: 'التالي',
    common_skip: 'تخطي',
    common_loading: 'جاري التحميل...',

    langSelector_welcome: 'Welcome to UniMaker',
    langSelector_selectLanguage: 'يرجى اختيار لغتك',
    langSelector_continue: 'متابعة',
    langSelector_selectPrompt: 'اختر اللغة',
    langSelector_skipDefault: 'تخطي',

    sidebar_trading: 'تداول DEX',
    trading_chart: 'الرسم البياني',
    trading_orderBook: 'دفتر الطلبات',
    trading_recentTrades: 'الصفقات',
    trading_price: 'السعر',
    trading_amount: 'الكمية',
    trading_time: 'الوقت',
    trading_limit: 'محدد',
    trading_market: 'سوق',
    trading_buy: 'شراء',
    trading_sell: 'بيع',
    trading_wallet: 'محفظة Web3',
    trading_totalAssets: 'إجمالي الأصول',
    trading_deposit: 'إيداع',
    trading_withdraw: 'سحب',
    trading_myAssets: 'أصولي',
};

export const translations: Record<LocaleCode, Translations> = {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    en,
    ja,
    ko,
    fr,
    de,
    ar,
};

export function getTranslations(locale: string): Translations {
    return translations[locale as LocaleCode] || translations['zh-CN'];
}

// Publish type key mapping
export const publishTypeKeys: Record<string, keyof Translations> = {
    content: 'publish_content',
    product: 'publish_ecommerce',
    live: 'publish_live',
    app: 'publish_app',
    food: 'publish_food',
    ride: 'publish_ride',
    job: 'publish_job',
    hire: 'publish_hire',
    rent: 'publish_rent',
    sell: 'publish_sell',
    secondhand: 'publish_secondhand',
    crowdfunding: 'publish_crowdfunding',
};
