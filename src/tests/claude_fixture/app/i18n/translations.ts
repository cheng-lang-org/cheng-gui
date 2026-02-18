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
    home_sortByDistance: string;
    home_smartSort: string;
    home_customSort: string;
    home_tabSettings: string;
    home_done: string;
    home_distanceSortPermissionDeniedFallback: string;
    content_location_openInMap: string;
    content_location_noCoordinates: string;
    content_location_openFailed: string;

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

    // C2C (RWAD escrow)
    c2c_state_draft: string;
    c2c_state_listed: string;
    c2c_state_lockPending: string;
    c2c_state_locked: string;
    c2c_state_delivering: string;
    c2c_state_settling: string;
    c2c_state_released: string;
    c2c_state_refunded: string;
    c2c_state_expired: string;
    c2c_state_failed: string;
    c2c_err_invalidEscrow: string;
    c2c_err_sellerMismatch: string;
    c2c_err_listingNotFound: string;
    c2c_err_qtyOutOfRange: string;
    c2c_err_invalidAmount: string;
    c2c_err_publishFailed: string;
    c2c_err_unknown: string;
    c2c_err_runtimeUnavailable: string;
    c2c_err_selectWalletAndListing: string;
    c2c_err_walletMissing: string;
    c2c_err_missingAssetId: string;
    c2c_action_orderFailed: string;
    c2c_action_publishFailed: string;
    c2c_action_deliverFailed: string;

    // Wallet
    wallet_import: string;
    wallet_importTitle: string;
    wallet_ph: string;
    wallet_cancel: string;
    wallet_confirm: string;
    wallet_success: string;
    wallet_tos_title: string;
    wallet_tos_1: string;
    wallet_tos_2: string;
    wallet_tos_3: string;
    wallet_tos_agree: string;

    // Channel Manager
    channel_manage: string;
    channel_tip: string;

    // Messages Page
    msg_title: string;
    msg_conversations: string;
    msg_contacts: string;
    msg_moments: string;
    msg_notifications: string;
    msg_noMessages: string;
    msg_noContacts: string;
    msg_noMoments: string;
    msg_noNotifications: string;
    msg_tapToChat: string;
    msg_groupChat: string;
    msg_status: string;
    msg_noTextContent: string;
    msg_notification: string;
    msg_minutesAgo: string;
    msg_hoursAgo: string;
    msg_daysAgo: string;
    msg_asiName: string;
    msg_asiGreeting: string;

    // Chat Page
    chat_backToList: string;
    chat_groupChat: string;
    chat_directChat: string;
    chat_noMessages: string;
    chat_redPacket: string;
    chat_redPacketAmount: string;
    chat_locationShare: string;
    chat_voiceMessage: string;
    chat_startedVideoCall: string;
    chat_switchedToVoice: string;
    chat_voiceInput: string;
    chat_inputPlaceholder: string;
    chat_emojiPanel: string;
    chat_sendMessage: string;
    chat_moreFeatures: string;
    chat_location: string;
    chat_videoCall: string;
    chat_invitePeople: string;
    chat_voiceCall: string;
    chat_groupApps: string;
    chat_sendRedPacket: string;
    chat_closeRedPacket: string;
    chat_amount: string;
    chat_enterAmount: string;
    chat_greeting: string;
    chat_greetingPlaceholder: string;
    chat_sendRedPacketBtn: string;
    chat_sendLocation: string;
    chat_closeLocation: string;
    chat_locationPreview: string;
    chat_enterLocationName: string;
    chat_sendCurrentLocation: string;
    chat_closeGroupApps: string;
    chat_launch: string;
    chat_goToMarket: string;
    chat_navigatingToMarket: string;
    chat_launchedApp: string;
    chat_emojiFunctionDev: string;
    chat_videoCallInvite: string;
    chat_inviteContacts: string;
    chat_voiceCallInvite: string;
    chat_movieApp: string;
    chat_mahjongApp: string;
    chat_voteApp: string;
    chat_defaultGreeting: string;

    // Nodes Page
    nodes_detail: string;
    nodes_online: string;
    nodes_offline: string;
    nodes_hardwareTitle: string;
    nodes_os: string;
    nodes_cpu: string;
    nodes_memory: string;
    nodes_disk: string;
    nodes_gpu: string;
    nodes_connections: string;
    nodes_downlink: string;
    nodes_uplink: string;
    nodes_downlinkTotal: string;
    nodes_uplinkTotal: string;
    nodes_transferTotal: string;
    nodes_relayPath: string;
    nodes_bottleneck: string;
    nodes_probeRunning: string;
    nodes_yes: string;
    nodes_no: string;
    nodes_publishedContent: string;
    nodes_viewAllContent: string;
    nodes_sendMessage: string;
    nodes_backToList: string;
    nodes_noNodes: string;
    nodes_noNodesHint: string;
    nodes_sourceAll: string;
    nodes_sourceDirect: string;
    nodes_searchPlaceholder: string;
    nodes_cancelSearch: string;
    nodes_multiSelect: string;
    nodes_searchNodes: string;
    nodes_selectAll: string;
    nodes_deselectAll: string;
    nodes_selectedCount: string;
    nodes_createGroup: string;
    nodes_defaultNickname: string;
    nodes_instantMsg: string;
    nodes_nodeDiscovery: string;
    nodes_noBio: string;
    nodes_sourceUnknown: string;
    nodes_sourceLabel: string;
    nodes_noBootstrapNode: string;
    nodes_bootstrapFailed: string;
    nodes_groupChatSuffix: string;
    nodes_voiceInviteSent: string;
    nodes_videoInviteSent: string;
    nodes_groupDraftCreated: string;
    nodes_directSessionCreated: string;
    nodes_voiceInviteMsg: string;
    nodes_videoInviteMsg: string;
    nodes_groupDraftMsg: string;
    nodes_directSessionMsg: string;
    nodes_invalidPeerId: string;
    nodes_nodeExists: string;
    nodes_manuallyAdded: string;
    nodes_connectFailed: string;
    nodes_sourceMdns: string;
    nodes_sourceRendezvous: string;
    nodes_globalComputeTitle: string;
    nodes_totalNodes: string;
    nodes_onlineNodes: string;
    nodes_totalCpuCores: string;
    nodes_totalMemory: string;
    nodes_totalDiskAvailable: string;
    nodes_totalGpuVram: string;
    nodes_totalDownlink: string;
    nodes_totalUplink: string;
    nodes_diag_title: string;
    nodes_diag_runtime: string;
    nodes_diag_runtime_ready: string;
    nodes_diag_runtime_starting: string;
    nodes_diag_runtime_notReady: string;
    nodes_diag_connected_peers: string;
    nodes_diag_mdns_peers: string;
    nodes_diag_candidates: string;
    nodes_diag_peer_id: string;
    nodes_diag_last_error: string;

    // Profile Page
    profile_web3Wallet: string;
    profile_walletCount: string;
    profile_createOrImport: string;
    profile_transactionHistory: string;
    profile_recordCount: string;
    profile_noRecords: string;
    profile_baziTitle: string;
    profile_baziDesc: string;
    profile_ziweiTitle: string;
    profile_ziweiDesc: string;
    profile_points: string;
    profile_rwad: string;
    profile_recharge: string;
    profile_transfer: string;
    profile_amountLabel: string;
    profile_enterAmount: string;
    profile_targetAddress: string;
    profile_enterTargetAddress: string;
    profile_confirm: string;
    profile_transferDomain: string;
    profile_currentDomain: string;
    profile_enterReceiverAddress: string;
    profile_confirmTransfer: string;
    profile_back: string;
    profile_addressManagement: string;
    profile_noAddress: string;
    profile_noAddressHint: string;
    profile_defaultTag: string;
    profile_setDefault: string;
    profile_edit: string;
    profile_delete: string;
    profile_addAddress: string;
    profile_editAddress: string;
    profile_recipient: string;
    profile_recipientPlaceholder: string;
    profile_phone: string;
    profile_phonePlaceholder: string;
    profile_mapSelect: string;
    profile_regionSelect: string;
    profile_regionSelectHint: string;
    profile_address: string;
    profile_addressPlaceholder: string;
    profile_currentLocation: string;
    profile_locating: string;
    profile_locationService: string;
    profile_use: string;
    profile_doorNumber: string;
    profile_doorNumberPlaceholder: string;
    profile_addressClipboard: string;
    profile_clipboardPlaceholder: string;
    profile_clipboardTitle: string;
    profile_setAsDefault: string;
    profile_setAsDefaultHint: string;
    profile_tagLabel: string;
    profile_tagSchool: string;
    profile_tagHome: string;
    profile_tagCompany: string;
    profile_tagShopping: string;
    profile_tagDelivery: string;
    profile_tagCustom: string;
    profile_walletTitle: string;
    profile_close: string;
    profile_walletWarning: string;
    profile_myWallets: string;
    profile_loading: string;
    profile_export: string;
    profile_deleteWallet: string;
    profile_doNotLeak: string;
    profile_mnemonic: string;
    profile_privateKey: string;
    profile_showHide: string;
    profile_show: string;
    profile_hide: string;
    profile_createWallet: string;
    profile_importWallet: string;
    profile_evmSolanaHint: string;
    profile_createEvmSolana: string;
    profile_createBtc: string;
    profile_creating: string;
    profile_selectChain: string;
    profile_walletAlias: string;
    profile_walletAliasPlaceholder: string;
    profile_mnemonicOrKey: string;
    profile_mnemonicOrKeyPlaceholder: string;
    profile_myWallet: string;
    profile_importing: string;
    profile_importTo: string;
    profile_backToList: string;
    profile_txPointsRecharge: string;
    profile_txPointsTransfer: string;
    profile_txRwadRecharge: string;
    profile_txRwadTransfer: string;
    profile_txDomainRegister: string;
    profile_txDomainTransfer: string;
    profile_txStatus: string;
    profile_txDone: string;
    profile_txTime: string;
    profile_txTarget: string;
    profile_txId: string;
    profile_noTxRecords: string;
    profile_errInvalidAmount: string;
    profile_errOverseasRwadOnly: string;
    profile_errDomesticPointsOnly: string;
    profile_errInvalidTarget: string;
    profile_errInsufficientPoints: string;
    profile_errInsufficientRwad: string;
    profile_errDomainEmpty: string;
    profile_errDomainFormat: string;
    profile_errDomainPointsCost: string;
    profile_errDomainRwadCost: string;
    profile_errAddressIncomplete: string;
    profile_errImportInvalid: string;
    profile_errVerifyFirst: string;
    profile_errAcceptRisk: string;
    profile_walletImportSuccess: string;
    profile_evmSolanaSuccess: string;
    profile_errCreateFailed: string;
    profile_btcSuccess: string;
    profile_chainImportSuccess: string;
    profile_errImportFailed: string;
    profile_domesticNode: string;
    profile_overseasNode: string;
    profile_nodePeerId: string;
    profile_copied: string;
    profile_copy: string;
    profile_overseasRwadNote: string;
    profile_domesticPointsNote: string;
    profile_domainLabel: string;
    profile_domainInputPlaceholder: string;
    profile_registerDomain: string;
    profile_registerCostPoints: string;
    profile_registerCostRwad: string;

    // Profile — Errand & Rideshare
    profile_serviceWillingness: string;
    profile_serviceWillingnessHint: string;
    profile_errand: string;
    profile_errandOriginRange: string;
    profile_errandOriginHint: string;
    profile_errandDestRange: string;
    profile_errandDestHint: string;
    profile_rideshare: string;
    profile_rideshareRoute: string;
    profile_rideshareFrom: string;
    profile_rideshareTo: string;
    profile_rideshareHint: string;
    profile_distributedNode: string;
    profile_distributedNodeHint: string;
    profile_distributedNodeRewards: string;
    profile_rangeUnit: string;
    profile_rangeUnitM: string;
    profile_priceCpu: string;
    profile_priceMemory: string;
    profile_priceDisk: string;
    profile_priceGpu: string;
    profile_limitCpu: string;
    profile_limitMemory: string;
    profile_limitDisk: string;
    profile_limitGpu: string;
    profile_unitCpu: string;
    profile_unitMemory: string;
    profile_unitDisk: string;
    profile_unitGpu: string;
    profile_unitCore: string;
    profile_unitGB: string;
    profile_unitCard: string;
    profile_c2cMaker: string;
    profile_c2cMakerHint: string;
    profile_c2cFundType: string;
    profile_c2cDailyLimit: string;
    profile_c2cLimitPlaceholder: string;
    profile_dexSettings: string;
    profile_dexClob: string;
    profile_dexClobDesc: string;
    profile_dexBridge: string;
    profile_dexBridgeDesc: string;
    profile_c2cSpread: string;
    profile_c2cLimitLabel: string;
    profile_c2cBaseBps: string;
    profile_c2cMaxBps: string;
    profile_c2cPairs: string;
    profile_c2cPolicyReset: string;
    profile_c2cDexHint: string;

    // Publish Common
    pub_title: string;
    pub_description: string;
    pub_publish: string;
    pub_category: string;

    // Publish Content Wizard
    pubContent_selectType: string;
    pubContent_editContent: string;
    pubContent_sharePlaceholder: string;
    pubContent_uploadHint: string;
    pubContent_image: string;
    pubContent_video: string;
    pubContent_audio: string;
    pubContent_text: string;
    pubContent_ageRating: string;
    pubContent_ageRatingHint: string;
    pubContent_allAges: string;
    pubContent_age12: string;
    pubContent_age16: string;
    pubContent_age18: string;
    pubContent_allAgesDesc: string;
    pubContent_age12Desc: string;
    pubContent_age16Desc: string;
    pubContent_age18Desc: string;
    pubContent_riskDimension: string;
    pubContent_riskDimensionHint: string;
    pubContent_nudity: string;
    pubContent_nudityDesc: string;
    pubContent_violence: string;
    pubContent_violenceDesc: string;
    pubContent_drugs: string;
    pubContent_drugsDesc: string;
    pubContent_gambling: string;
    pubContent_gamblingDesc: string;
    pubContent_political: string;
    pubContent_politicalDesc: string;
    pubContent_none: string;
    pubContent_riskWarning: string;
    pubContent_riskHighWarning: string;
    pubContent_ageSuggestion: string;
    pubContent_riskLevel: string;
    pubContent_publishContent: string;
    pubContent_contentRating: string;
    pubContent_riskStatement: string;

    // Publish Product
    pubProduct_title: string;
    pubProduct_csvMode: string;
    pubProduct_manualMode: string;
    pubProduct_csvUploadHint: string;
    pubProduct_productImage: string;
    pubProduct_productName: string;
    pubProduct_productNamePh: string;
    pubProduct_productDesc: string;
    pubProduct_productDescPh: string;
    pubProduct_stock: string;
    pubProduct_stockPh: string;
    pubProduct_enableSku: string;
    pubProduct_color: string;
    pubProduct_addColor: string;
    pubProduct_size: string;
    pubProduct_addSize: string;

    // Publish Product Wizard
    pubProdWiz_clothing: string;
    pubProdWiz_beauty: string;
    pubProdWiz_food: string;
    pubProdWiz_digital: string;
    pubProdWiz_home: string;
    pubProdWiz_sports: string;
    pubProdWiz_books: string;
    pubProdWiz_other: string;

    // Publish Common (extra)
    pub_paidContent: string;
    pub_yuan: string;
    pub_location: string;
    pub_contact: string;
    pub_negotiable: string;
    pub_other: string;
    pub_uploadImage: string;
    pub_delete: string;
    pub_addReward: string;
    publish_location_collecting: string;
    publish_location_required_hint: string;
    publish_location_error_permissionDenied: string;
    publish_location_error_accuracyTooLow: string;
    publish_location_error_timeout: string;
    publish_location_error_unavailable: string;
    publish_location_error_unknown: string;
    publish_location_success: string;
    publish_location_failed: string;
    publish_location_retry: string;

    // Publish App
    pubApp_title: string;
    pubApp_icon: string;
    pubApp_name: string;
    pubApp_namePh: string;
    pubApp_desc: string;
    pubApp_descPh: string;
    pubApp_version: string;
    pubApp_versionPh: string;
    pubApp_pricing: string;
    pubApp_openSource: string;
    pubApp_repoUrl: string;
    pubApp_repoUrlPh: string;
    pubApp_categoryLabel: string;
    pubApp_catTools: string;
    pubApp_catSocial: string;
    pubApp_catGames: string;
    pubApp_catMedia: string;
    pubApp_catFinance: string;
    pubApp_catEducation: string;
    pubApp_file: string;
    pubApp_uploadHint: string;
    pubApp_iconHint: string;
    pubApp_pricePh: string;
    pubApp_hint: string;

    // Publish Food
    pubFood_title: string;
    pubFood_image: string;
    pubFood_name: string;
    pubFood_namePh: string;
    pubFood_type: string;
    pubFood_homeCooking: string;
    pubFood_baking: string;
    pubFood_dessert: string;
    pubFood_drink: string;
    pubFood_snack: string;
    pubFood_supplyTime: string;
    pubFood_supplyTimePh: string;
    pubFood_pickup: string;
    pubFood_pickupPh: string;
    pubFood_descPh: string;

    // Publish Ride
    pubRide_title: string;
    pubRide_offerSeat: string;
    pubRide_lookForSeat: string;
    pubRide_from: string;
    pubRide_to: string;
    pubRide_date: string;
    pubRide_time: string;
    pubRide_seats: string;
    pubRide_seatUnit: string;
    pubRide_costShare: string;
    pubRide_note: string;
    pubRide_notePlaceholder: string;
    pubRide_offerLabel: string;
    pubRide_lookForLabel: string;

    // Publish Job
    pubJob_title: string;
    pubJob_yourName: string;
    pubJob_desiredPosition: string;
    pubJob_positionPh: string;
    pubJob_jobType: string;
    pubJob_fullTime: string;
    pubJob_partTime: string;
    pubJob_intern: string;
    pubJob_remote: string;
    pubJob_experience: string;
    pubJob_experiencePh: string;
    pubJob_education: string;
    pubJob_selectEducation: string;
    pubJob_highSchool: string;
    pubJob_associate: string;
    pubJob_bachelor: string;
    pubJob_master: string;
    pubJob_phd: string;
    pubJob_expectedSalary: string;
    pubJob_salaryPh: string;
    pubJob_expectedCity: string;
    pubJob_cityPh: string;
    pubJob_skills: string;
    pubJob_addSkill: string;
    pubJob_add: string;
    pubJob_intro: string;
    pubJob_introPh: string;

    // Publish Hire
    pubHire_title: string;
    pubHire_companyName: string;
    pubHire_companyNamePh: string;
    pubHire_jobTitle: string;
    pubHire_jobTitlePh: string;
    pubHire_jobType: string;
    pubHire_salary: string;
    pubHire_salaryPh: string;
    pubHire_headcount: string;
    pubHire_headcountPh: string;
    pubHire_experience: string;
    pubHire_noLimit: string;
    pubHire_freshman: string;
    pubHire_exp1_3: string;
    pubHire_exp3_5: string;
    pubHire_exp5_10: string;
    pubHire_exp10Plus: string;
    pubHire_education: string;
    pubHire_location: string;
    pubHire_locationPh: string;
    pubHire_benefits: string;
    pubHire_jobDesc: string;
    pubHire_jobDescPh: string;
    pubHire_requirements: string;
    pubHire_requirementsPh: string;
    pubHire_salaryNegotiable: string;

    // Publish Rent
    pubRent_title: string;
    pubRent_image: string;
    pubRent_titleLabel: string;
    pubRent_titlePh: string;
    pubRent_type: string;
    pubRent_whole: string;
    pubRent_shared: string;
    pubRent_shortTerm: string;
    pubRent_shop: string;
    pubRent_office: string;
    pubRent_warehouse: string;
    pubRent_area: string;
    pubRent_areaPh: string;
    pubRent_rooms: string;
    pubRent_roomsPh: string;
    pubRent_cycle: string;
    pubRent_day: string;
    pubRent_week: string;
    pubRent_month: string;
    pubRent_year: string;
    pubRent_moveInDate: string;
    pubRent_address: string;
    pubRent_addressPh: string;
    pubRent_descPh: string;

    // Publish Sell
    pubSell_title: string;
    pubSell_image: string;
    pubSell_titleLabel: string;
    pubSell_titlePh: string;
    pubSell_type: string;
    pubSell_property: string;
    pubSell_vehicle: string;
    pubSell_land: string;
    pubSell_shop: string;
    pubSell_equipment: string;
    pubSell_locationPh: string;
    pubSell_contactPh: string;
    pubSell_descPh: string;

    // Publish Secondhand
    pubSecondhand_title: string;
    pubSecondhand_image: string;
    pubSecondhand_name: string;
    pubSecondhand_namePh: string;
    pubSecondhand_condition: string;
    pubSecondhand_condNew: string;
    pubSecondhand_condLikeNew: string;
    pubSecondhand_condLight: string;
    pubSecondhand_condHeavy: string;
    pubSecondhand_condRepair: string;
    pubSecondhand_catDigital: string;
    pubSecondhand_catClothing: string;
    pubSecondhand_catHome: string;
    pubSecondhand_catBooks: string;
    pubSecondhand_catSports: string;
    pubSecondhand_originalPrice: string;
    pubSecondhand_originalPricePh: string;
    pubSecondhand_cheaperBy: string;
    pubSecondhand_catLabel: string;
    pubSecondhand_descPh: string;

    // Publish Crowdfunding
    pubCrowdfund_title: string;
    pubCrowdfund_cover: string;
    pubCrowdfund_projectTitle: string;
    pubCrowdfund_projectTitlePh: string;
    pubCrowdfund_projectDesc: string;
    pubCrowdfund_projectDescPh: string;
    pubCrowdfund_minSupport: string;
    pubCrowdfund_endDate: string;
    pubCrowdfund_projectCategory: string;
    pubCrowdfund_catTech: string;
    pubCrowdfund_catDesign: string;
    pubCrowdfund_catFilm: string;
    pubCrowdfund_catMusic: string;
    pubCrowdfund_catGame: string;
    pubCrowdfund_catCharity: string;
    pubCrowdfund_catPublish: string;
    pubCrowdfund_rewardTier: string;
    pubCrowdfund_tierLabel: string;
    pubCrowdfund_supportAmount: string;
    pubCrowdfund_limitPh: string;
    pubCrowdfund_rewardDescPh: string;
    pubCrowdfund_addTier: string;
    pubCrowdfund_notice: string;
    pubCrowdfund_upload: string;
    pubCrowdfund_goalPrefix: string;
    pubCrowdfund_deadlinePrefix: string;

    // Publish Modal
    pubModal_title: string;

    // Live Stream
    live_title: string;

    // Content Detail
    contentDetail_views: string;
    contentDetail_likes: string;
    contentDetail_comments: string;

    // Product Detail
    productDetail_buy: string;
    productDetail_addToCart: string;

    // Fortune / Bazi / Ziwei
    fortune_title: string;
    fortune_birthTime: string;
    fortune_male: string;
    fortune_female: string;
    fortune_baziAnalysis: string;
    fortune_ziweiAnalysis: string;
    fortune_yearPillar: string;
    fortune_monthPillar: string;
    fortune_dayPillar: string;
    fortune_hourPillar: string;
    fortune_fiveElements: string;
    fortune_wood: string;
    fortune_fire: string;
    fortune_earth: string;
    fortune_metal: string;
    fortune_water: string;
    fortune_interpretation: string;
    fortune_mingGong: string;
    fortune_shenGong: string;
    fortune_mainStars: string;
    fortune_chartReading: string;
    fortune_askQuestion: string;
    fortune_freeAsk: string;
    fortune_paidAsk: string;
    fortune_followUpCost: string;
    fortune_payToUnlock: string;
    fortune_freeUsed: string;
    fortune_pay: string;
    fortune_cancel: string;
    fortune_bazi_title: string;
    fortune_bazi_yearGod: string;
    fortune_bazi_monthGod: string;
    fortune_bazi_hourGod: string;
    fortune_bazi_fourPillars: string;
    fortune_bazi_wuxing: string;
    fortune_bazi_shiShenTitle: string;
    fortune_bazi_dayMaster: string;
    fortune_bazi_dayMasterStrength: string;
    fortune_ziwei_title: string;
    fortune_ziwei_birthInfo: string;
    fortune_ziwei_year: string;
    fortune_ziwei_month: string;
    fortune_ziwei_day: string;
    fortune_ziwei_hour: string;
    fortune_ziwei_gender: string;
    fortune_ziwei_calculate: string;
    fortune_ziwei_mingGong: string;
    fortune_ziwei_shenGong: string;
    fortune_ziwei_twelvePalaces: string;
    fortune_ziwei_keyPalaces: string;
    fortune_ziwei_mainStarLabel: string;
    fortune_ziwei_auxStarLabel: string;
    fortune_ziwei_noMainStar: string;

    // App Marketplace
    appMkt_search: string;
    appMkt_installed: string;
    appMkt_install: string;
    appMkt_entertainment: string;
    appMkt_game: string;
    appMkt_tools: string;
    appMkt_education: string;

    // Nudity/Violence risk levels
    risk_none: string;
    risk_nudity1: string;
    risk_nudity2: string;
    risk_nudity3: string;
    risk_violence1: string;
    risk_violence2: string;
    risk_violence3: string;
    risk_drugs1: string;
    risk_drugs2: string;
    risk_drugs3: string;
    risk_gambling1: string;
    risk_gambling2: string;
    risk_gambling3: string;
    risk_political1: string;
    risk_political2: string;
    risk_political3: string;

    // Hire benefits
    hire_insurance: string;
    hire_paidLeave: string;
    hire_flexWork: string;
    hire_freeMeals: string;
    hire_teamBuilding: string;
    hire_stockOptions: string;
    hire_training: string;
    hire_yearEndBonus: string;

    // Sidebar — extra entries
    sidebar_appMarket: string;
    sidebar_checkUpdates: string;
    update_banner_title: string;
    update_banner_message: string;
    update_banner_details: string;
    update_banner_ack: string;
    update_center_title: string;
    update_center_subtitle: string;
    update_center_version_compare: string;
    update_center_previous_version: string;
    update_center_current_version: string;
    update_center_latest_version: string;
    update_center_upgraded_label: string;
    update_center_upgraded_to: string;
    update_center_state: string;
    update_center_manifest_sequence: string;
    update_center_manifest_id: string;
    update_center_attestation: string;
    update_center_last_checked: string;
    update_center_release_notes: string;
    update_center_release_published_at: string;
    update_center_show_details: string;
    update_center_hide_details: string;
    update_center_no_release_notes: string;
    update_center_vrf_status_none: string;
    update_center_vrf_status_waiting_carrier: string;
    update_center_vrf_status_waiting_history: string;
    update_center_vrf_status_confirmed: string;
    update_center_last_error: string;
    update_center_revoked_title: string;
    update_center_revoked_desc: string;
    update_center_staged_title: string;
    update_center_staged_desc: string;
    update_center_manual_check: string;
    update_center_check_no_remote_peers: string;
    update_center_open_store_upgrade: string;
    update_center_publisher_title: string;
    update_center_publisher_hint: string;
    update_center_publish_version: string;
    update_center_publish_version_code: string;
    update_center_publish_sequence: string;
    update_center_publish_artifact_uri: string;
    update_center_publish_artifact_sha256: string;
    update_center_publish_summary: string;
    update_center_publish_details: string;
    update_center_summary_placeholder: string;
    update_center_details_placeholder: string;
    update_center_publish_shell_required: string;
    update_center_publish_emergency: string;
    update_center_publish_manifest: string;
    update_center_publish_revoke: string;
    update_center_publish_killswitch: string;
    update_center_publish_key_missing: string;
    update_center_release_notes_required: string;
    update_center_version_code_invalid: string;
    update_center_artifact_uri_required: string;
    update_center_publish_manifest_success: string;
    update_center_publish_manifest_failed: string;
    update_center_publish_failed: string;

    // Profile — RWAD chain
    profile_refreshChainBalance: string;
    profile_rwadChainRechargeBlocked: string;
    profile_rwadChainTransferBlocked: string;
    profile_rwadChainDomainBlocked: string;
    profile_rwadWalletNotFound: string;
    profile_rwadChainRefreshFailed: string;
    profile_rwadWalletCreated: string;
    profile_createRwadWallet: string;
    profile_rwadMigrationHint: string;

    // C2C Trading Page
    c2c_title: string;
    c2c_buy: string;
    c2c_sell: string;
    c2c_all: string;
    c2c_bankCard: string;
    c2c_wechat: string;
    c2c_alipay: string;
    c2c_merchant: string;
    c2c_unitPrice: string;
    c2c_qtyLimit: string;
    c2c_action: string;
    c2c_orders: string;
    c2c_completionRate: string;
    c2c_quantity: string;
    c2c_limit: string;
    c2c_available: string;
    c2c_tradeLimit: string;
    c2c_paymentMethod: string;
    c2c_wantBuy: string;
    c2c_wantSell: string;
    c2c_inputAmount: string;
    c2c_needPay: string;
    c2c_willReceive: string;
    c2c_buyAction: string;
    c2c_sellAction: string;
    c2c_escrowNotice: string;

    // C2C V2 — escrow mode
    c2c_v2_title: string;
    c2c_v2_subtitle: string;
    c2c_v2_walletPrefix: string;
    c2c_v2_walletMissing: string;
    c2c_v2_buyAdsTitle: string;
    c2c_v2_noListings: string;
    c2c_v2_sellerPrefix: string;
    c2c_v2_remaining: string;
    c2c_v2_limitRange: string;
    c2c_v2_lockTitle: string;
    c2c_v2_qtyPlaceholder: string;
    c2c_v2_submitLock: string;
    c2c_v2_processing: string;
    c2c_v2_estimateLock: string;
    c2c_v2_publishTitle: string;
    c2c_v2_publishQtyPh: string;
    c2c_v2_publishPricePh: string;
    c2c_v2_publishExpiryPh: string;
    c2c_v2_publishBtn: string;
    c2c_v2_pendingTitle: string;
    c2c_v2_noPending: string;
    c2c_v2_orderPrefix: string;
    c2c_v2_deliverBtn: string;
    c2c_v2_myOrdersTitle: string;
    c2c_v2_noOrders: string;
    c2c_v2_orderSuccess: string;
    c2c_v2_publishSuccess: string;
    c2c_v2_deliverSuccess: string;

    // Dou Di Zhu (斗地主)
    ddz_title: string;
    ddz_you: string;
    ddz_cards: string;
    ddz_yourBid: string;
    ddz_thinking: string;
    ddz_noBid: string;
    ddz_grab: string;
    ddz_points: string;
    ddz_yourTurn: string;
    ddz_landlord: string;
    ddz_farmer: string;
    ddz_landlordWins: string;
    ddz_farmerWins: string;
    ddz_youWin: string;
    ddz_wins: string;
    ddz_playAgain: string;
    ddz_play: string;
    ddz_pass: string;
    ddz_invalidHand: string;
    ddz_cantBeat: string;
    ddz_mustPlay: string;

    // Chinese Chess (中国象棋)
    xq_title: string;
    xq_yourTurn: string;
    xq_opponentTurn: string;
    xq_aiThinking: string;
    xq_check: string;
    xq_youWin: string;
    xq_youLose: string;
    xq_playAgain: string;
    xq_moveCount: string;
    xq_red: string;
    xq_black: string;

    // 四人麻将
    mj_title: string;
    mj_yourTurn: string;
    mj_thinking: string;
    mj_draw: string;
    mj_youWin: string;
    mj_wins: string;
    mj_you: string;
    mj_remaining: string;
    mj_tiles: string;
    mj_discarded: string;
    mj_hu: string;
    mj_peng: string;
    mj_gang: string;
    mj_skip: string;
    mj_discard: string;
    mj_playAgain: string;

    // 狼人杀
    ww_title: string;
    ww_roleReveal: string;
    ww_nightWolf: string;
    ww_nightSeer: string;
    ww_nightWitch: string;
    ww_dayAnnounce: string;
    ww_dayVote: string;
    ww_wolfWin: string;
    ww_villageWin: string;
    ww_youAre: string;
    ww_confirm: string;
    ww_waiting: string;
    ww_selectKill: string;
    ww_kill: string;
    ww_selectCheck: string;
    ww_check: string;
    ww_beingKilled: string;
    ww_save: string;
    ww_poison: string;
    ww_skip: string;
    ww_youDead: string;
    ww_selectVote: string;
    ww_vote: string;
    ww_playAgain: string;
    ww_logEmpty: string;
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
    home_sortByDistance: '距离最近',
    home_smartSort: '智能排序',
    home_customSort: '自定义排序',
    home_tabSettings: '频道管理',
    home_done: '完成',
    home_distanceSortPermissionDeniedFallback: '定位不可用，已切换到“最热”排序',
    content_location_openInMap: '打开地图',
    content_location_noCoordinates: '该内容未携带有效坐标，无法导航',
    content_location_openFailed: '打开地图失败，请稍后重试',



    publish_content: '内容',
    publish_ecommerce: '电商',
    publish_live: '直播',
    publish_app: '应用',
    publish_food: '外卖',
    publish_ride: '顺风车',
    publish_job: '求职',
    publish_job_seekingSummary: '求职',
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

    sidebar_trading: '交易',
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
    c2c_state_draft: '草稿',
    c2c_state_listed: '已上架',
    c2c_state_lockPending: '锁仓待确认',
    c2c_state_locked: '已锁仓',
    c2c_state_delivering: '卖家交付中',
    c2c_state_settling: '结算中',
    c2c_state_released: '已完成',
    c2c_state_refunded: '已退款',
    c2c_state_expired: '已过期',
    c2c_state_failed: '失败',
    c2c_err_invalidEscrow: 'Escrow ID 校验失败',
    c2c_err_sellerMismatch: '卖家身份与订单不匹配',
    c2c_err_listingNotFound: '广告不存在或不可交易',
    c2c_err_qtyOutOfRange: '下单数量超出广告范围',
    c2c_err_invalidAmount: '请输入有效数量或金额',
    c2c_err_publishFailed: '消息发布失败，请稍后重试',
    c2c_err_unknown: '未知错误',
    c2c_err_runtimeUnavailable: 'C2C 网络层未就绪，请检查 libp2p / ingress。',
    c2c_err_selectWalletAndListing: '请选择 RWAD 钱包并选择广告。',
    c2c_err_walletMissing: '未找到 RWAD 签名身份，请先创建或导入 RWAD 钱包。',
    c2c_err_missingAssetId: '请输入 asset_id。',
    c2c_action_orderFailed: '下单失败',
    c2c_action_publishFailed: '上架失败',
    c2c_action_deliverFailed: '交付失败',

    wallet_import: '导入钱包',
    wallet_importTitle: '导入 Web3 钱包',
    wallet_ph: '输入私钥或助记词',
    wallet_cancel: '取消',
    wallet_confirm: '确认导入',
    wallet_success: '钱包导入成功！',
    wallet_tos_title: '⚠️ 非托管协议',
    wallet_tos_1: '我深刻理解，Unimaker 是非托管软件，官方绝对无法访问、也未备份我的私钥。',
    wallet_tos_2: '如果我丢失助记词或卸载 App，Unimaker 没有任何技术能力帮我找回，资金将永久丢失。',
    wallet_tos_3: '因我个人设备泄露或被黑客入侵导致的资金损失，与 Unimaker 无关。',
    wallet_tos_agree: '我已阅读并同意以上全部条款',

    channel_manage: '频道管理',

    channel_tip: '长按拖动排序，点击进入频道',

    // Messages
    msg_title: '消息',
    msg_conversations: '会话',
    msg_contacts: '通讯录',
    msg_moments: '朋友圈',
    msg_notifications: '通知',
    msg_noMessages: '暂无消息',
    msg_noContacts: '暂无联系人',
    msg_noMoments: '暂无朋友圈动态',
    msg_noNotifications: '暂无通知',
    msg_tapToChat: '点击进入对话',
    msg_groupChat: '群聊',
    msg_status: '状态',
    msg_noTextContent: '[无文本内容]',
    msg_notification: '通知',
    msg_minutesAgo: '分钟前',
    msg_hoursAgo: '小时前',
    msg_daysAgo: '天前',
    msg_asiName: 'ASI 助手',
    msg_asiGreeting: '我是 ASI (Artificial Super Intelligence) 助手。我可以帮助您处理各种任务，请随时吩咐。',

    // Chat
    chat_backToList: '返回聊天列表',
    chat_groupChat: '群聊',
    chat_directChat: '节点直连会话',
    chat_noMessages: '暂无消息，开始聊天吧',
    chat_redPacket: '红包',
    chat_redPacketAmount: '金额',
    chat_locationShare: '位置分享',
    chat_voiceMessage: '语音消息',
    chat_startedVideoCall: '发起了视频通话',
    chat_switchedToVoice: '已切换到语音输入',
    chat_voiceInput: '语音输入',
    chat_inputPlaceholder: '输入消息...',
    chat_emojiPanel: '表情',
    chat_sendMessage: '发送消息',
    chat_moreFeatures: '更多功能',
    chat_location: '位置',
    chat_videoCall: '视频通话',
    chat_invitePeople: '拉人进群',
    chat_voiceCall: '语音通话',
    chat_groupApps: '群应用',
    chat_sendRedPacket: '发红包',
    chat_closeRedPacket: '关闭红包窗口',
    chat_amount: '金额',
    chat_enterAmount: '输入金额',
    chat_greeting: '祝福语',
    chat_greetingPlaceholder: '恭喜发财，大吉大利',
    chat_sendRedPacketBtn: '发送红包',
    chat_sendLocation: '发送位置',
    chat_closeLocation: '关闭位置窗口',
    chat_locationPreview: '位置预览',
    chat_enterLocationName: '输入位置名称',
    chat_sendCurrentLocation: '发送当前位置',
    chat_closeGroupApps: '关闭群应用',
    chat_launch: '发起',
    chat_goToMarket: '+ 前往应用市场',
    chat_navigatingToMarket: '正在跳转应用市场...',
    chat_launchedApp: '已在群聊发起应用',
    chat_emojiFunctionDev: '表情面板功能开发中',
    chat_videoCallInvite: '已发起视频通话邀请',
    chat_inviteContacts: '已打开邀请联系人界面',
    chat_voiceCallInvite: '已发起语音通话邀请',
    chat_movieApp: '看电影',
    chat_mahjongApp: '四人麻将',
    chat_voteApp: '群投票',
    chat_defaultGreeting: '恭喜发财，大吉大利',

    // Nodes
    nodes_detail: '节点详情',
    nodes_online: '在线',
    nodes_offline: '离线',
    nodes_hardwareTitle: '硬件与系统采集',
    nodes_os: '操作系统',
    nodes_cpu: 'CPU',
    nodes_memory: '内存',
    nodes_disk: '硬盘',
    nodes_gpu: 'GPU',
    nodes_connections: '连接数',
    nodes_downlink: '下行带宽',
    nodes_uplink: '上行带宽',
    nodes_downlinkTotal: '下行总量',
    nodes_uplinkTotal: '上行总量',
    nodes_transferTotal: '总传输量',
    nodes_relayPath: '中继路径',
    nodes_bottleneck: '木桶带宽',
    nodes_probeRunning: '正在测量节点间带宽...',
    nodes_yes: '是',
    nodes_no: '否',
    nodes_publishedContent: '该节点发布内容',
    nodes_viewAllContent: '查看此节点发布的所有内容',
    nodes_sendMessage: '发消息',
    nodes_backToList: '返回节点列表',
    nodes_noNodes: '暂无可展示节点',
    nodes_noNodesHint: '节点将从网络自动发现或从聊天自动沉淀',
    nodes_sourceAll: '全部',
    nodes_sourceDirect: '直连',
    nodes_searchPlaceholder: '输入域名或 PeerId 搜索...',
    nodes_cancelSearch: '取消搜索',
    nodes_multiSelect: '多选建群',
    nodes_searchNodes: '搜索节点',
    nodes_selectAll: '全选',
    nodes_deselectAll: '取消全选',
    nodes_selectedCount: '已选',
    nodes_createGroup: '建群',
    nodes_defaultNickname: '节点',
    nodes_instantMsg: '即时消息',
    nodes_nodeDiscovery: '节点发现',
    nodes_noBio: '暂无节点简介',
    nodes_sourceUnknown: '未知',
    nodes_sourceLabel: '来源',
    nodes_noBootstrapNode: '暂无可用随机引导节点',
    nodes_bootstrapFailed: '随机引导连接失败',
    nodes_groupChatSuffix: '群聊',
    nodes_voiceInviteSent: '已发起语音邀请，正在进入聊天。',
    nodes_videoInviteSent: '已发起视频邀请，正在进入聊天。',
    nodes_groupDraftCreated: '已创建群聊草稿，可继续拉人。',
    nodes_directSessionCreated: '已建立节点直连会话',
    nodes_voiceInviteMsg: '已发起语音邀请',
    nodes_videoInviteMsg: '已发起视频邀请',
    nodes_groupDraftMsg: '已创建节点群聊草稿',
    nodes_directSessionMsg: '已建立节点直连会话',
    nodes_invalidPeerId: '请输入有效的 PeerId',
    nodes_nodeExists: '该节点已存在',
    nodes_manuallyAdded: '用户手动添加的节点',
    nodes_connectFailed: '连接节点失败',
    nodes_sourceMdns: '来源: mDNS / LAN',
    nodes_sourceRendezvous: '来源: Rendezvous / WAN',
    nodes_globalComputeTitle: '在网计算资源',
    nodes_totalNodes: '节点总数',
    nodes_onlineNodes: '在线节点',
    nodes_totalCpuCores: 'CPU总核数',
    nodes_totalMemory: '内存总量',
    nodes_totalDiskAvailable: '可用磁盘',
    nodes_totalGpuVram: 'GPU显存',
    nodes_totalDownlink: '总下行吞吐',
    nodes_totalUplink: '总上行吞吐',
    nodes_diag_title: '发现诊断',
    nodes_diag_runtime: '运行时',
    nodes_diag_runtime_ready: '已就绪',
    nodes_diag_runtime_starting: '启动中',
    nodes_diag_runtime_notReady: '未就绪',
    nodes_diag_connected_peers: '已连接节点',
    nodes_diag_mdns_peers: 'mDNS候选',
    nodes_diag_candidates: '发现候选',
    nodes_diag_peer_id: '本机PeerId',
    nodes_diag_last_error: '最近错误',

    // Profile
    profile_web3Wallet: 'Web3 钱包',
    profile_walletCount: '个钱包',
    profile_createOrImport: '创建或导入钱包',
    profile_transactionHistory: '交易记录',
    profile_recordCount: '条记录',
    profile_noRecords: '暂无记录',
    profile_baziTitle: '八字排盘',
    profile_baziDesc: '四柱 · 五行 · 十神分析',
    profile_ziweiTitle: '紫微斗数',
    profile_ziweiDesc: '十二宫 · 主星 · 四化排盘',
    profile_points: '积分',
    profile_rwad: 'RWAD',
    profile_recharge: '充值',
    profile_transfer: '转账',
    profile_amountLabel: '金额',
    profile_enterAmount: '输入金额',
    profile_targetAddress: '目标地址 / PeerId',
    profile_enterTargetAddress: '输入目标地址',
    profile_confirm: '确认',
    profile_transferDomain: '转让域名',
    profile_currentDomain: '当前域名',
    profile_enterReceiverAddress: '输入接收方地址或 PeerId',
    profile_confirmTransfer: '确认转让',
    profile_back: '返回',
    profile_addressManagement: '地址管理',
    profile_noAddress: '暂无收货地址',
    profile_noAddressHint: '点击下方按钮新增地址',
    profile_defaultTag: '默认',
    profile_setDefault: '默认地址',
    profile_edit: '编辑',
    profile_delete: '删除',
    profile_addAddress: '新增收货地址',
    profile_editAddress: '编辑收货地址',
    profile_recipient: '收货人',
    profile_recipientPlaceholder: '请填写收货人姓名',
    profile_phone: '手机号',
    profile_phonePlaceholder: '请填写收货人手机号',
    profile_mapSelect: '地图选址',
    profile_regionSelect: '地区选址',
    profile_regionSelectHint: '（含港澳台及海外）',
    profile_address: '地址',
    profile_addressPlaceholder: '选择收货地址',
    profile_currentLocation: '当前定位',
    profile_locating: '获取中...',
    profile_locationService: '定位服务',
    profile_use: '使用',
    profile_doorNumber: '门牌号',
    profile_doorNumberPlaceholder: '例：6栋201室',
    profile_addressClipboard: '地址粘贴板',
    profile_clipboardPlaceholder: '试试粘贴收件人姓名、手机号、收货地址，可快速识别您的收货信息',
    profile_clipboardTitle: '地址粘贴板',
    profile_setAsDefault: '设为默认地址',
    profile_setAsDefaultHint: '提醒：下单时会优先使用该地址',
    profile_tagLabel: '标签',
    profile_tagSchool: '学校',
    profile_tagHome: '家',
    profile_tagCompany: '公司',
    profile_tagShopping: '购物',
    profile_tagDelivery: '秒送/外卖',
    profile_tagCustom: '自定义',
    profile_walletTitle: 'Web3 钱包',
    profile_close: '关闭',
    profile_walletWarning: '⚠️ 私钥保存在本地 localStorage 中，请确保浏览器数据安全。',
    profile_myWallets: '我的钱包',
    profile_loading: '加载中...',
    profile_export: '导出',
    profile_deleteWallet: '删除',
    profile_doNotLeak: '⚠️ 请勿泄露以下信息',
    profile_mnemonic: '助记词',
    profile_privateKey: '私钥',
    profile_showHide: '显示/隐藏',
    profile_show: '显示',
    profile_hide: '隐藏',
    profile_createWallet: '创建钱包',
    profile_importWallet: '导入钱包',
    profile_evmSolanaHint: 'EVM 与 Solana 共用一套助记词，BTC 独立',
    profile_createEvmSolana: '创建 EVM + Solana 钱包',
    profile_createBtc: '创建 BTC 钱包',
    profile_creating: '创建中...',
    profile_selectChain: '选择链',
    profile_walletAlias: '钱包别名',
    profile_walletAliasPlaceholder: '例如：主钱包',
    profile_mnemonicOrKey: '助记词或私钥',
    profile_mnemonicOrKeyPlaceholder: '输入 12/24 个单词的助记词，或十六进制私钥',
    profile_myWallet: '我的钱包',
    profile_importing: '导入中...',
    profile_importTo: '导入到',
    profile_backToList: '返回列表',
    profile_txPointsRecharge: '积分充值',
    profile_txPointsTransfer: '积分转账',
    profile_txRwadRecharge: 'RWAD 充值',
    profile_txRwadTransfer: 'RWAD 转账',
    profile_txDomainRegister: '域名注册',
    profile_txDomainTransfer: '域名转让',
    profile_txStatus: '状态',
    profile_txDone: '完成',
    profile_txTime: '时间',
    profile_txTarget: '目标',
    profile_txId: '交易 ID',
    profile_noTxRecords: '暂无交易记录',
    profile_errInvalidAmount: '请输入有效金额',
    profile_errOverseasRwadOnly: '境外账号仅支持充值 RWAD',
    profile_errDomesticPointsOnly: '国内账号仅支持充值积分',
    profile_errInvalidTarget: '请输入有效的目标地址或 PeerId',
    profile_errInsufficientPoints: '积分余额不足',
    profile_errInsufficientRwad: 'RWAD 余额不足',
    profile_errDomainEmpty: '请输入要注册的域名前缀',
    profile_errDomainFormat: '域名仅支持小写字母、数字和中划线（2-32位）',
    profile_errDomainPointsCost: '注册需要 1 积分，当前余额不足',
    profile_errDomainRwadCost: '注册需要 1 RWAD，当前余额不足',
    profile_errAddressIncomplete: '请完整填写收货信息',
    profile_errImportInvalid: '导入信息无效',
    profile_errVerifyFirst: '请先校验并预览地址',
    profile_errAcceptRisk: '请先确认本地保管风险',
    profile_walletImportSuccess: '钱包导入成功，已完成地址绑定。',
    profile_evmSolanaSuccess: 'EVM + Solana 钱包创建成功（共用助记词）！',
    profile_errCreateFailed: '创建失败',
    profile_btcSuccess: 'BTC 钱包创建成功！',
    profile_chainImportSuccess: '钱包导入成功！',
    profile_errImportFailed: '导入失败',
    profile_domesticNode: '国内节点',
    profile_overseasNode: '境外节点',
    profile_nodePeerId: '节点 PeerId',
    profile_copied: '已复制',
    profile_copy: '复制',
    profile_overseasRwadNote: '境外账号可充值 RWAD',
    profile_domesticPointsNote: '国内账号可充值积分',
    profile_domainLabel: '域名',
    profile_domainInputPlaceholder: '输入域名前缀，例如 mynode',
    profile_registerDomain: '注册域名',
    profile_registerCostPoints: '1 积分',
    profile_registerCostRwad: '1 RWAD',

    profile_serviceWillingness: '接单',
    profile_serviceWillingnessHint: '开启后，附近用户发布的跑腿/外卖订单将推送给您',
    profile_errand: '跑腿',
    profile_errandOriginRange: '起点距离范围（公里）',
    profile_errandOriginHint: '接单人距离取货点的最大范围',
    profile_errandDestRange: '终点距离范围（公里）',
    profile_errandDestHint: '取货点到送达地的最大配送距离',
    profile_rideshare: '顺风车',
    profile_rideshareRoute: '常用路线',
    profile_rideshareFrom: '出发地',
    profile_rideshareTo: '目的地',
    profile_rideshareHint: '设置后，沿途用户发布的顺风车请求将推送给您',
    profile_distributedNode: '分布式计算存储节点',
    profile_distributedNodeHint: '任务价格随市场波动实时变动。发起任务时会确认具体价格和收益。请设置您的资源贡献上限。',
    profile_distributedNodeRewards: '收益模式：按需付费',
    profile_priceCpu: 'CPU系统出价',
    profile_priceMemory: '内存系统出价',
    profile_priceDisk: '硬盘系统出价',
    profile_priceGpu: 'GPU系统出价',
    profile_limitCpu: 'CPU上限',
    profile_limitMemory: '内存上限',
    profile_limitDisk: '硬盘上限',
    profile_limitGpu: 'GPU上限',
    profile_unitCpu: '积分/核·时',
    profile_unitMemory: '积分/GB·时',
    profile_unitDisk: '积分/GB·天',
    profile_unitGpu: '积分/卡·时',
    profile_unitCore: '核',
    profile_unitGB: 'GB',
    profile_unitCard: '卡',
    profile_rangeUnit: 'km',
    profile_rangeUnitM: 'm',
    profile_c2cMaker: 'C2C做市商',
    profile_c2cMakerHint: '开启后，做市商将自动接单',
    profile_c2cFundType: '资金类型',
    profile_c2cDailyLimit: '每日成交限额',
    profile_c2cLimitPlaceholder: '输入限额',
    profile_dexSettings: 'DEX 设置',
    profile_dexClob: '订单簿交易 (CLOB)',
    profile_dexClobDesc: '启用中央订单簿。关闭后将熔断 DEX 交易。',
    profile_dexBridge: 'C2C 联动桥',
    profile_dexBridgeDesc: '开启 C2C-DEX 桥接。关闭则为纯 DEX 模式。',
    profile_c2cSpread: '价差(bps)',
    profile_c2cLimitLabel: '限额',
    profile_c2cBaseBps: '基准 bps',
    profile_c2cMaxBps: '最大 bps',
    profile_c2cPairs: '交易对',
    profile_c2cPolicyReset: '策略重置：CN (Asia/Shanghai 00:00) / INTL (UTC 00:00)',
    profile_c2cDexHint: '开启 C2C 做市商后显示 DEX 设置，已保存配置会继续保留。',
    // Publish Common
    pub_title: '标题',
    pub_description: '描述',
    pub_publish: '发布',
    pub_category: '分类',

    // Publish Content Wizard
    pubContent_selectType: '选择内容类型',
    pubContent_editContent: '编辑内容',
    pubContent_sharePlaceholder: '分享你的想法...',
    pubContent_uploadHint: '点击上传',
    pubContent_image: '图片',
    pubContent_video: '视频',
    pubContent_audio: '音频',
    pubContent_text: '文字',
    pubContent_ageRating: '内容分级',
    pubContent_ageRatingHint: '选择适合观看的年龄范围',
    pubContent_allAges: '全年龄',
    pubContent_age12: '12岁以上',
    pubContent_age16: '16岁以上',
    pubContent_age18: '18岁以上',
    pubContent_allAgesDesc: '适合所有人群观看',
    pubContent_age12Desc: '包含轻度惊吓或暴力元素',
    pubContent_age16Desc: '包含明显暴力或暗示内容',
    pubContent_age18Desc: '成人内容，需要门禁确认',
    pubContent_riskDimension: '风险维度声明',
    pubContent_riskDimensionHint: '标注内容可能涉及的敏感领域',
    pubContent_nudity: '裸露/性',
    pubContent_nudityDesc: '是否包含裸露或性暗示内容？',
    pubContent_violence: '暴力/血腥',
    pubContent_violenceDesc: '是否包含暴力或血腥场景？',
    pubContent_drugs: '毒品相关',
    pubContent_drugsDesc: '是否涉及毒品内容？',
    pubContent_gambling: '赌博相关',
    pubContent_gamblingDesc: '是否涉及赌博内容？',
    pubContent_political: '政治敏感',
    pubContent_politicalDesc: '是否涉及政治敏感话题？',
    pubContent_none: '无',
    pubContent_riskWarning: '您标注的风险等级较高，内容可能在部分地区受到限制展示。',
    pubContent_riskHighWarning: '您标注的风险等级较高，内容可能在部分地区受到限制展示。',
    pubContent_ageSuggestion: '建议：如果不确定分级，请选择更高的年龄限制，以减少下架和争议风险。',
    pubContent_riskLevel: '等级',
    pubContent_publishContent: '发布内容',
    pubContent_contentRating: '内容分级',
    pubContent_riskStatement: '风险声明',

    // Publish Product
    pubProduct_title: '发布商品',
    pubProduct_csvMode: 'CSV批量',
    pubProduct_manualMode: '手动填写',
    pubProduct_csvUploadHint: '上传CSV文件批量导入商品',
    pubProduct_productImage: '商品图片',
    pubProduct_productName: '商品名称',
    pubProduct_productNamePh: '请输入商品名称',
    pubProduct_productDesc: '商品描述',
    pubProduct_productDescPh: '详细描述商品信息...',
    pubProduct_stock: '库存',
    pubProduct_stockPh: '请输入库存数量',
    pubProduct_enableSku: '启用多规格（SKU）',
    pubProduct_color: '颜色',
    pubProduct_addColor: '添加颜色',
    pubProduct_size: '尺寸',
    pubProduct_addSize: '添加尺寸',

    // Publish Product Wizard
    pubProdWiz_clothing: '服装服饰',
    pubProdWiz_beauty: '美妆个护',
    pubProdWiz_food: '食品饮料',
    pubProdWiz_digital: '数码电子',
    pubProdWiz_home: '家居用品',
    pubProdWiz_sports: '运动户外',
    pubProdWiz_books: '图书文创',
    pubProdWiz_other: '其他类目',

    // Publish Common (extra)
    pub_paidContent: '付费内容',
    pub_yuan: '元',
    pub_location: '所在地',
    pub_contact: '联系方式',
    pub_negotiable: '可议价',
    pub_other: '其他',
    pub_uploadImage: '上传图片',
    pub_delete: '删除',
    pub_addReward: '添加',
    publish_location_collecting: '定位采集中...',
    publish_location_required_hint: '发布时将实时采集高精度 GPS（<=50m），不满足将阻止发布',
    publish_location_error_permissionDenied: '定位权限被拒绝，无法发布',
    publish_location_error_accuracyTooLow: '定位精度不足（需 <= 50m），请到开阔区域后重试',
    publish_location_error_timeout: '定位超时，请重试',
    publish_location_error_unavailable: '定位服务不可用，请检查 GPS 设置',
    publish_location_error_unknown: '定位失败，发布未完成',
    publish_location_success: '已获取位置',
    publish_location_failed: '定位失败',
    publish_location_retry: '重试',

    // Publish App
    pubApp_title: '发布应用',
    pubApp_icon: '应用图标',
    pubApp_name: '应用名称',
    pubApp_namePh: '输入应用名称',
    pubApp_desc: '应用描述',
    pubApp_descPh: '描述应用功能和特色...',
    pubApp_version: '版本号',
    pubApp_versionPh: '如：1.0.0',
    pubApp_pricing: '应用收费',
    pubApp_openSource: '开源项目',
    pubApp_repoUrl: '仓库地址',
    pubApp_repoUrlPh: 'https://github.com/...',
    pubApp_categoryLabel: '应用分类',
    pubApp_catTools: '工具',
    pubApp_catSocial: '社交',
    pubApp_catGames: '游戏',
    pubApp_catMedia: '媒体',
    pubApp_catFinance: '金融',
    pubApp_catEducation: '教育',
    pubApp_file: '应用文件',
    pubApp_uploadHint: '上传 ZIP/APK/IPA/WASM',
    pubApp_iconHint: '建议 512x512 PNG',
    pubApp_pricePh: '输入应用价格',
    pubApp_hint: '应用将通过去中心化网络分发，确保你的应用符合平台规范。',

    // Publish Food
    pubFood_title: '发布美食',
    pubFood_image: '美食图片',
    pubFood_name: '美食名称',
    pubFood_namePh: '输入美食名称',
    pubFood_type: '美食类型',
    pubFood_homeCooking: '家常菜',
    pubFood_baking: '烘焙',
    pubFood_dessert: '甜点',
    pubFood_drink: '饮品',
    pubFood_snack: '小吃',
    pubFood_supplyTime: '供应时间',
    pubFood_supplyTimePh: '如：每天 11:00-14:00',
    pubFood_pickup: '取餐地址',
    pubFood_pickupPh: '取餐/配送地址',
    pubFood_descPh: '描述美食特点、食材...',

    // Publish Ride
    pubRide_title: '发布顺风车',
    pubRide_offerSeat: '我有车位',
    pubRide_lookForSeat: '我找车位',
    pubRide_from: '出发地',
    pubRide_to: '目的地',
    pubRide_date: '日期',
    pubRide_time: '时间',
    pubRide_seats: '空余座位',
    pubRide_seatUnit: '座',
    pubRide_costShare: '费用分摊 (每人)',
    pubRide_note: '备注',
    pubRide_notePlaceholder: '如：可绕路接送、不接受宠物等...',
    pubRide_offerLabel: '车找人',
    pubRide_lookForLabel: '人找车',

    // Publish Job
    pubJob_title: '发布求职',
    pubJob_yourName: '您的姓名',
    pubJob_desiredPosition: '期望职位',
    pubJob_positionPh: '如：前端工程师',
    pubJob_jobType: '工作类型',
    pubJob_fullTime: '全职',
    pubJob_partTime: '兼职',
    pubJob_intern: '实习',
    pubJob_remote: '远程',
    pubJob_experience: '工作经验',
    pubJob_experiencePh: '如：3年',
    pubJob_education: '学历',
    pubJob_selectEducation: '选择学历',
    pubJob_highSchool: '高中',
    pubJob_associate: '大专',
    pubJob_bachelor: '本科',
    pubJob_master: '硕士',
    pubJob_phd: '博士',
    pubJob_expectedSalary: '期望薪资',
    pubJob_salaryPh: '如：15-20K',
    pubJob_expectedCity: '期望城市',
    pubJob_cityPh: '如：北京',
    pubJob_skills: '技能标签',
    pubJob_addSkill: '添加技能',
    pubJob_add: '添加',
    pubJob_intro: '个人介绍',
    pubJob_introPh: '简单介绍自己的工作经历和优势...',

    // Publish Hire
    pubHire_title: '发布招聘',
    pubHire_companyName: '公司名称',
    pubHire_companyNamePh: '您的公司名称',
    pubHire_jobTitle: '招聘职位',
    pubHire_jobTitlePh: '输入职位名称',
    pubHire_jobType: '工作类型',
    pubHire_salary: '薪资范围 (K)',
    pubHire_salaryPh: '如: 15-25',
    pubHire_headcount: '招聘人数',
    pubHire_headcountPh: '输入人数',
    pubHire_experience: '经验要求',
    pubHire_noLimit: '不限',
    pubHire_freshman: '应届生',
    pubHire_exp1_3: '1-3年',
    pubHire_exp3_5: '3-5年',
    pubHire_exp5_10: '5-10年',
    pubHire_exp10Plus: '10年以上',
    pubHire_education: '学历要求',
    pubHire_location: '工作地点',
    pubHire_locationPh: '输入工作地点',
    pubHire_benefits: '福利待遇',
    pubHire_jobDesc: '职位描述',
    pubHire_jobDescPh: '输入职位描述...',
    pubHire_requirements: '任职要求',
    pubHire_requirementsPh: '输入任职要求...',
    pubHire_salaryNegotiable: '薪资面议',

    // Publish Rent
    pubRent_title: '发布出租',
    pubRent_image: '房源图片',
    pubRent_titleLabel: '房源标题',
    pubRent_titlePh: '输入房源标题',
    pubRent_type: '出租类型',
    pubRent_whole: '整租',
    pubRent_shared: '合租',
    pubRent_shortTerm: '短租',
    pubRent_shop: '商铺',
    pubRent_office: '办公室',
    pubRent_warehouse: '仓库',
    pubRent_area: '面积 (㎡)',
    pubRent_areaPh: '输入面积',
    pubRent_rooms: '户型',
    pubRent_roomsPh: '如: 2室1厅',
    pubRent_cycle: '租金周期',
    pubRent_day: '天',
    pubRent_week: '周',
    pubRent_month: '月',
    pubRent_year: '年',
    pubRent_moveInDate: '可入住日期',
    pubRent_address: '地址',
    pubRent_addressPh: '输入详细地址',
    pubRent_descPh: '描述房源特点、配套设施...',

    // Publish Sell
    pubSell_title: '发布出售',
    pubSell_image: '物品图片',
    pubSell_titleLabel: '标题',
    pubSell_titlePh: '输入标题',
    pubSell_type: '出售类型',
    pubSell_property: '房产',
    pubSell_vehicle: '车辆',
    pubSell_land: '土地',
    pubSell_shop: '商铺',
    pubSell_equipment: '设备',
    pubSell_locationPh: '所在城市/地区',
    pubSell_contactPh: '电话或微信',
    pubSell_descPh: '详细描述...',

    // Publish Secondhand
    pubSecondhand_title: '发布闲置',
    pubSecondhand_image: '物品图片',
    pubSecondhand_name: '物品名称',
    pubSecondhand_namePh: '输入物品名称',
    pubSecondhand_condition: '成色',
    pubSecondhand_condNew: '全新',
    pubSecondhand_condLikeNew: '几乎全新',
    pubSecondhand_condLight: '轻微使用',
    pubSecondhand_condHeavy: '明显使用',
    pubSecondhand_condRepair: '需维修',
    pubSecondhand_catDigital: '数码',
    pubSecondhand_catClothing: '服饰',
    pubSecondhand_catHome: '家居',
    pubSecondhand_catBooks: '图书',
    pubSecondhand_catSports: '运动',
    pubSecondhand_originalPrice: '原价（可选）',
    pubSecondhand_originalPricePh: '原价',
    pubSecondhand_cheaperBy: '比原价便宜',
    pubSecondhand_catLabel: '分类',
    pubSecondhand_descPh: '描述物品详情、使用情况...',

    // Publish Crowdfunding
    pubCrowdfund_title: '发起众筹',
    pubCrowdfund_cover: '项目封面（最多5张）',
    pubCrowdfund_projectTitle: '项目标题',
    pubCrowdfund_projectTitlePh: '请输入众筹项目标题',
    pubCrowdfund_projectDesc: '项目描述',
    pubCrowdfund_projectDescPh: '详细介绍你的众筹项目...',
    pubCrowdfund_minSupport: '最低支持金额',
    pubCrowdfund_endDate: '众筹截止日期',
    pubCrowdfund_projectCategory: '项目分类',
    pubCrowdfund_catTech: '科技产品',
    pubCrowdfund_catDesign: '创意设计',
    pubCrowdfund_catFilm: '影视动画',
    pubCrowdfund_catMusic: '音乐专辑',
    pubCrowdfund_catGame: '游戏开发',
    pubCrowdfund_catCharity: '公益项目',
    pubCrowdfund_catPublish: '出版物',
    pubCrowdfund_rewardTier: '回报档位',
    pubCrowdfund_tierLabel: '档位',
    pubCrowdfund_supportAmount: '支持金额 ¥',
    pubCrowdfund_limitPh: '限量（留空不限）',
    pubCrowdfund_rewardDescPh: '回报内容描述',
    pubCrowdfund_addTier: '+ 添加回报档位',
    pubCrowdfund_notice: '众筹项目需经过审核后才会上线。若未达到目标金额，所有支持者将获得全额退款。',
    pubCrowdfund_upload: '上传',
    pubCrowdfund_goalPrefix: '目标',
    pubCrowdfund_deadlinePrefix: '截止',

    // Publish Modal
    pubModal_title: '选择发布类型',

    // Live Stream
    live_title: '直播',

    // Content Detail
    contentDetail_views: '浏览',
    contentDetail_likes: '点赞',
    contentDetail_comments: '评论',

    // Product Detail
    productDetail_buy: '立即购买',
    productDetail_addToCart: '加入购物车',

    // Fortune
    fortune_title: '命理分析',
    fortune_birthTime: '出生时间',
    fortune_male: '男',
    fortune_female: '女',
    fortune_baziAnalysis: '八字分析',
    fortune_ziweiAnalysis: '紫微斗数',
    fortune_yearPillar: '年柱',
    fortune_monthPillar: '月柱',
    fortune_dayPillar: '日柱',
    fortune_hourPillar: '时柱',
    fortune_fiveElements: '五行分布',
    fortune_wood: '木',
    fortune_fire: '火',
    fortune_earth: '土',
    fortune_metal: '金',
    fortune_water: '水',
    fortune_interpretation: '命理解读',
    fortune_mingGong: '命宫',
    fortune_shenGong: '身宫',
    fortune_mainStars: '主要星曜',
    fortune_chartReading: '命盘解读',
    fortune_askQuestion: '输入您想问的问题...',
    fortune_freeAsk: '免费提问一次',
    fortune_paidAsk: '付费提问',
    fortune_followUpCost: '追问需支付 10',
    fortune_payToUnlock: '需要付费解锁',
    fortune_freeUsed: '您的免费提问次数已用完，追问需支付 10',
    fortune_pay: '支付 10',
    fortune_cancel: '取消',
    fortune_bazi_title: '八字排盘',
    fortune_bazi_yearGod: '年干十神',
    fortune_bazi_monthGod: '月干十神',
    fortune_bazi_hourGod: '时干十神',
    fortune_bazi_fourPillars: '四柱排盘',
    fortune_bazi_wuxing: '五行分析',
    fortune_bazi_shiShenTitle: '十神 & 日主',
    fortune_bazi_dayMaster: '日主',
    fortune_bazi_dayMasterStrength: '日主强弱',
    fortune_ziwei_title: '紫微斗数',
    fortune_ziwei_birthInfo: '出生信息（农历）',
    fortune_ziwei_year: '年',
    fortune_ziwei_month: '月',
    fortune_ziwei_day: '日',
    fortune_ziwei_hour: '时辰',
    fortune_ziwei_gender: '性别',
    fortune_ziwei_calculate: '排盘',
    fortune_ziwei_mingGong: '命宫',
    fortune_ziwei_shenGong: '身宫',
    fortune_ziwei_twelvePalaces: '十二宫盘面',
    fortune_ziwei_keyPalaces: '重点宫位解读',
    fortune_ziwei_mainStarLabel: '主星',
    fortune_ziwei_auxStarLabel: '辅星',
    fortune_ziwei_noMainStar: '无主星',

    // App Marketplace
    appMkt_search: '搜索应用...',
    appMkt_installed: '已安装',
    appMkt_install: '安装',
    appMkt_entertainment: '娱乐',
    appMkt_game: '游戏',
    appMkt_tools: '工具',
    appMkt_education: '教育',

    // Risk levels
    risk_none: '无',
    risk_nudity1: '轻度暗示',
    risk_nudity2: '明确裸露',
    risk_nudity3: '色情内容',
    risk_violence1: '轻微打斗',
    risk_violence2: '明显受伤',
    risk_violence3: '强烈血腥',
    risk_drugs1: '仅提及',
    risk_drugs2: '展示使用',
    risk_drugs3: '制贩教学',
    risk_gambling1: '仅提及',
    risk_gambling2: '推广引导',
    risk_gambling3: '教学诈骗',
    risk_political1: '一般讨论',
    risk_political2: '争议表达',
    risk_political3: '极端动员',

    // Hire benefits
    hire_insurance: '五险一金',
    hire_paidLeave: '带薪年假',
    hire_flexWork: '弹性工作',
    hire_freeMeals: '免费餐饮',
    hire_teamBuilding: '团建活动',
    hire_stockOptions: '股票期权',
    hire_training: '培训机会',
    hire_yearEndBonus: '年终奖',

    // Sidebar — extra entries
    sidebar_appMarket: '应用市场',
    sidebar_checkUpdates: '检查更新',
    update_banner_title: '发现新版本',
    update_banner_message: '发现最新版本，正在后台自动更新',
    update_banner_details: '更新详情',
    update_banner_ack: '知道了',
    update_center_title: '更新中心',
    update_center_subtitle: 'V2 全网一致性更新',
    update_center_version_compare: '版本对比',
    update_center_previous_version: '上一版本',
    update_center_current_version: '当前版本',
    update_center_latest_version: '最新版本',
    update_center_upgraded_label: '已从',
    update_center_upgraded_to: '升级到',
    update_center_state: '状态',
    update_center_manifest_sequence: 'Manifest 序列',
    update_center_manifest_id: 'Manifest ID',
    update_center_attestation: '见证计数',
    update_center_last_checked: '最近检查',
    update_center_release_notes: '更新内容',
    update_center_release_published_at: '发布时间',
    update_center_show_details: '更新详情',
    update_center_hide_details: '收起详情',
    update_center_no_release_notes: '暂无更新内容',
    update_center_vrf_status_none: '未收到更新候选',
    update_center_vrf_status_waiting_carrier: '候选已收到，等待策略阈值',
    update_center_vrf_status_waiting_history: '已收到候选，等待历史链补齐',
    update_center_vrf_status_confirmed: '候选已确认',
    update_center_last_error: '最近失败原因',
    update_center_revoked_title: '当前更新已被撤销/止血',
    update_center_revoked_desc: '已自动阻断安装并清理暂存。',
    update_center_staged_title: '壳包已下载并暂存',
    update_center_staged_desc: '应用前台使用时不会强制打断，切到后台后会继续安装流程。iOS 需通过 App Store/TestFlight 完成壳包升级。',
    update_center_manual_check: '手动检查更新',
    update_center_check_no_remote_peers: '网络可用，但暂无可连接节点',
    update_center_open_store_upgrade: '打开 App Store / TestFlight 升级壳包',
    update_center_publisher_title: '发布节点操作',
    update_center_publisher_hint: '发布 Manifest 必须填写版本号、版本码和更新内容（摘要/详情）。',
    update_center_publish_version: '版本号',
    update_center_publish_version_code: '版本码',
    update_center_publish_sequence: '序列号',
    update_center_publish_artifact_uri: '安装包地址',
    update_center_publish_artifact_sha256: '安装包 SHA256（可选）',
    update_center_publish_summary: '更新摘要',
    update_center_publish_details: '更新详情',
    update_center_summary_placeholder: '例如：修复卡顿并优化节点同步',
    update_center_details_placeholder: '例如：1) 修复... 2) 优化... 3) 安全加固...',
    update_center_publish_shell_required: '需要壳包升级',
    update_center_publish_emergency: '紧急模式',
    update_center_publish_manifest: '发布 Manifest',
    update_center_publish_revoke: '发布 Revoke',
    update_center_publish_killswitch: '发布 KillSwitch',
    update_center_publish_key_missing: '缺少发布者密钥，请先在“发布者密钥配置”中填写并保存公钥/私钥',
    update_center_release_notes_required: '版本号、更新摘要、更新详情必须填写',
    update_center_version_code_invalid: '版本码必须是正整数',
    update_center_artifact_uri_required: '安装包地址不能为空',
    update_center_publish_manifest_success: 'Manifest 已发布',
    update_center_publish_manifest_failed: 'Manifest 发布失败',
    update_center_publish_failed: '发布失败',

    // Profile — RWAD chain
    profile_refreshChainBalance: '刷新链上余额',
    profile_rwadChainRechargeBlocked: 'RWAD 余额以链上为准，不支持本地充值。',
    profile_rwadChainTransferBlocked: 'RWAD 转账请使用链上交易流程。',
    profile_rwadChainDomainBlocked: 'RWAD 扣费已迁移链上，域名注册入口待接入。',
    profile_rwadWalletNotFound: '未找到 RWAD 钱包，请先创建或导入。',
    profile_rwadChainRefreshFailed: '链上余额刷新失败，请稍后重试。',
    profile_rwadWalletCreated: 'RWAD 钱包创建成功！',
    profile_createRwadWallet: '创建 RWAD 钱包',
    profile_rwadMigrationHint: 'RWAD 余额已切换为链上真相，本地账本不再生效。',

    // C2C Trading Page
    c2c_title: 'C2C交易',
    c2c_buy: '购买',
    c2c_sell: '出售',
    c2c_all: '全部',
    c2c_bankCard: '银行卡',
    c2c_wechat: '微信',
    c2c_alipay: '支付宝',
    c2c_merchant: '商家',
    c2c_unitPrice: '单价',
    c2c_qtyLimit: '数量/限额',
    c2c_action: '操作',
    c2c_orders: '单',
    c2c_completionRate: '完成率',
    c2c_quantity: '数量',
    c2c_limit: '限额',
    c2c_available: '可用数量',
    c2c_tradeLimit: '交易限额',
    c2c_paymentMethod: '支付方式',
    c2c_wantBuy: '我要购买',
    c2c_wantSell: '我要出售',
    c2c_inputAmount: '输入{crypto}数量',
    c2c_needPay: '需支付',
    c2c_willReceive: '将收到',
    c2c_buyAction: '购买 {crypto}',
    c2c_sellAction: '出售 {crypto}',
    c2c_escrowNotice: '智能合约担保（Escrow）：交易期间数字资产由链上智能合约锁定，确保买卖双方权益。',

    // C2C V2 — escrow mode
    c2c_v2_title: 'C2C 交易（RWAD）',
    c2c_v2_subtitle: '链下发现（libp2p）+ 链上结算（escrow）',
    c2c_v2_walletPrefix: '钱包',
    c2c_v2_walletMissing: '未配置 RWAD 钱包',
    c2c_v2_buyAdsTitle: '买入广告（仅展示签名有效 + 资产余额充足）',
    c2c_v2_noListings: '暂无可交易广告',
    c2c_v2_sellerPrefix: '卖家',
    c2c_v2_remaining: '剩余',
    c2c_v2_limitRange: '限额',
    c2c_v2_lockTitle: '下单锁仓',
    c2c_v2_qtyPlaceholder: '数量',
    c2c_v2_submitLock: '提交锁仓',
    c2c_v2_processing: '处理中...',
    c2c_v2_estimateLock: '预计锁仓',
    c2c_v2_publishTitle: '发布广告',
    c2c_v2_publishQtyPh: '数量',
    c2c_v2_publishPricePh: '单价RWAD',
    c2c_v2_publishExpiryPh: '有效期分钟（5-60）',
    c2c_v2_publishBtn: '发布广告',
    c2c_v2_pendingTitle: '待交付订单',
    c2c_v2_noPending: '暂无待交付订单',
    c2c_v2_orderPrefix: '订单',
    c2c_v2_deliverBtn: '提交资产交付（asset_transfer）',
    c2c_v2_myOrdersTitle: '我的订单状态',
    c2c_v2_noOrders: '暂无订单',
    c2c_v2_orderSuccess: '下单成功',
    c2c_v2_publishSuccess: '上架成功',
    c2c_v2_deliverSuccess: '交付已提交',

    // 斗地主
    ddz_title: '斗地主',
    ddz_you: '你',
    ddz_cards: '张',
    ddz_yourBid: '轮到你叫地主',
    ddz_thinking: '思考中...',
    ddz_noBid: '不叫',
    ddz_grab: '抢地主',
    ddz_points: '分',
    ddz_yourTurn: '轮到你出牌',
    ddz_landlord: '地主',
    ddz_farmer: '农民',
    ddz_landlordWins: '地主获胜',
    ddz_farmerWins: '农民获胜',
    ddz_youWin: '🎉 你赢了！',
    ddz_wins: '赢了',
    ddz_playAgain: '再来一局',
    ddz_play: '出牌',
    ddz_pass: '不出',
    ddz_invalidHand: '无效牌型',
    ddz_cantBeat: '打不过上家',
    ddz_mustPlay: '你必须出牌',

    // 中国象棋
    xq_title: '中国象棋',
    xq_yourTurn: '你的回合',
    xq_opponentTurn: '对方回合',
    xq_aiThinking: 'AI 思考中...',
    xq_check: '⚠️ 将军！',
    xq_youWin: '🎉 你赢了！',
    xq_youLose: '😢 你输了',
    xq_playAgain: '再来一局',
    xq_moveCount: '步数',
    xq_red: '红方',
    xq_black: '黑方',

    // 四人麻将
    mj_title: '四人麻将',
    mj_yourTurn: '轮到你出牌',
    mj_thinking: '思考中...',
    mj_draw: '流局',
    mj_youWin: '🎉 胡了！',
    mj_wins: '胡了',
    mj_you: '你',
    mj_remaining: '余',
    mj_tiles: '张',
    mj_discarded: '打出',
    mj_hu: '胡',
    mj_peng: '碰',
    mj_gang: '杠',
    mj_skip: '过',
    mj_discard: '打出',
    mj_playAgain: '再来一局',

    // 狼人杀
    ww_title: '狼人杀',
    ww_roleReveal: '身份揭晓',
    ww_nightWolf: '狼人行动',
    ww_nightSeer: '预言家行动',
    ww_nightWitch: '女巫行动',
    ww_dayAnnounce: '天亮了',
    ww_dayVote: '投票处决',
    ww_wolfWin: '🐺 狼人获胜',
    ww_villageWin: '🏠 好人获胜',
    ww_youAre: '你的身份是',
    ww_confirm: '确认',
    ww_waiting: '等待中...',
    ww_selectKill: '选择要杀的目标',
    ww_kill: '杀',
    ww_selectCheck: '选择要查验的目标',
    ww_check: '查验',
    ww_beingKilled: '被狼人杀害',
    ww_save: '解药',
    ww_poison: '毒药',
    ww_skip: '跳过',
    ww_youDead: '你已死亡',
    ww_selectVote: '选择要处决的玩家',
    ww_vote: '投票',
    ww_playAgain: '再来一局',
    ww_logEmpty: '游戏日志',
};

const zhTW: Partial<Translations> = {
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
    home_sortByDistance: '距離最近',
    home_smartSort: '智慧排序',
    home_customSort: '自訂排序',
    home_tabSettings: '頻道管理',
    home_done: '完成',
    home_distanceSortPermissionDeniedFallback: '定位不可用，已切換到「最熱」排序',
    content_location_openInMap: '開啟地圖',
    content_location_noCoordinates: '此內容未包含有效座標，無法導航',
    content_location_openFailed: '開啟地圖失敗，請稍後再試',
    publish_location_collecting: '定位採集中...',
    publish_location_required_hint: '發布時將即時採集高精度 GPS（<=50m），不達標將阻止發布',
    publish_location_error_permissionDenied: '定位權限被拒絕，無法發布',
    publish_location_error_accuracyTooLow: '定位精度不足（需 <= 50m），請到空曠處後重試',
    publish_location_error_timeout: '定位超時，請重試',
    publish_location_error_unavailable: '定位服務不可用，請檢查 GPS 設定',
    publish_location_error_unknown: '定位失敗，發布未完成',

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

    sidebar_trading: '交易',
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

    wallet_import: '導入錢包',
    wallet_importTitle: '導入 Web3 錢包',
    wallet_ph: '輸入私鑰或助記詞',
    wallet_cancel: '取消',
    wallet_confirm: '確認導入',
    wallet_success: '錢包導入成功！',
    wallet_tos_title: '⚠️ 非託管協議',
    wallet_tos_1: '我深刻理解，Unimaker 是非託管軟體，官方絕對無法存取、也未備份我的私鑰。',
    wallet_tos_2: '如果我遺失助記詞或解除安裝 App，Unimaker 沒有任何技術能力幫我找回，資金將永久遺失。',
    wallet_tos_3: '因我個人裝置洩漏或被駭客入侵導致的資金損失，與 Unimaker 無關。',
    wallet_tos_agree: '我已閱讀並同意以上全部條款',

    channel_manage: '頻道管理',
    channel_tip: '長按拖動排序，點擊進入頻道',

    // Sidebar — extra entries
    sidebar_appMarket: '應用市場',
    sidebar_checkUpdates: '檢查更新',
    update_banner_title: '發現新版本',
    update_banner_message: '發現最新版本，正在背景自動更新',
    update_banner_details: '更新詳情',
    update_banner_ack: '知道了',
    update_center_title: '更新中心',
    update_center_subtitle: 'V2 全網一致性更新',
    update_center_version_compare: '版本對比',
    update_center_previous_version: '上一版本',
    update_center_current_version: '當前版本',
    update_center_latest_version: '最新版本',
    update_center_upgraded_label: '已從',
    update_center_upgraded_to: '升級到',
    update_center_state: '狀態',
    update_center_manifest_sequence: 'Manifest 序列',
    update_center_manifest_id: 'Manifest ID',
    update_center_attestation: '見證計數',
    update_center_last_checked: '最近檢查',
    update_center_release_notes: '更新內容',
    update_center_release_published_at: '發布時間',
    update_center_show_details: '更新詳情',
    update_center_hide_details: '收起詳情',
    update_center_no_release_notes: '暫無更新內容',
    update_center_vrf_status_none: '未收到更新候選',
    update_center_vrf_status_waiting_carrier: '候選已收到，等待策略閾值',
    update_center_vrf_status_waiting_history: '已收到候選，等待歷史鏈補齊',
    update_center_vrf_status_confirmed: '候選已確認',
    update_center_last_error: '最近失敗原因',
    update_center_revoked_title: '當前更新已被撤銷/止血',
    update_center_revoked_desc: '已自動阻斷安裝並清理暫存。',
    update_center_staged_title: '殼包已下載並暫存',
    update_center_staged_desc: '應用前台使用時不會強制打斷，切到背景後會繼續安裝流程。iOS 需透過 App Store/TestFlight 完成殼包升級。',
    update_center_manual_check: '手動檢查更新',
    update_center_check_no_remote_peers: '網路可用，但暫無可連線節點',
    update_center_open_store_upgrade: '打開 App Store / TestFlight 升級殼包',
    update_center_publisher_title: '發布節點操作',
    update_center_publisher_hint: '發布 Manifest 必須填寫版本號、版本碼與更新內容（摘要/詳情）。',
    update_center_publish_version: '版本號',
    update_center_publish_version_code: '版本碼',
    update_center_publish_sequence: '序列號',
    update_center_publish_artifact_uri: '安裝包地址',
    update_center_publish_artifact_sha256: '安裝包 SHA256（可選）',
    update_center_publish_summary: '更新摘要',
    update_center_publish_details: '更新詳情',
    update_center_summary_placeholder: '例如：修復卡頓並優化節點同步',
    update_center_details_placeholder: '例如：1) 修復... 2) 優化... 3) 安全加固...',
    update_center_publish_shell_required: '需要殼包升級',
    update_center_publish_emergency: '緊急模式',
    update_center_publish_manifest: '發布 Manifest',
    update_center_publish_revoke: '發布 Revoke',
    update_center_publish_killswitch: '發布 KillSwitch',
    update_center_publish_key_missing: '缺少發布者密鑰，請先在「發布者密鑰配置」中填寫並保存公鑰/私鑰',
    update_center_release_notes_required: '版本號、更新摘要、更新詳情必須填寫',
    update_center_version_code_invalid: '版本碼必須是正整數',
    update_center_artifact_uri_required: '安裝包地址不能為空',
    update_center_publish_manifest_success: 'Manifest 已發布',
    update_center_publish_manifest_failed: 'Manifest 發布失敗',
    update_center_publish_failed: '發布失敗',

    // Profile — RWAD chain
    profile_refreshChainBalance: '刷新鏈上餘額',
    profile_rwadChainRechargeBlocked: 'RWAD 餘額以鏈上為準，不支持本地充值。',
    profile_rwadChainTransferBlocked: 'RWAD 轉帳請使用鏈上交易流程。',
    profile_rwadChainDomainBlocked: 'RWAD 扣費已遷移鏈上，域名註冊入口待接入。',
    profile_rwadWalletNotFound: '未找到 RWAD 錢包，請先建立或匯入。',
    profile_rwadChainRefreshFailed: '鏈上餘額刷新失敗，請稍後重試。',
    profile_rwadWalletCreated: 'RWAD 錢包建立成功！',
    profile_createRwadWallet: '建立 RWAD 錢包',
    profile_rwadMigrationHint: 'RWAD 餘額已切換為鏈上真相，本地帳本不再生效。',

    // C2C Trading Page
    c2c_title: 'C2C交易',
    c2c_buy: '購買',
    c2c_sell: '出售',
    c2c_all: '全部',
    c2c_bankCard: '銀行卡',
    c2c_wechat: '微信',
    c2c_alipay: '支付寶',
    c2c_merchant: '商家',
    c2c_unitPrice: '單價',
    c2c_qtyLimit: '數量/限額',
    c2c_action: '操作',
    c2c_orders: '單',
    c2c_completionRate: '完成率',
    c2c_quantity: '數量',
    c2c_limit: '限額',
    c2c_available: '可用數量',
    c2c_tradeLimit: '交易限額',
    c2c_paymentMethod: '支付方式',
    c2c_wantBuy: '我要購買',
    c2c_wantSell: '我要出售',
    c2c_inputAmount: '輸入{crypto}數量',
    c2c_needPay: '需支付',
    c2c_willReceive: '將收到',
    c2c_buyAction: '購買 {crypto}',
    c2c_sellAction: '出售 {crypto}',
    c2c_escrowNotice: '平台託管保障：交易期間數位資產由平台安全託管，確保買賣雙方權益。',

    // C2C V2 — escrow mode
    c2c_v2_title: 'C2C 交易（RWAD）',
    c2c_v2_subtitle: '鏈下發現（libp2p）+ 鏈上結算（escrow）',
    c2c_v2_walletPrefix: '錢包',
    c2c_v2_walletMissing: '未配置 RWAD 錢包',
    c2c_v2_buyAdsTitle: '買入廣告（僅展示簽名有效 + 資產餘額充足）',
    c2c_v2_noListings: '暫無可交易廣告',
    c2c_v2_sellerPrefix: '賣家',
    c2c_v2_remaining: '剩餘',
    c2c_v2_limitRange: '限額',
    c2c_v2_lockTitle: '下單鎖倉',
    c2c_v2_qtyPlaceholder: '數量',
    c2c_v2_submitLock: '提交鎖倉',
    c2c_v2_processing: '處理中...',
    c2c_v2_estimateLock: '預計鎖倉',
    c2c_v2_publishTitle: '發佈廣告',
    c2c_v2_publishQtyPh: '數量',
    c2c_v2_publishPricePh: '單價RWAD',
    c2c_v2_publishExpiryPh: '有效期分鐘（5-60）',
    c2c_v2_publishBtn: '發佈廣告',
    c2c_v2_pendingTitle: '待交付訂單',
    c2c_v2_noPending: '暫無待交付訂單',
    c2c_v2_orderPrefix: '訂單',
    c2c_v2_deliverBtn: '提交資產交付（asset_transfer）',
    c2c_v2_myOrdersTitle: '我的訂單狀態',
    c2c_v2_noOrders: '暫無訂單',
    c2c_v2_orderSuccess: '下單成功',
    c2c_v2_publishSuccess: '上架成功',
    c2c_v2_deliverSuccess: '交付已提交',

    // 斗地主
    ddz_title: '鬥地主',
    ddz_you: '你',
    ddz_cards: '張',
    ddz_yourBid: '輪到你叫地主',
    ddz_thinking: '思考中...',
    ddz_noBid: '不叫',
    ddz_grab: '搶地主',
    ddz_points: '分',
    ddz_yourTurn: '輪到你出牌',
    ddz_landlord: '地主',
    ddz_farmer: '農民',
    ddz_landlordWins: '地主獲勝',
    ddz_farmerWins: '農民獲勝',
    ddz_youWin: '🎉 你贏了！',
    ddz_wins: '贏了',
    ddz_playAgain: '再來一局',
    ddz_play: '出牌',
    ddz_pass: '不出',
    ddz_invalidHand: '無效牌型',
    ddz_cantBeat: '打不過上家',
    ddz_mustPlay: '你必須出牌',

    // 中國象棋
    xq_title: '中國象棋',
    xq_yourTurn: '你的回合',
    xq_opponentTurn: '對方回合',
    xq_aiThinking: 'AI 思考中...',
    xq_check: '⚠️ 將軍！',
    xq_youWin: '🎉 你贏了！',
    xq_youLose: '😢 你輸了',
    xq_playAgain: '再來一局',
    xq_moveCount: '步數',
    xq_red: '紅方',
    xq_black: '黑方',

    // 四人麻將
    mj_title: '四人麻將',
    mj_yourTurn: '輪到你出牌',
    mj_thinking: '思考中...',
    mj_draw: '流局',
    mj_youWin: '🎉 胡了！',
    mj_wins: '胡了',
    mj_you: '你',
    mj_remaining: '餘',
    mj_tiles: '張',
    mj_discarded: '打出',
    mj_hu: '胡',
    mj_peng: '碰',
    mj_gang: '槓',
    mj_skip: '過',
    mj_discard: '打出',
    mj_playAgain: '再來一局',

    // 狼人殺
    ww_title: '狼人殺',
    ww_roleReveal: '身份揭曉',
    ww_nightWolf: '狼人行動',
    ww_nightSeer: '預言家行動',
    ww_nightWitch: '女巫行動',
    ww_dayAnnounce: '天亮了',
    ww_dayVote: '投票處決',
    ww_wolfWin: '🐺 狼人獲勝',
    ww_villageWin: '🏠 好人獲勝',
    ww_youAre: '你的身份是',
    ww_confirm: '確認',
    ww_waiting: '等待中...',
    ww_selectKill: '選擇要殺的目標',
    ww_kill: '殺',
    ww_selectCheck: '選擇要查驗的目標',
    ww_check: '查驗',
    ww_beingKilled: '被狼人殺害',
    ww_save: '解藥',
    ww_poison: '毒藥',
    ww_skip: '跳過',
    ww_youDead: '你已死亡',
    ww_selectVote: '選擇要處決的玩家',
    ww_vote: '投票',
    ww_playAgain: '再來一局',
    ww_logEmpty: '遊戲日誌',
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
    home_sortByDistance: 'Nearest',
    home_smartSort: 'Smart Sort',
    home_customSort: 'Custom Sort',
    home_tabSettings: 'Channel Settings',
    home_done: 'Done',
    home_distanceSortPermissionDeniedFallback: 'Location unavailable. Switched to Trending.',
    content_location_openInMap: 'Open in map',
    content_location_noCoordinates: 'This content has no valid coordinates.',
    content_location_openFailed: 'Failed to open map. Please try again.',

    publish_location_collecting: 'Collecting GPS...',
    publish_location_required_hint: 'Publishing requires real-time high-accuracy GPS (<=50m). Publish will be blocked otherwise.',
    publish_location_error_permissionDenied: 'Location permission denied. Unable to publish.',
    publish_location_error_accuracyTooLow: 'Location accuracy is too low (requires <= 50m). Please retry in an open area.',
    publish_location_error_timeout: 'Location request timed out. Please retry.',
    publish_location_error_unavailable: 'Location service unavailable. Check your GPS settings.',
    publish_location_error_unknown: 'Location failed. Publish not completed.',
    publish_location_success: 'Location acquired',
    publish_location_failed: 'Location failed',
    publish_location_retry: 'Retry',

    publish_content: 'Content',
    publish_ecommerce: 'E-Commerce',
    publish_live: 'Live',
    publish_app: 'App',
    publish_food: 'Food',
    publish_ride: 'Ride',
    publish_job: 'Job',
    pubJob_title: 'Post Job Seeking',
    publish_job_publish: 'Publish',
    pubJob_yourName: 'Your name',
    pubJob_desiredPosition: 'Desired position',
    pubJob_positionPh: 'e.g. Frontend Engineer',
    pubJob_jobType: 'Job type',
    pubJob_fullTime: 'Full-time',
    pubJob_partTime: 'Part-time',
    pubJob_intern: 'Internship',
    pubJob_remote: 'Remote',
    pubJob_experience: 'Experience',
    pubJob_experiencePh: 'e.g. 3 years',
    pubJob_education: 'Education',
    pubJob_selectEducation: 'Select education',
    pubJob_highSchool: 'High School',
    pubJob_associate: 'Associate',
    pubJob_bachelor: 'Bachelor',
    pubJob_master: 'Master',
    pubJob_phd: 'PhD',
    pubJob_expectedSalary: 'Expected salary',
    pubJob_salaryPh: 'e.g. 15-20K',
    pubJob_expectedCity: 'Desired city',
    pubJob_cityPh: 'e.g. Beijing',
    pubJob_skills: 'Skill tags',
    pubJob_addSkill: 'Add skill',
    pubJob_add: 'Add',
    pubJob_intro: 'Personal intro',
    pubJob_introPh: 'Brief intro about your experience and strengths...',
    publish_job_seekingSummary: 'seeking',
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
    c2c_state_draft: 'Draft',
    c2c_state_listed: 'Listed',
    c2c_state_lockPending: 'Lock Pending',
    c2c_state_locked: 'Locked',
    c2c_state_delivering: 'Delivering',
    c2c_state_settling: 'Settling',
    c2c_state_released: 'Released',
    c2c_state_refunded: 'Refunded',
    c2c_state_expired: 'Expired',
    c2c_state_failed: 'Failed',
    c2c_err_invalidEscrow: 'Escrow ID validation failed',
    c2c_err_sellerMismatch: 'Seller identity does not match order',
    c2c_err_listingNotFound: 'Listing not found or not tradable',
    c2c_err_qtyOutOfRange: 'Order quantity is out of listing range',
    c2c_err_invalidAmount: 'Please enter a valid amount',
    c2c_err_publishFailed: 'Message publish failed, please retry',
    c2c_err_unknown: 'Unknown error',
    c2c_err_runtimeUnavailable: 'C2C runtime is not ready, check libp2p / ingress.',
    c2c_err_selectWalletAndListing: 'Select an RWAD wallet and a listing first.',
    c2c_err_walletMissing: 'RWAD signer not found. Create or import an RWAD wallet first.',
    c2c_err_missingAssetId: 'Please enter asset_id.',
    c2c_action_orderFailed: 'Order failed',
    c2c_action_publishFailed: 'Publish failed',
    c2c_action_deliverFailed: 'Delivery failed',

    wallet_import: 'Import Wallet',
    wallet_importTitle: 'Import Web3 Wallet',
    wallet_ph: 'Enter Private Key or Mnemonic',
    wallet_cancel: 'Cancel',
    wallet_confirm: 'Confirm Import',
    wallet_success: 'Wallet Imported Successfully!',
    wallet_tos_title: '⚠️ Non-Custodial Agreement',
    wallet_tos_1: 'I fully understand that Unimaker is non-custodial software. The team has absolutely no access to and has not backed up my private keys.',
    wallet_tos_2: 'If I lose my mnemonic phrase or uninstall the app, Unimaker has no technical ability to help me recover my funds, and they will be permanently lost.',
    wallet_tos_3: 'Any loss of funds due to my personal device being compromised or hacked is not the responsibility of Unimaker.',
    wallet_tos_agree: 'I have read and agree to all of the above terms',

    channel_manage: 'Channel Manager',
    channel_tip: 'Long press to reorder, click to enter',

    // Messages
    msg_title: 'Messages',
    msg_conversations: 'Chats',
    msg_contacts: 'Contacts',
    msg_moments: 'Moments',
    msg_notifications: 'Notifications',
    msg_noMessages: 'No messages yet',
    msg_noContacts: 'No contacts yet',
    msg_noMoments: 'No moments yet',
    msg_noNotifications: 'No notifications',
    msg_tapToChat: 'Tap to start chatting',
    msg_groupChat: 'Group',
    msg_status: 'Status',
    msg_noTextContent: '[No text content]',
    msg_notification: 'Notification',
    msg_minutesAgo: 'm ago',
    msg_hoursAgo: 'h ago',
    msg_daysAgo: 'd ago',
    msg_asiName: 'ASI Assistant',
    msg_asiGreeting: 'I am ASI (Artificial Super Intelligence) Assistant. I can help you with various tasks, please feel free to ask.',

    // Chat
    chat_backToList: 'Back to chat list',
    chat_groupChat: 'Group Chat',
    chat_directChat: 'Direct P2P Session',
    chat_noMessages: 'No messages yet — start chatting!',
    chat_redPacket: 'Red Packet',
    chat_redPacketAmount: 'Amount',
    chat_locationShare: 'Location shared',
    chat_voiceMessage: 'Voice message',
    chat_startedVideoCall: 'Started a video call',
    chat_switchedToVoice: 'Switched to voice input',
    chat_voiceInput: 'Voice input',
    chat_inputPlaceholder: 'Type a message...',
    chat_emojiPanel: 'Emoji',
    chat_sendMessage: 'Send message',
    chat_moreFeatures: 'More features',
    chat_location: 'Location',
    chat_videoCall: 'Video Call',
    chat_invitePeople: 'Invite People',
    chat_voiceCall: 'Voice Call',
    chat_groupApps: 'Group Apps',
    chat_sendRedPacket: 'Send Red Packet',
    chat_closeRedPacket: 'Close red packet',
    chat_amount: 'Amount',
    chat_enterAmount: 'Enter amount',
    chat_greeting: 'Greeting',
    chat_greetingPlaceholder: 'Best wishes!',
    chat_sendRedPacketBtn: 'Send Red Packet',
    chat_sendLocation: 'Send Location',
    chat_closeLocation: 'Close location',
    chat_locationPreview: 'Location Preview',
    chat_enterLocationName: 'Enter location name',
    chat_sendCurrentLocation: 'Send Current Location',
    chat_closeGroupApps: 'Close group apps',
    chat_launch: 'Launch',
    chat_goToMarket: '+ Go to App Market',
    chat_navigatingToMarket: 'Navigating to app market...',
    chat_launchedApp: 'Launched app in group chat',
    chat_emojiFunctionDev: 'Emoji panel coming soon',
    chat_videoCallInvite: 'Video call invite sent',
    chat_inviteContacts: 'Opened invite contacts',
    chat_voiceCallInvite: 'Voice call invite sent',
    chat_movieApp: 'Watch Movie',
    chat_mahjongApp: 'Mahjong',
    chat_voteApp: 'Group Vote',
    chat_defaultGreeting: 'Best wishes!',

    // Nodes
    nodes_detail: 'Node Details',
    nodes_online: 'Online',
    nodes_offline: 'Offline',
    nodes_hardwareTitle: 'Hardware & System Info',
    nodes_os: 'OS',
    nodes_cpu: 'CPU',
    nodes_memory: 'Memory',
    nodes_disk: 'Disk',
    nodes_gpu: 'GPU',
    nodes_connections: 'Connections',
    nodes_downlink: 'Downlink',
    nodes_uplink: 'Uplink',
    nodes_downlinkTotal: 'Downlink Total',
    nodes_uplinkTotal: 'Uplink Total',
    nodes_transferTotal: 'Total Transfer',
    nodes_relayPath: 'Relayed Path',
    nodes_bottleneck: 'Bottleneck Throughput',
    nodes_probeRunning: 'Measuring peer-to-peer bandwidth...',
    nodes_yes: 'Yes',
    nodes_no: 'No',
    nodes_publishedContent: 'Published Content',
    nodes_viewAllContent: 'View all content from this node',
    nodes_sendMessage: 'Send Message',
    nodes_backToList: 'Back to node list',
    nodes_noNodes: 'No nodes to display',
    nodes_noNodesHint: 'Nodes are auto-discovered from the network or conversations',
    nodes_sourceAll: 'All',
    nodes_sourceDirect: 'Direct',
    nodes_searchPlaceholder: 'Search by domain or PeerId...',
    nodes_cancelSearch: 'Cancel search',
    nodes_multiSelect: 'Multi-select',
    nodes_searchNodes: 'Search nodes',
    nodes_selectAll: 'Select All',
    nodes_deselectAll: 'Deselect All',
    nodes_selectedCount: 'Selected',
    nodes_createGroup: 'Create Group',
    nodes_defaultNickname: 'Node',
    nodes_instantMsg: 'Messaging',
    nodes_nodeDiscovery: 'Discovery',
    nodes_noBio: 'No bio available',
    nodes_sourceUnknown: 'Unknown',
    nodes_sourceLabel: 'Source',
    nodes_noBootstrapNode: 'No available bootstrap nodes',
    nodes_bootstrapFailed: 'Bootstrap connection failed',
    nodes_groupChatSuffix: 'Group',
    nodes_voiceInviteSent: 'Voice invite sent, entering chat.',
    nodes_videoInviteSent: 'Video invite sent, entering chat.',
    nodes_groupDraftCreated: 'Group chat draft created.',
    nodes_directSessionCreated: 'Direct session established',
    nodes_voiceInviteMsg: 'Voice invite sent',
    nodes_videoInviteMsg: 'Video invite sent',
    nodes_groupDraftMsg: 'Group chat draft created',
    nodes_directSessionMsg: 'Direct session established',
    nodes_invalidPeerId: 'Please enter a valid PeerId',
    nodes_nodeExists: 'This node already exists',
    nodes_manuallyAdded: 'Manually added node',
    nodes_connectFailed: 'Failed to connect to node',
    nodes_sourceMdns: 'Source: mDNS / LAN',
    nodes_sourceRendezvous: 'Source: Rendezvous / WAN',
    nodes_globalComputeTitle: 'Global Available Compute',
    nodes_totalNodes: 'Total Nodes',
    nodes_onlineNodes: 'Online Nodes',
    nodes_totalCpuCores: 'Total CPU Cores',
    nodes_totalMemory: 'Total Memory',
    nodes_totalDiskAvailable: 'Available Disk',
    nodes_totalGpuVram: 'GPU VRAM',
    nodes_totalDownlink: 'Total Downlink',
    nodes_totalUplink: 'Total Uplink',
    nodes_diag_title: 'Discovery Diagnostics',
    nodes_diag_runtime: 'Runtime',
    nodes_diag_runtime_ready: 'Ready',
    nodes_diag_runtime_starting: 'Starting',
    nodes_diag_runtime_notReady: 'Not Ready',
    nodes_diag_connected_peers: 'Connected Peers',
    nodes_diag_mdns_peers: 'mDNS Candidates',
    nodes_diag_candidates: 'Discovery Candidates',
    nodes_diag_peer_id: 'Local PeerId',
    nodes_diag_last_error: 'Last Error',

    // Profile
    profile_web3Wallet: 'Web3 Wallet',
    profile_walletCount: 'wallets',
    profile_createOrImport: 'Create or import wallet',
    profile_transactionHistory: 'Transaction History',
    profile_recordCount: 'records',
    profile_noRecords: 'No records',
    profile_baziTitle: 'BaZi Chart',
    profile_baziDesc: 'Four Pillars · Five Elements · Ten Gods',
    profile_ziweiTitle: 'Zi Wei Dou Shu',
    profile_ziweiDesc: 'Twelve Palaces · Main Stars · Transformations',
    profile_points: 'Points',
    profile_rwad: 'RWAD',
    profile_recharge: 'Recharge',
    profile_transfer: 'Transfer',
    profile_amountLabel: 'Amount',
    profile_enterAmount: 'Enter amount',
    profile_targetAddress: 'Target Address / PeerId',
    profile_enterTargetAddress: 'Enter target address',
    profile_confirm: 'Confirm',
    profile_transferDomain: 'Transfer Domain',
    profile_currentDomain: 'Current Domain',
    profile_enterReceiverAddress: 'Enter receiver address or PeerId',
    profile_confirmTransfer: 'Confirm Transfer',
    profile_back: 'Back',
    profile_addressManagement: 'Address Management',
    profile_noAddress: 'No shipping address',
    profile_noAddressHint: 'Tap the button below to add an address',
    profile_defaultTag: 'Default',
    profile_setDefault: 'Set as Default',
    profile_edit: 'Edit',
    profile_delete: 'Delete',
    profile_addAddress: 'Add New Address',
    profile_editAddress: 'Edit Address',
    profile_recipient: 'Recipient',
    profile_recipientPlaceholder: 'Enter recipient name',
    profile_phone: 'Phone',
    profile_phonePlaceholder: 'Enter recipient phone number',
    profile_mapSelect: 'Map',
    profile_regionSelect: 'Region',
    profile_regionSelectHint: '(incl. international)',
    profile_address: 'Address',
    profile_addressPlaceholder: 'Select address',
    profile_currentLocation: 'Current Location',
    profile_locating: 'Locating...',
    profile_locationService: 'Location Service',
    profile_use: 'Use',
    profile_doorNumber: 'Unit No.',
    profile_doorNumberPlaceholder: 'e.g. Bldg 6, Rm 201',
    profile_addressClipboard: 'Address Clipboard',
    profile_clipboardPlaceholder: 'Paste recipient name, phone, and address to auto-fill',
    profile_clipboardTitle: 'Address Clipboard',
    profile_setAsDefault: 'Set as default address',
    profile_setAsDefaultHint: 'This address will be used by default when ordering',
    profile_tagLabel: 'Tag',
    profile_tagSchool: 'School',
    profile_tagHome: 'Home',
    profile_tagCompany: 'Work',
    profile_tagShopping: 'Shopping',
    profile_tagDelivery: 'Delivery',
    profile_tagCustom: 'Custom',
    profile_walletTitle: 'Web3 Wallet',
    profile_close: 'Close',
    profile_walletWarning: '⚠️ Private keys are stored locally in localStorage. Ensure your browser data is secure.',
    profile_myWallets: 'My Wallets',
    profile_loading: 'Loading...',
    profile_export: 'Export',
    profile_deleteWallet: 'Delete',
    profile_doNotLeak: '⚠️ Do not share the following information',
    profile_mnemonic: 'Mnemonic',
    profile_privateKey: 'Private Key',
    profile_showHide: 'Show/Hide',
    profile_show: 'Show',
    profile_hide: 'Hide',
    profile_createWallet: 'Create Wallet',
    profile_importWallet: 'Import Wallet',
    profile_evmSolanaHint: 'EVM & Solana share one mnemonic, BTC is separate',
    profile_createEvmSolana: 'Create EVM + Solana Wallet',
    profile_createBtc: 'Create BTC Wallet',
    profile_creating: 'Creating...',
    profile_selectChain: 'Select Chain',
    profile_walletAlias: 'Wallet Alias',
    profile_walletAliasPlaceholder: 'e.g. Main Wallet',
    profile_mnemonicOrKey: 'Mnemonic or Private Key',
    profile_mnemonicOrKeyPlaceholder: 'Enter 12/24-word mnemonic or hex private key',
    profile_myWallet: 'My Wallet',
    profile_importing: 'Importing...',
    profile_importTo: 'Import to',
    profile_backToList: 'Back to list',
    profile_txPointsRecharge: 'Points Recharge',
    profile_txPointsTransfer: 'Points Transfer',
    profile_txRwadRecharge: 'RWAD Recharge',
    profile_txRwadTransfer: 'RWAD Transfer',
    profile_txDomainRegister: 'Domain Register',
    profile_txDomainTransfer: 'Domain Transfer',
    profile_txStatus: 'Status',
    profile_txDone: 'Done',
    profile_txTime: 'Time',
    profile_txTarget: 'Target',
    profile_txId: 'Transaction ID',
    profile_noTxRecords: 'No transaction records',
    profile_errInvalidAmount: 'Please enter a valid amount',
    profile_errOverseasRwadOnly: 'Overseas accounts can only recharge RWAD',
    profile_errDomesticPointsOnly: 'Domestic accounts can only recharge points',
    profile_errInvalidTarget: 'Please enter a valid target address or PeerId',
    profile_errInsufficientPoints: 'Insufficient points balance',
    profile_errInsufficientRwad: 'Insufficient RWAD balance',
    profile_errDomainEmpty: 'Please enter a domain prefix to register',
    profile_errDomainFormat: 'Domain only supports lowercase letters, numbers, and hyphens (2-32 chars)',
    profile_errDomainPointsCost: 'Registration requires 1 point, insufficient balance',
    profile_errDomainRwadCost: 'Registration requires 1 RWAD, insufficient balance',
    profile_errAddressIncomplete: 'Please complete all shipping info',
    profile_errImportInvalid: 'Import info is invalid',
    profile_errVerifyFirst: 'Please verify and preview address first',
    profile_errAcceptRisk: 'Please accept local storage risk first',
    profile_walletImportSuccess: 'Wallet imported, address binding complete.',
    profile_evmSolanaSuccess: 'EVM + Solana wallet created (shared mnemonic)!',
    profile_errCreateFailed: 'Creation failed',
    profile_btcSuccess: 'BTC wallet created!',
    profile_chainImportSuccess: 'wallet imported!',
    profile_errImportFailed: 'Import failed',
    profile_domesticNode: 'Domestic node',
    profile_overseasNode: 'Overseas node',
    profile_nodePeerId: 'Node PeerId',
    profile_copied: 'Copied',
    profile_copy: 'Copy',
    profile_overseasRwadNote: 'Overseas accounts can recharge RWAD',
    profile_domesticPointsNote: 'Domestic accounts can recharge points',
    profile_domainLabel: 'Domain',
    profile_domainInputPlaceholder: 'Enter domain prefix, e.g. mynode',
    profile_registerDomain: 'Register Domain',
    profile_registerCostPoints: '1 Point',
    profile_registerCostRwad: '1 RWAD',

    profile_c2cMaker: 'C2C Market Maker',
    profile_c2cMakerHint: 'Automatically accept orders as a market maker when enabled',
    profile_c2cFundType: 'Fund Type',
    profile_c2cDailyLimit: 'Daily Limit',
    profile_c2cLimitPlaceholder: 'Enter limit',
    profile_dexSettings: 'DEX Settings',
    profile_dexClob: 'Order Book (CLOB)',
    profile_dexClobDesc: 'Enable central limit order book. Toggle off to halt DEX.',
    profile_dexBridge: 'C2C Bridge',
    profile_dexBridgeDesc: 'Enable C2C-DEX bridge. Toggle off for pure DEX mode.',
    profile_c2cSpread: 'Spread(bps)',
    profile_c2cLimitLabel: 'Limit',
    profile_c2cBaseBps: 'base bps',
    profile_c2cMaxBps: 'max bps',
    profile_c2cPairs: 'pairs',
    profile_c2cPolicyReset: 'Policy reset: CN (Asia/Shanghai 00:00) / INTL (UTC 00:00)',
    profile_c2cDexHint: 'Enable C2C Market Maker to see DEX settings. Saved configs will be preserved.',

    profile_serviceWillingness: 'Service Willingness',
    profile_serviceWillingnessHint: 'When enabled, nearby errand/delivery orders will be pushed to you',
    profile_errand: 'Errands',
    profile_errandOriginRange: 'Pickup radius (km)',
    profile_errandOriginHint: 'Max distance from you to the pickup point',
    profile_errandDestRange: 'Delivery radius (km)',
    profile_errandDestHint: 'Max delivery distance from pickup to drop-off',
    profile_rideshare: 'Rideshare',
    profile_rideshareRoute: 'Regular route',
    profile_rideshareFrom: 'Origin',
    profile_rideshareTo: 'Destination',
    profile_rideshareHint: 'Rideshare requests along your route will be pushed to you',
    profile_distributedNode: 'Distributed Compute/Storage Node',
    profile_distributedNodeHint: 'Task pricing fluctuates with market demand. Specific price and income will be confirmed upon task dispatch. Please set your resource limits.',
    profile_distributedNodeRewards: 'Earning Model: Pay-as-you-go',
    profile_priceCpu: 'System Price (CPU)',
    profile_priceMemory: 'System Price (Memory)',
    profile_priceDisk: 'System Price (Disk)',
    profile_priceGpu: 'System Price (GPU)',
    profile_limitCpu: 'Max Cores',
    profile_limitMemory: 'Max Memory',
    profile_limitDisk: 'Max Disk',
    profile_limitGpu: 'Max GPU',
    profile_unitCpu: 'Pts/Core·h',
    profile_unitMemory: 'Pts/GB·h',
    profile_unitDisk: 'Pts/GB·d',
    profile_unitGpu: 'Pts/GPU·h',
    profile_unitCore: 'Cores',
    profile_unitGB: 'GB',
    profile_unitCard: 'Units',
    profile_rangeUnit: 'km',
    profile_rangeUnitM: 'm',

    // Publish Common
    pub_title: 'Title',
    pub_description: 'Description',
    pub_publish: 'Publish',
    pub_category: 'Category',

    // Publish Content Wizard
    pubContent_selectType: 'Select Content Type',
    pubContent_editContent: 'Edit Content',
    pubContent_sharePlaceholder: 'Share your thoughts...',
    pubContent_uploadHint: 'Tap to upload',
    pubContent_image: 'Image',
    pubContent_video: 'Video',
    pubContent_audio: 'Audio',
    pubContent_text: 'Text',
    pubContent_ageRating: 'Content Rating',
    pubContent_ageRatingHint: 'Select appropriate age range',
    pubContent_allAges: 'All Ages',
    pubContent_age12: '12+',
    pubContent_age16: '16+',
    pubContent_age18: '18+',
    pubContent_allAgesDesc: 'Suitable for all audiences',
    pubContent_age12Desc: 'Contains mild scary or violent elements',
    pubContent_age16Desc: 'Contains obvious violence or suggestive content',
    pubContent_age18Desc: 'Adult content, requires age verification',
    pubContent_riskDimension: 'Risk Dimension Declaration',
    pubContent_riskDimensionHint: 'Label potentially sensitive content areas',
    pubContent_nudity: 'Nudity/Sexual',
    pubContent_nudityDesc: 'Contains nudity or sexual suggestion?',
    pubContent_violence: 'Violence/Gore',
    pubContent_violenceDesc: 'Contains violent or gory scenes?',
    pubContent_drugs: 'Drug-related',
    pubContent_drugsDesc: 'Contains drug-related content?',
    pubContent_gambling: 'Gambling-related',
    pubContent_gamblingDesc: 'Contains gambling-related content?',
    pubContent_political: 'Politically Sensitive',
    pubContent_politicalDesc: 'Contains politically sensitive topics?',
    pubContent_none: 'None',
    pubContent_riskWarning: 'Your risk rating is high. Content may be restricted in some regions.',
    pubContent_riskHighWarning: 'Your risk rating is high. Content may be restricted in some regions.',
    pubContent_ageSuggestion: 'Tip: If unsure about rating, choose a higher age limit to reduce takedown risk.',
    pubContent_riskLevel: 'Level',
    pubContent_publishContent: 'Publish Content',
    pubContent_contentRating: 'Content Rating',
    pubContent_riskStatement: 'Risk Statement',

    // Publish Product
    pubProduct_title: 'Publish Product',
    pubProduct_csvMode: 'CSV Batch',
    pubProduct_manualMode: 'Manual Entry',
    pubProduct_csvUploadHint: 'Upload CSV file to import products in batch',
    pubProduct_productImage: 'Product Image',
    pubProduct_productName: 'Product Name',
    pubProduct_productNamePh: 'Enter product name',
    pubProduct_productDesc: 'Product Description',
    pubProduct_productDescPh: 'Describe your product in detail...',
    pubProduct_stock: 'Stock',
    pubProduct_stockPh: 'Enter stock quantity',
    pubProduct_enableSku: 'Enable SKU Variants',
    pubProduct_color: 'Color',
    pubProduct_addColor: 'Add color',
    pubProduct_size: 'Size',
    pubProduct_addSize: 'Add size',

    // Publish Product Wizard
    pubProdWiz_clothing: 'Clothing',
    pubProdWiz_beauty: 'Beauty',
    pubProdWiz_food: 'Food & Drink',
    pubProdWiz_digital: 'Electronics',
    pubProdWiz_home: 'Home & Living',
    pubProdWiz_sports: 'Sports & Outdoor',
    pubProdWiz_books: 'Books & Crafts',
    pubProdWiz_other: 'Other',

    // Publish Common (extra)
    pub_paidContent: 'Paid Content',
    pub_yuan: 'CNY',
    pub_location: 'Location',
    pub_contact: 'Contact',
    pub_negotiable: 'Negotiable',
    pub_other: 'Other',
    pub_uploadImage: 'Upload Image',
    pub_delete: 'Delete',
    pub_addReward: 'Add',
    publish_location_collecting: 'Collecting GPS...',
    publish_location_required_hint: 'Publishing requires real-time high-accuracy GPS (<=50m). Publish will be blocked otherwise.',
    publish_location_error_permissionDenied: 'Location permission denied. Unable to publish.',
    publish_location_error_accuracyTooLow: 'Location accuracy is too low (requires <= 50m). Please retry in an open area.',
    publish_location_error_timeout: 'Location request timed out. Please retry.',
    publish_location_error_unavailable: 'Location service unavailable. Check your GPS settings.',
    publish_location_error_unknown: 'Location failed. Publish not completed.',

    // Publish App
    pubApp_title: 'Publish App',
    pubApp_icon: 'App Icon',
    pubApp_name: 'App Name',
    pubApp_namePh: 'Enter app name',
    pubApp_desc: 'App Description',
    pubApp_descPh: 'Describe app features and highlights...',
    pubApp_version: 'Version',
    pubApp_versionPh: 'e.g. 1.0.0',
    pubApp_pricing: 'Pricing',
    pubApp_openSource: 'Open Source',
    pubApp_repoUrl: 'Repository URL',
    pubApp_repoUrlPh: 'https://github.com/...',
    pubApp_categoryLabel: 'App Category',
    pubApp_catTools: 'Tools',
    pubApp_catSocial: 'Social',
    pubApp_catGames: 'Games',
    pubApp_catMedia: 'Media',
    pubApp_catFinance: 'Finance',
    pubApp_catEducation: 'Education',
    pubApp_file: 'App File',
    pubApp_uploadHint: 'Upload ZIP/APK/IPA/WASM',
    pubApp_iconHint: 'Recommended 512x512 PNG',
    pubApp_pricePh: 'Enter app price',
    pubApp_hint: 'Apps are distributed via decentralized network. Ensure your app complies with platform guidelines.',

    // Publish Food
    pubFood_title: 'Publish Food',
    pubFood_image: 'Food Photo',
    pubFood_name: 'Food Name',
    pubFood_namePh: 'Enter food name',
    pubFood_type: 'Food Type',
    pubFood_homeCooking: 'Home Cooking',
    pubFood_baking: 'Baking',
    pubFood_dessert: 'Dessert',
    pubFood_drink: 'Drink',
    pubFood_snack: 'Snack',
    pubFood_supplyTime: 'Available Time',
    pubFood_supplyTimePh: 'e.g. Daily 11:00-14:00',
    pubFood_pickup: 'Pickup Address',
    pubFood_pickupPh: 'Enter pickup address',
    pubFood_descPh: 'Describe food features, ingredients...',

    // Publish Ride
    pubRide_title: 'Publish Ride Share',
    pubRide_offerSeat: 'I have a seat',
    pubRide_lookForSeat: 'I need a ride',
    pubRide_from: 'From',
    pubRide_to: 'To',
    pubRide_date: 'Date',
    pubRide_time: 'Time',
    pubRide_seats: 'Available Seats',
    pubRide_seatUnit: 'seats',
    pubRide_costShare: 'Cost per person',
    pubRide_note: 'Note',
    pubRide_notePlaceholder: 'e.g. can detour, no pets...',
    pubRide_offerLabel: 'Offering ride',
    pubRide_lookForLabel: 'Looking for ride',

    // Publish Job
    pubJob_title: 'Post Resume',
    pubJob_yourName: 'Your Name',
    pubJob_desiredPosition: 'Desired Position',
    pubJob_positionPh: 'e.g. Frontend Engineer',
    pubJob_jobType: 'Job Type',
    pubJob_fullTime: 'Full-time',
    pubJob_partTime: 'Part-time',
    pubJob_intern: 'Intern',
    pubJob_remote: 'Remote',
    pubJob_experience: 'Experience',
    pubJob_experiencePh: 'e.g. 3 years',
    pubJob_education: 'Education',
    pubJob_selectEducation: 'Select education',
    pubJob_highSchool: 'High School',
    pubJob_associate: 'Associate',
    pubJob_bachelor: 'Bachelor\'s',
    pubJob_master: 'Master\'s',
    pubJob_phd: 'PhD',
    pubJob_expectedSalary: 'Expected Salary',
    pubJob_salaryPh: 'e.g. 15-20K',
    pubJob_expectedCity: 'Preferred City',
    pubJob_cityPh: 'e.g. Beijing',
    pubJob_skills: 'Skills',
    pubJob_addSkill: 'Add skill',
    pubJob_add: 'Add',
    pubJob_intro: 'Introduction',
    pubJob_introPh: 'Brief intro about your experience and strengths...',

    // Publish Hire
    pubHire_title: 'Post Job',
    pubHire_companyName: 'Company Name',
    pubHire_companyNamePh: 'Your company name',
    pubHire_jobTitle: 'Job Title',
    pubHire_jobTitlePh: 'Enter job title',
    pubHire_jobType: 'Job Type',
    pubHire_salary: 'Salary Range (K)',
    pubHire_salaryPh: 'e.g. 15-25',
    pubHire_headcount: 'Headcount',
    pubHire_headcountPh: 'Enter headcount',
    pubHire_experience: 'Experience Required',
    pubHire_noLimit: 'No limit',
    pubHire_freshman: 'Fresh graduate',
    pubHire_exp1_3: '1-3 years',
    pubHire_exp3_5: '3-5 years',
    pubHire_exp5_10: '5-10 years',
    pubHire_exp10Plus: '10+ years',
    pubHire_education: 'Education Required',
    pubHire_location: 'Work Location',
    pubHire_locationPh: 'Enter work location',
    pubHire_benefits: 'Benefits',
    pubHire_jobDesc: 'Job Description',
    pubHire_jobDescPh: 'Enter job description...',
    pubHire_requirements: 'Requirements',
    pubHire_requirementsPh: 'Enter job requirements...',
    pubHire_salaryNegotiable: 'Negotiable',

    // Publish Rent
    pubRent_title: 'Post Rental',
    pubRent_image: 'Property Photos',
    pubRent_titleLabel: 'Listing Title',
    pubRent_titlePh: 'Enter listing title',
    pubRent_type: 'Rental Type',
    pubRent_whole: 'Entire Place',
    pubRent_shared: 'Shared Room',
    pubRent_shortTerm: 'Short-term',
    pubRent_shop: 'Shop',
    pubRent_office: 'Office',
    pubRent_warehouse: 'Warehouse',
    pubRent_area: 'Area (㎡)',
    pubRent_areaPh: 'Enter area',
    pubRent_rooms: 'Layout',
    pubRent_roomsPh: 'e.g. 2 bed 1 bath',
    pubRent_cycle: 'Rent Cycle',
    pubRent_day: 'Day',
    pubRent_week: 'Week',
    pubRent_month: 'Month',
    pubRent_year: 'Year',
    pubRent_moveInDate: 'Move-in Date',
    pubRent_address: 'Address',
    pubRent_addressPh: 'Enter full address',
    pubRent_descPh: 'Describe property features, amenities...',

    // Publish Sell
    pubSell_title: 'Post for Sale',
    pubSell_image: 'Item Photos',
    pubSell_titleLabel: 'Title',
    pubSell_titlePh: 'Enter title',
    pubSell_type: 'Sale Type',
    pubSell_property: 'Property',
    pubSell_vehicle: 'Vehicle',
    pubSell_land: 'Land',
    pubSell_shop: 'Shop',
    pubSell_equipment: 'Equipment',
    pubSell_locationPh: 'City / Region',
    pubSell_contactPh: 'Phone or WeChat',
    pubSell_descPh: 'Detailed description...',

    // Publish Secondhand
    pubSecondhand_title: 'Post Used Item',
    pubSecondhand_image: 'Item Photos',
    pubSecondhand_name: 'Item Name',
    pubSecondhand_namePh: 'Enter item name',
    pubSecondhand_condition: 'Condition',
    pubSecondhand_condNew: 'Brand New',
    pubSecondhand_condLikeNew: 'Like New',
    pubSecondhand_condLight: 'Lightly Used',
    pubSecondhand_condHeavy: 'Heavily Used',
    pubSecondhand_condRepair: 'Needs Repair',
    pubSecondhand_catDigital: 'Electronics',
    pubSecondhand_catClothing: 'Clothing',
    pubSecondhand_catHome: 'Home',
    pubSecondhand_catBooks: 'Books',
    pubSecondhand_catSports: 'Sports',
    pubSecondhand_originalPrice: 'Original Price (optional)',
    pubSecondhand_originalPricePh: 'Original price',
    pubSecondhand_cheaperBy: 'Cheaper by',
    pubSecondhand_catLabel: 'Category',
    pubSecondhand_descPh: 'Describe item details, condition...',

    // Publish Crowdfunding
    pubCrowdfund_title: 'Start Crowdfunding',
    pubCrowdfund_cover: 'Project Cover (max 5)',
    pubCrowdfund_projectTitle: 'Project Title',
    pubCrowdfund_projectTitlePh: 'Enter crowdfunding project title',
    pubCrowdfund_projectDesc: 'Project Description',
    pubCrowdfund_projectDescPh: 'Describe your crowdfunding project in detail...',
    pubCrowdfund_minSupport: 'Minimum Support Amount',
    pubCrowdfund_endDate: 'Campaign End Date',
    pubCrowdfund_projectCategory: 'Project Category',
    pubCrowdfund_catTech: 'Technology',
    pubCrowdfund_catDesign: 'Creative Design',
    pubCrowdfund_catFilm: 'Film & Animation',
    pubCrowdfund_catMusic: 'Music Album',
    pubCrowdfund_catGame: 'Game Dev',
    pubCrowdfund_catCharity: 'Charity',
    pubCrowdfund_catPublish: 'Publishing',
    pubCrowdfund_rewardTier: 'Reward Tiers',
    pubCrowdfund_tierLabel: 'Tier',
    pubCrowdfund_supportAmount: 'Support Amount ¥',
    pubCrowdfund_limitPh: 'Limit (empty = unlimited)',
    pubCrowdfund_rewardDescPh: 'Reward description',
    pubCrowdfund_addTier: '+ Add Reward Tier',
    pubCrowdfund_notice: 'Crowdfunding projects require review before going live. If the goal is not reached, all supporters will receive a full refund.',
    pubCrowdfund_upload: 'Upload',
    pubCrowdfund_goalPrefix: 'Goal',
    pubCrowdfund_deadlinePrefix: 'Deadline',

    // Publish Modal
    pubModal_title: 'Select Publish Type',

    // Live Stream
    live_title: 'Live Stream',

    // Content Detail
    contentDetail_views: 'Views',
    contentDetail_likes: 'Likes',
    contentDetail_comments: 'Comments',

    // Product Detail
    productDetail_buy: 'Buy Now',
    productDetail_addToCart: 'Add to Cart',

    // Fortune
    fortune_title: 'Fortune Analysis',
    fortune_birthTime: 'Birth Time',
    fortune_male: 'Male',
    fortune_female: 'Female',
    fortune_baziAnalysis: 'BaZi Analysis',
    fortune_ziweiAnalysis: 'Zi Wei Dou Shu',
    fortune_yearPillar: 'Year Pillar',
    fortune_monthPillar: 'Month Pillar',
    fortune_dayPillar: 'Day Pillar',
    fortune_hourPillar: 'Hour Pillar',
    fortune_fiveElements: 'Five Elements',
    fortune_wood: 'Wood',
    fortune_fire: 'Fire',
    fortune_earth: 'Earth',
    fortune_metal: 'Metal',
    fortune_water: 'Water',
    fortune_interpretation: 'Interpretation',
    fortune_mingGong: 'Life Palace',
    fortune_shenGong: 'Body Palace',
    fortune_mainStars: 'Main Stars',
    fortune_chartReading: 'Chart Reading',
    fortune_askQuestion: 'Enter your question...',
    fortune_freeAsk: 'Ask for free',
    fortune_paidAsk: 'Paid question',
    fortune_followUpCost: 'Follow-up costs 10',
    fortune_payToUnlock: 'Payment required',
    fortune_freeUsed: 'Free question used. Follow-up costs 10',
    fortune_pay: 'Pay 10',
    fortune_cancel: 'Cancel',
    fortune_bazi_title: 'BaZi Chart',
    fortune_bazi_yearGod: 'Year Stem God',
    fortune_bazi_monthGod: 'Month Stem God',
    fortune_bazi_hourGod: 'Hour Stem God',
    fortune_bazi_fourPillars: 'Four Pillars Chart',
    fortune_bazi_wuxing: 'Five Elements Analysis',
    fortune_bazi_shiShenTitle: 'Shi Shen & Day Master',
    fortune_bazi_dayMaster: 'Day Master',
    fortune_bazi_dayMasterStrength: 'Day Master Strength',
    fortune_ziwei_title: 'Zi Wei Dou Shu',
    fortune_ziwei_birthInfo: 'Birth Info (Lunar)',
    fortune_ziwei_year: 'Year',
    fortune_ziwei_month: 'Month',
    fortune_ziwei_day: 'Day',
    fortune_ziwei_hour: 'Hour',
    fortune_ziwei_gender: 'Gender',
    fortune_ziwei_calculate: 'Calculate',
    fortune_ziwei_mingGong: 'Life Palace',
    fortune_ziwei_shenGong: 'Body Palace',
    fortune_ziwei_twelvePalaces: 'Twelve Palaces',
    fortune_ziwei_keyPalaces: 'Key Palace Readings',
    fortune_ziwei_mainStarLabel: 'Main Stars',
    fortune_ziwei_auxStarLabel: 'Aux Stars',
    fortune_ziwei_noMainStar: 'No main star',

    // App Marketplace
    appMkt_search: 'Search apps...',
    appMkt_installed: 'Installed',
    appMkt_install: 'Install',
    appMkt_entertainment: 'Entertainment',
    appMkt_game: 'Games',
    appMkt_tools: 'Tools',
    appMkt_education: 'Education',

    // Risk levels
    risk_none: 'None',
    risk_nudity1: 'Mild suggestion',
    risk_nudity2: 'Explicit nudity',
    risk_nudity3: 'Pornographic',
    risk_violence1: 'Mild fighting',
    risk_violence2: 'Visible injury',
    risk_violence3: 'Extreme gore',
    risk_drugs1: 'Mentioned only',
    risk_drugs2: 'Shown in use',
    risk_drugs3: 'Manufacturing/dealing',
    risk_gambling1: 'Mentioned only',
    risk_gambling2: 'Promoted',
    risk_gambling3: 'Fraud/scam',
    risk_political1: 'General discussion',
    risk_political2: 'Controversial',
    risk_political3: 'Extremist',

    // Hire benefits
    hire_insurance: 'Social Insurance',
    hire_paidLeave: 'Paid Leave',
    hire_flexWork: 'Flexible Hours',
    hire_freeMeals: 'Free Meals',
    hire_teamBuilding: 'Team Building',
    hire_stockOptions: 'Stock Options',
    hire_training: 'Training',
    hire_yearEndBonus: 'Year-end Bonus',

    // Sidebar — extra entries
    sidebar_appMarket: 'App Market',
    sidebar_checkUpdates: 'Check Updates',
    update_banner_title: 'New version found',
    update_banner_message: 'Latest version detected, updating in background',
    update_banner_details: 'Update Details',
    update_banner_ack: 'Dismiss',
    update_center_title: 'Update Center',
    update_center_subtitle: 'V2 global consistent updates',
    update_center_version_compare: 'Version Comparison',
    update_center_previous_version: 'Previous Version',
    update_center_current_version: 'Current Version',
    update_center_latest_version: 'Latest Version',
    update_center_upgraded_label: 'Upgraded from',
    update_center_upgraded_to: 'to',
    update_center_state: 'State',
    update_center_manifest_sequence: 'Manifest Sequence',
    update_center_manifest_id: 'Manifest ID',
    update_center_attestation: 'Attestation Count',
    update_center_last_checked: 'Last Check',
    update_center_release_notes: 'Release Notes',
    update_center_release_published_at: 'Published At',
    update_center_show_details: 'View Details',
    update_center_hide_details: 'Hide Details',
    update_center_no_release_notes: 'No release notes',
    update_center_vrf_status_none: 'No update candidate received',
    update_center_vrf_status_waiting_carrier: 'Candidate received, waiting for policy threshold',
    update_center_vrf_status_waiting_history: 'Candidate received, waiting for chain history backfill',
    update_center_vrf_status_confirmed: 'Candidate confirmed',
    update_center_last_error: 'Last Failure',
    update_center_revoked_title: 'Current update was revoked/killed',
    update_center_revoked_desc: 'Install was blocked and staged files were cleaned automatically.',
    update_center_staged_title: 'Shell package downloaded and staged',
    update_center_staged_desc: 'Upgrade is deferred while app is foreground. It resumes after app goes background. iOS shell upgrades require App Store/TestFlight.',
    update_center_manual_check: 'Check Updates Now',
    update_center_check_no_remote_peers: 'Network is reachable, but no remote peers are connectable yet',
    update_center_open_store_upgrade: 'Open App Store / TestFlight for shell upgrade',
    update_center_publisher_title: 'Publisher Node Operations',
    update_center_publisher_hint: 'Publishing a Manifest requires version, version code, and release notes (summary/details).',
    update_center_publish_version: 'Version',
    update_center_publish_version_code: 'Version Code',
    update_center_publish_sequence: 'Sequence',
    update_center_publish_artifact_uri: 'Artifact URI',
    update_center_publish_artifact_sha256: 'Artifact SHA256 (Optional)',
    update_center_publish_summary: 'Update Summary',
    update_center_publish_details: 'Update Details',
    update_center_summary_placeholder: 'Example: fix transfer lag and optimize node sync',
    update_center_details_placeholder: 'Example: 1) Fixed... 2) Optimized... 3) Security hardening...',
    update_center_publish_shell_required: 'Shell Upgrade Required',
    update_center_publish_emergency: 'Emergency Mode',
    update_center_publish_manifest: 'Publish Manifest',
    update_center_publish_revoke: 'Publish Revoke',
    update_center_publish_killswitch: 'Publish KillSwitch',
    update_center_publish_key_missing: 'Missing publisher keys. Fill and save public/private keys in "Publisher Key Config" first.',
    update_center_release_notes_required: 'Version, summary, and details are required',
    update_center_version_code_invalid: 'Version code must be a positive integer',
    update_center_artifact_uri_required: 'Artifact URI is required',
    update_center_publish_manifest_success: 'Manifest published',
    update_center_publish_manifest_failed: 'Manifest publish failed',
    update_center_publish_failed: 'Publish failed',

    // Profile — RWAD chain
    profile_refreshChainBalance: 'Refresh On-chain Balance',
    profile_rwadChainRechargeBlocked: 'RWAD balance is on-chain; local top-up is not supported.',
    profile_rwadChainTransferBlocked: 'Please use on-chain transactions to transfer RWAD.',
    profile_rwadChainDomainBlocked: 'RWAD fee has migrated on-chain; domain registration coming soon.',
    profile_rwadWalletNotFound: 'RWAD wallet not found. Please create or import one.',
    profile_rwadChainRefreshFailed: 'On-chain balance refresh failed. Please try again later.',
    profile_rwadWalletCreated: 'RWAD wallet created successfully!',
    profile_createRwadWallet: 'Create RWAD Wallet',
    profile_rwadMigrationHint: 'RWAD balance is now on-chain. Local ledger is no longer in effect.',

    // C2C Trading Page
    c2c_title: 'C2C Trading',
    c2c_buy: 'Buy',
    c2c_sell: 'Sell',
    c2c_all: 'All',
    c2c_bankCard: 'Bank Card',
    c2c_wechat: 'WeChat',
    c2c_alipay: 'Alipay',
    c2c_merchant: 'Merchant',
    c2c_unitPrice: 'Price',
    c2c_qtyLimit: 'Qty / Limit',
    c2c_action: 'Action',
    c2c_orders: 'orders',
    c2c_completionRate: 'completion',
    c2c_quantity: 'Qty',
    c2c_limit: 'Limit',
    c2c_available: 'Available',
    c2c_tradeLimit: 'Trade Limit',
    c2c_paymentMethod: 'Payment',
    c2c_wantBuy: 'I want to buy',
    c2c_wantSell: 'I want to sell',
    c2c_inputAmount: 'Enter {crypto} amount',
    c2c_needPay: 'You pay',
    c2c_willReceive: 'You receive',
    c2c_buyAction: 'Buy {crypto}',
    c2c_sellAction: 'Sell {crypto}',
    c2c_escrowNotice: 'Platform escrow protection: digital assets are securely held during transactions to protect both buyers and sellers.',

    // C2C V2 — escrow mode
    c2c_v2_title: 'C2C Trading (RWAD)',
    c2c_v2_subtitle: 'Off-chain discovery (libp2p) + on-chain settlement (escrow)',
    c2c_v2_walletPrefix: 'Wallet',
    c2c_v2_walletMissing: 'RWAD wallet not configured',
    c2c_v2_buyAdsTitle: 'Buy listings (verified signatures + sufficient balance only)',
    c2c_v2_noListings: 'No listings available',
    c2c_v2_sellerPrefix: 'Seller',
    c2c_v2_remaining: 'Remaining',
    c2c_v2_limitRange: 'Limit',
    c2c_v2_lockTitle: 'Place Order (Lock Funds)',
    c2c_v2_qtyPlaceholder: 'Quantity',
    c2c_v2_submitLock: 'Submit Lock',
    c2c_v2_processing: 'Processing...',
    c2c_v2_estimateLock: 'Estimated lock',
    c2c_v2_publishTitle: 'Publish Listing',
    c2c_v2_publishQtyPh: 'Quantity',
    c2c_v2_publishPricePh: 'Unit price (RWAD)',
    c2c_v2_publishExpiryPh: 'Expiry in minutes (5-60)',
    c2c_v2_publishBtn: 'Publish Listing',
    c2c_v2_pendingTitle: 'Pending Deliveries',
    c2c_v2_noPending: 'No pending deliveries',
    c2c_v2_orderPrefix: 'Order',
    c2c_v2_deliverBtn: 'Submit asset delivery (asset_transfer)',
    c2c_v2_myOrdersTitle: 'My Orders',
    c2c_v2_noOrders: 'No orders',
    c2c_v2_orderSuccess: 'Order placed',
    c2c_v2_publishSuccess: 'Listing published',
    c2c_v2_deliverSuccess: 'Delivery submitted',

    // Dou Di Zhu
    ddz_title: 'Dou Di Zhu',
    ddz_you: 'You',
    ddz_cards: 'cards',
    ddz_yourBid: 'Your turn to bid',
    ddz_thinking: 'Thinking...',
    ddz_noBid: 'Pass',
    ddz_grab: 'Grab Landlord',
    ddz_points: 'pts',
    ddz_yourTurn: 'Your turn',
    ddz_landlord: 'Landlord',
    ddz_farmer: 'Farmer',
    ddz_landlordWins: 'Landlord wins',
    ddz_farmerWins: 'Farmers win',
    ddz_youWin: '🎉 You win!',
    ddz_wins: 'wins',
    ddz_playAgain: 'Play Again',
    ddz_play: 'Play',
    ddz_pass: 'Pass',
    ddz_invalidHand: 'Invalid hand',
    ddz_cantBeat: 'Cannot beat',
    ddz_mustPlay: 'You must play',

    // Chinese Chess
    xq_title: 'Chinese Chess',
    xq_yourTurn: 'Your turn',
    xq_opponentTurn: 'Opponent\'s turn',
    xq_aiThinking: 'AI thinking...',
    xq_check: '⚠️ Check!',
    xq_youWin: '🎉 You win!',
    xq_youLose: '😢 You lose',
    xq_playAgain: 'Play Again',
    xq_moveCount: 'Moves',
    xq_red: 'Red',
    xq_black: 'Black',

    // Mahjong
    mj_title: 'Mahjong',
    mj_yourTurn: 'Your turn to discard',
    mj_thinking: 'Thinking...',
    mj_draw: 'Draw',
    mj_youWin: '🎉 You Win!',
    mj_wins: 'wins',
    mj_you: 'You',
    mj_remaining: 'Left',
    mj_tiles: ' tiles',
    mj_discarded: 'Discarded',
    mj_hu: 'Hu',
    mj_peng: 'Peng',
    mj_gang: 'Gang',
    mj_skip: 'Skip',
    mj_discard: 'Discard',
    mj_playAgain: 'Play Again',

    // Werewolf
    ww_title: 'Werewolf',
    ww_roleReveal: 'Role Reveal',
    ww_nightWolf: 'Werewolf Phase',
    ww_nightSeer: 'Seer Phase',
    ww_nightWitch: 'Witch Phase',
    ww_dayAnnounce: 'Dawn',
    ww_dayVote: 'Vote',
    ww_wolfWin: '🐺 Werewolves Win',
    ww_villageWin: '🏠 Village Wins',
    ww_youAre: 'Your role is',
    ww_confirm: 'Confirm',
    ww_waiting: 'Waiting...',
    ww_selectKill: 'Select target to kill',
    ww_kill: 'Kill',
    ww_selectCheck: 'Select target to check',
    ww_check: 'Check',
    ww_beingKilled: 'was killed by wolves',
    ww_save: 'Antidote',
    ww_poison: 'Poison',
    ww_skip: 'Skip',
    ww_youDead: 'You are dead',
    ww_selectVote: 'Select player to vote out',
    ww_vote: 'Vote',
    ww_playAgain: 'Play Again',
    ww_logEmpty: 'Game Log',
};

const ja: Partial<Translations> = {
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
    home_sortByDistance: '近い順',
    home_smartSort: 'スマート並べ替え',
    home_customSort: 'カスタム並べ替え',
    home_tabSettings: 'チャンネル管理',
    home_done: '完了',
    home_distanceSortPermissionDeniedFallback: '位置情報を取得できないため、「人気」に切り替えました',
    content_location_openInMap: '地図で開く',
    content_location_noCoordinates: 'この投稿には有効な座標がありません',
    content_location_openFailed: '地図を開けませんでした。後でもう一度お試しください',
    publish_location_collecting: 'GPSを取得中...',
    publish_location_required_hint: '投稿時に高精度GPS（<=50m）をリアルタイム取得します。満たさない場合は投稿できません',
    publish_location_error_permissionDenied: '位置情報の権限が拒否され、投稿できません',
    publish_location_error_accuracyTooLow: '位置精度が不足しています（<=50mが必要）。屋外で再試行してください',
    publish_location_error_timeout: '位置情報の取得がタイムアウトしました。再試行してください',
    publish_location_error_unavailable: '位置情報サービスを利用できません。GPS設定を確認してください',
    publish_location_error_unknown: '位置情報の取得に失敗し、投稿できませんでした',

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

    wallet_import: 'ウォレットをインポート',
    wallet_importTitle: 'Web3ウォレットをインポート',
    wallet_ph: '秘密鍵またはニーモニックを入力',
    wallet_cancel: 'キャンセル',
    wallet_confirm: 'インポート',
    wallet_success: 'ウォレットをインポートしました！',
    wallet_tos_title: '⚠️ 非カストディアル契約',
    wallet_tos_1: 'Unimaker は非カストディアルソフトウェアであり、運営チームは私の秘密鍵にアクセスできず、バックアップもしていないことを十分に理解しています。',
    wallet_tos_2: 'ニーモニックフレーズを紛失したり、アプリをアンインストールした場合、Unimaker は資金を回復する技術的手段を持たず、資金は永久に失われます。',
    wallet_tos_3: '個人のデバイスの漏洩やハッキングによる資金の損失は、Unimaker の責任ではありません。',
    wallet_tos_agree: '上記のすべての条項を読み、同意しました',

    channel_manage: 'チャンネル管理',
    channel_tip: '長押しで並べ替え、クリックで入る',
};

const ko: Partial<Translations> = {
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
    home_sortByDistance: '가까운 순',
    home_smartSort: '스마트 정렬',
    home_customSort: '사용자 정렬',
    home_tabSettings: '채널 관리',
    home_done: '완료',
    home_distanceSortPermissionDeniedFallback: '위치 정보를 사용할 수 없어 인기순으로 전환했습니다',
    content_location_openInMap: '지도에서 열기',
    content_location_noCoordinates: '이 콘텐츠에는 유효한 좌표가 없습니다',
    content_location_openFailed: '지도를 열지 못했습니다. 다시 시도해 주세요',
    publish_location_collecting: 'GPS 수집 중...',
    publish_location_required_hint: '게시 시 실시간 고정밀 GPS(<=50m)가 필요하며 조건 미달 시 게시가 차단됩니다',
    publish_location_error_permissionDenied: '위치 권한이 거부되어 게시할 수 없습니다',
    publish_location_error_accuracyTooLow: '위치 정확도가 낮습니다(<=50m 필요). 탁 트인 곳에서 다시 시도하세요',
    publish_location_error_timeout: '위치 요청 시간이 초과되었습니다. 다시 시도하세요',
    publish_location_error_unavailable: '위치 서비스를 사용할 수 없습니다. GPS 설정을 확인하세요',
    publish_location_error_unknown: '위치 획득에 실패해 게시가 완료되지 않았습니다',

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

    wallet_import: '지갑 가져오기',
    wallet_importTitle: 'Web3 지갑 가져오기',
    wallet_ph: '개인 키 또는 니모닉 입력',
    wallet_cancel: '취소',
    wallet_confirm: '확인',
    wallet_success: '지갑을 성공적으로 가져왔습니다!',
    wallet_tos_title: '⚠️ 비수탁 계약',
    wallet_tos_1: 'Unimaker는 비수탁 소프트웨어이며, 운영팀은 제 개인 키에 접근할 수 없고 백업하지 않는다는 것을 충분히 이해합니다.',
    wallet_tos_2: '니모닉 문구를 분실하거나 앱을 삭제하면 Unimaker는 자금을 복구할 기술적 능력이 없으며, 자금은 영구적으로 손실됩니다.',
    wallet_tos_3: '개인 기기의 유출이나 해킹으로 인한 자금 손실은 Unimaker의 책임이 아닙니다.',
    wallet_tos_agree: '위 모든 조항을 읽고 동의합니다',

    channel_manage: '채널 관리',
    channel_tip: '길게 눌러 정렬, 클릭하여 진입',
};

const fr: Partial<Translations> = {
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
    home_sortByDistance: 'Le plus proche',
    home_smartSort: 'Tri intelligent',
    home_customSort: 'Tri personnalisé',
    home_tabSettings: 'Gérer les chaînes',
    home_done: 'Terminé',
    home_distanceSortPermissionDeniedFallback: 'Position indisponible. Retour au tri Tendance.',
    content_location_openInMap: 'Ouvrir dans la carte',
    content_location_noCoordinates: 'Ce contenu ne contient pas de coordonnées valides.',
    content_location_openFailed: 'Impossible d’ouvrir la carte. Réessayez.',
    publish_location_collecting: 'Collecte GPS...',
    publish_location_required_hint: 'La publication exige un GPS haute précision en temps réel (<=50m). Sinon la publication est bloquée.',
    publish_location_error_permissionDenied: 'Autorisation de localisation refusée. Publication impossible.',
    publish_location_error_accuracyTooLow: 'Précision GPS insuffisante (<= 50m requis). Réessayez dans une zone dégagée.',
    publish_location_error_timeout: 'La demande de localisation a expiré. Réessayez.',
    publish_location_error_unavailable: 'Service de localisation indisponible. Vérifiez vos réglages GPS.',
    publish_location_error_unknown: 'Échec de la localisation. Publication non terminée.',

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

    wallet_import: 'Importer le portefeuille',
    wallet_importTitle: 'Importer le portefeuille Web3',
    wallet_ph: 'Entrez la clé privée ou mnémonique',
    wallet_cancel: 'Annuler',
    wallet_confirm: 'Confirmer',
    wallet_success: 'Portefeuille importé avec succès !',
    wallet_tos_title: '⚠️ Accord non-dépositaire',
    wallet_tos_1: 'Je comprends parfaitement qu\'Unimaker est un logiciel non-dépositaire et que l\'équipe n\'a absolument aucun accès à mes clés privées et ne les a pas sauvegardées.',
    wallet_tos_2: 'Si je perds ma phrase mnémonique ou désinstalle l\'application, Unimaker n\'a aucune capacité technique pour m\'aider à récupérer mes fonds, qui seront définitivement perdus.',
    wallet_tos_3: 'Toute perte de fonds due à la compromission ou au piratage de mon appareil personnel n\'engage pas la responsabilité d\'Unimaker.',
    wallet_tos_agree: 'J\'ai lu et j\'accepte toutes les conditions ci-dessus',

    channel_manage: 'Gérer les chaînes',
    channel_tip: 'Appui long pour réorganiser',
};

const de: Partial<Translations> = {
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
    home_sortByDistance: 'Nächste',
    home_smartSort: 'Smartes Sortieren',
    home_customSort: 'Benutzerdefiniert',
    home_tabSettings: 'Kanal-Einstellungen',
    home_done: 'Fertig',
    home_distanceSortPermissionDeniedFallback: 'Standort nicht verfügbar. Auf Beliebt zurückgesetzt.',
    content_location_openInMap: 'In Karte öffnen',
    content_location_noCoordinates: 'Dieser Inhalt enthält keine gültigen Koordinaten.',
    content_location_openFailed: 'Karte konnte nicht geöffnet werden. Bitte erneut versuchen.',
    publish_location_collecting: 'GPS wird erfasst...',
    publish_location_required_hint: 'Zum Veröffentlichen ist Echtzeit-GPS mit hoher Genauigkeit (<=50m) erforderlich, sonst wird blockiert.',
    publish_location_error_permissionDenied: 'Standortberechtigung verweigert. Veröffentlichung nicht möglich.',
    publish_location_error_accuracyTooLow: 'Standortgenauigkeit zu niedrig (<= 50m erforderlich). Bitte im Freien erneut versuchen.',
    publish_location_error_timeout: 'Standortanfrage hat das Zeitlimit überschritten. Bitte erneut versuchen.',
    publish_location_error_unavailable: 'Standortdienst nicht verfügbar. Bitte GPS-Einstellungen prüfen.',
    publish_location_error_unknown: 'Standorterfassung fehlgeschlagen. Veröffentlichung nicht abgeschlossen.',

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

    // ... (other common keys)


    channel_manage: 'Kanalverwaltung',
    channel_tip: 'Lang drücken zum Sortieren',

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

    wallet_import: 'Wallet importieren',
    wallet_importTitle: 'Web3 Wallet importieren',
    wallet_ph: 'Privaten Schlüssel oder Mnemonic eingeben',
    wallet_cancel: 'Abbrechen',
    wallet_confirm: 'Bestätigen',
    wallet_success: 'Wallet erfolgreich importiert!',
    wallet_tos_title: '⚠️ Nicht-verwahrende Vereinbarung',
    wallet_tos_1: 'Ich verstehe vollständig, dass Unimaker eine nicht-verwahrende Software ist und das Team absolut keinen Zugriff auf meine privaten Schlüssel hat und diese nicht gesichert hat.',
    wallet_tos_2: 'Wenn ich meine Mnemonik-Phrase verliere oder die App deinstalliere, hat Unimaker keine technische Möglichkeit, mir bei der Wiederherstellung meiner Gelder zu helfen, und sie gehen dauerhaft verloren.',
    wallet_tos_3: 'Jeder Geldverlust aufgrund einer Kompromittierung oder eines Hacks meines persönlichen Geräts liegt nicht in der Verantwortung von Unimaker.',
    wallet_tos_agree: 'Ich habe alle oben genannten Bedingungen gelesen und stimme ihnen zu',
};

const ar: Partial<Translations> = {
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
    home_sortByDistance: 'الأقرب',
    home_smartSort: 'ترتيب ذكي',
    home_customSort: 'ترتيب مخصص',
    home_tabSettings: 'إدارة القنوات',
    home_done: 'تم',
    home_distanceSortPermissionDeniedFallback: 'الموقع غير متاح. تم الرجوع إلى ترتيب الأكثر رواجاً.',
    content_location_openInMap: 'فتح في الخريطة',
    content_location_noCoordinates: 'هذا المحتوى لا يحتوي على إحداثيات صالحة.',
    content_location_openFailed: 'تعذر فتح الخريطة. حاول مرة أخرى.',
    publish_location_collecting: 'جارٍ جمع GPS...',
    publish_location_required_hint: 'النشر يتطلب GPS عالي الدقة في الوقت الفعلي (<=50م)، وإلا سيتم منع النشر.',
    publish_location_error_permissionDenied: 'تم رفض إذن الموقع. لا يمكن النشر.',
    publish_location_error_accuracyTooLow: 'دقة الموقع منخفضة (المطلوب <= 50م). حاول مرة أخرى في مكان مفتوح.',
    publish_location_error_timeout: 'انتهت مهلة طلب الموقع. حاول مرة أخرى.',
    publish_location_error_unavailable: 'خدمة الموقع غير متاحة. تحقق من إعدادات GPS.',
    publish_location_error_unknown: 'فشل تحديد الموقع. لم يكتمل النشر.',

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

    wallet_import: 'استيراد المحفظة',
    wallet_importTitle: 'استيراد محفظة Web3',
    wallet_ph: 'أدخل المفتاح الخاص أو العبارة الأولية',
    wallet_cancel: 'إلغاء',
    wallet_confirm: 'تأكيد',
    wallet_success: 'تم استيراد المحفظة بنجاح!',
    wallet_tos_title: '⚠️ اتفاقية غير احتجازية',
    wallet_tos_1: 'أفهم تمامًا أن Unimaker هو برنامج غير احتجازي ولا يستطيع الفريق الوصول إلى مفاتيحي الخاصة ولم يقم بنسخها احتياطيًا.',
    wallet_tos_2: 'إذا فقدت عبارة الاسترداد أو قمت بحذف التطبيق، فإن Unimaker ليس لديه أي قدرة تقنية لمساعدتي في استرداد أموالي، وستفقد بشكل دائم.',
    wallet_tos_3: 'أي خسارة في الأموال بسبب اختراق جهازي الشخصي أو تعرضه للقرصنة ليست مسؤولية Unimaker.',
    wallet_tos_agree: 'لقد قرأت ووافقت على جميع الشروط أعلاه',

    channel_manage: 'إدارة القنوات',
    channel_tip: 'ضغط مطول للترتيب',
};

export const translations: Record<LocaleCode, Partial<Translations>> = {
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
    const base = en as Translations;
    const override = translations[locale as LocaleCode];
    if (!override || locale === 'en') return base;
    return { ...base, ...override } as Translations;
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
