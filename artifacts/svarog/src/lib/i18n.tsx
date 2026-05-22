import { createContext, useContext, useState, useEffect } from "react";

const STORAGE_KEY = "svarog_language";

const translations = {
  en: {
    // Nav
    nav_dashboard: "Dashboard",
    nav_launch: "Token Launch",
    nav_bundles: "Bundles",
    nav_wallets: "Wallets",
    nav_bumpbot: "Bump Bot",
    nav_settings: "Settings",
    // Layout / topbar
    connected: "Connected",
    connect_wallet: "Connect Wallet",
    connect_phantom: "Connect Phantom",
    connecting: "Connecting...",
    disconnect: "Disconnect",
    balance: "Balance",
    mainnet: "Mainnet",
    devnet: "Devnet",
    install_phantom: "Install Phantom",
    or_enter_manually: "or enter manually",
    wallet_address_placeholder: "Your Solana wallet address...",
    cancel: "Cancel",
    connect: "Connect",
    // Wallets
    wallets_title: "Wallets",
    wallets_subtitle: "Manage your Solana keypairs",
    generate: "Generate",
    bulk_generate: "Bulk Generate",
    import_wallet: "Import",
    delete_selected: "Delete Selected",
    select_all: "Select all",
    deselect_all: "Deselect all",
    all_groups: "All groups",
    storage_usage: "Storage Usage",
    wallet_slots_remaining: "wallet slots remaining",
    used: "used",
    no_wallets: "No wallets yet",
    no_wallets_desc: "Generate your first wallet to get started",
    wallet_generated: "Wallet generated",
    wallet_imported: "Wallet imported",
    wallet_deleted: "Wallet deleted",
    wallets_deleted: "wallets deleted",
    invalid_key: "Invalid private key",
    connect_first: "Connect wallet first",
    private_key_label: "Private Key",
    label_optional: "Label (optional)",
    group_optional: "Group (optional)",
    num_wallets: "Number of Wallets",
    bulk_generate_confirm: "Generate Wallets",
    import_confirm: "Import",
    generated_wallets: "Generated",
    // Launch
    token_launch: "Token Launch",
    token_launch_subtitle: "Launch meme tokens on Pump.Fun with bundled wallets",
    new_bundle: "New Bundle",
    new_bundle_desc: "Create and launch a new token with multiple bundled wallets buying simultaneously at launch to simulate demand.",
    vamp: "VAMP",
    vamp_desc: "Copy an existing token's metadata (name, image, description) from Pump.Fun and relaunch it with your bundle.",
    cto: "CTO",
    cto_desc: "Take over an existing token using your own wallets. Coordinate a community takeover with your bundle.",
    coming_soon: "Coming Soon",
    open: "Open",
    close: "Close",
    launch_bundle: "Launch Bundle",
    launching: "Launching...",
    vamp_launch: "VAMP Launch",
    token_name: "Token Name",
    token_symbol: "Symbol",
    description: "Description",
    token_image: "Token Image",
    image_required: "Required — Pump.Fun needs an image",
    click_or_drag: "Click to upload or drag & drop",
    image_formats: "PNG, JPG, GIF up to 5MB",
    bundled_wallets: "Bundled Wallets",
    sol_per_wallet: "SOL per Wallet",
    total: "Total",
    across: "across",
    source_token_ca: "Source Token Contract Address",
    // Dashboard
    dashboard: "Dashboard",
    todays_earnings: "Today's Earnings",
    bundles_launched: "Bundles Launched",
    total_balance: "Total Balance",
    pnl: "PNL",
    recent_activity: "Recent Activity",
    market_prices: "Market Prices",
    no_activity: "No activity yet",
    no_activity_desc: "Launch your first token to see activity here",
    connect_to_see_stats: "Connect wallet to see your stats",
    // Settings
    settings: "Settings",
    account: "Account",
    network_rpc: "Network & RPC",
    notifications: "Notifications",
    quick_actions: "Quick Actions",
    save: "Save",
    saving: "Saving...",
    settings_saved: "Settings saved",
    // Bump Bot
    bump_bot: "Bump Bot",
    bump_bot_subtitle: "Automate token visibility with timed bump transactions",
    // Bundles
    bundles: "Bundles",
    bundles_subtitle: "Your token launch history",
  },
  ar: {
    // Nav
    nav_dashboard: "لوحة التحكم",
    nav_launch: "إطلاق العملة",
    nav_bundles: "الحزم",
    nav_wallets: "المحافظ",
    nav_bumpbot: "بوت الارتفاع",
    nav_settings: "الإعدادات",
    // Layout / topbar
    connected: "متصل",
    connect_wallet: "ربط المحفظة",
    connect_phantom: "ربط Phantom",
    connecting: "جارٍ الاتصال...",
    disconnect: "قطع الاتصال",
    balance: "الرصيد",
    mainnet: "الشبكة الرئيسية",
    devnet: "شبكة التطوير",
    install_phantom: "تثبيت Phantom",
    or_enter_manually: "أو أدخل يدوياً",
    wallet_address_placeholder: "عنوان محفظة سولانا...",
    cancel: "إلغاء",
    connect: "اتصال",
    // Wallets
    wallets_title: "المحافظ",
    wallets_subtitle: "إدارة مفاتيح سولانا الخاصة بك",
    generate: "توليد",
    bulk_generate: "توليد مجمع",
    import_wallet: "استيراد",
    delete_selected: "حذف المحدد",
    select_all: "تحديد الكل",
    deselect_all: "إلغاء التحديد",
    all_groups: "جميع المجموعات",
    storage_usage: "استخدام التخزين",
    wallet_slots_remaining: "فتحة محفظة متبقية",
    used: "مستخدم",
    no_wallets: "لا توجد محافظ بعد",
    no_wallets_desc: "أنشئ محفظتك الأولى للبدء",
    wallet_generated: "تم توليد المحفظة",
    wallet_imported: "تم استيراد المحفظة",
    wallet_deleted: "تم حذف المحفظة",
    wallets_deleted: "محافظ محذوفة",
    invalid_key: "مفتاح خاص غير صالح",
    connect_first: "ربط المحفظة أولاً",
    private_key_label: "المفتاح الخاص",
    label_optional: "التسمية (اختياري)",
    group_optional: "المجموعة (اختياري)",
    num_wallets: "عدد المحافظ",
    bulk_generate_confirm: "توليد المحافظ",
    import_confirm: "استيراد",
    generated_wallets: "تم التوليد",
    // Launch
    token_launch: "إطلاق العملة",
    token_launch_subtitle: "أطلق عملات على Pump.Fun بمحافظ مجمعة",
    new_bundle: "حزمة جديدة",
    new_bundle_desc: "أنشئ وأطلق عملة جديدة مع عدة محافظ تشتري في وقت واحد لمحاكاة الطلب.",
    vamp: "VAMP",
    vamp_desc: "انسخ بيانات عملة موجودة من Pump.Fun وأعد إطلاقها بحزمتك.",
    cto: "CTO",
    cto_desc: "استحوذ على عملة موجودة باستخدام محافظك ونسق استحواذ المجتمع.",
    coming_soon: "قريباً",
    open: "فتح",
    close: "إغلاق",
    launch_bundle: "إطلاق الحزمة",
    launching: "جارٍ الإطلاق...",
    vamp_launch: "إطلاق VAMP",
    token_name: "اسم العملة",
    token_symbol: "الرمز",
    description: "الوصف",
    token_image: "صورة العملة",
    image_required: "مطلوب — Pump.Fun يحتاج صورة",
    click_or_drag: "انقر للرفع أو اسحب وأفلت",
    image_formats: "PNG، JPG، GIF حتى 5 ميغابايت",
    bundled_wallets: "المحافظ المجمعة",
    sol_per_wallet: "SOL لكل محفظة",
    total: "الإجمالي",
    across: "عبر",
    source_token_ca: "عنوان عقد العملة المصدر",
    // Dashboard
    dashboard: "لوحة التحكم",
    todays_earnings: "أرباح اليوم",
    bundles_launched: "الحزم المُطلقة",
    total_balance: "الرصيد الكلي",
    pnl: "الربح والخسارة",
    recent_activity: "النشاط الأخير",
    market_prices: "أسعار السوق",
    no_activity: "لا يوجد نشاط بعد",
    no_activity_desc: "أطلق عملتك الأولى لرؤية النشاط هنا",
    connect_to_see_stats: "ربط المحفظة لرؤية إحصائياتك",
    // Settings
    settings: "الإعدادات",
    account: "الحساب",
    network_rpc: "الشبكة و RPC",
    notifications: "الإشعارات",
    quick_actions: "الإجراءات السريعة",
    save: "حفظ",
    saving: "جارٍ الحفظ...",
    settings_saved: "تم حفظ الإعدادات",
    // Bump Bot
    bump_bot: "بوت الارتفاع",
    bump_bot_subtitle: "أتمتة ظهور العملة بمعاملات ارتفاع مؤقتة",
    // Bundles
    bundles: "الحزم",
    bundles_subtitle: "سجل إطلاقات عملاتك",
  },
} as const;

type Lang = keyof typeof translations;
type TranslationKey = keyof typeof translations.en;

interface I18nContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextType>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
  isRTL: false,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved === "ar" || saved === "en") ? saved : "en";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = l;
  };

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (key: TranslationKey): string => translations[lang][key] ?? translations.en[key] ?? key;
  const isRTL = lang === "ar";

  return (
    <I18nContext.Provider value={{ lang, setLang, t, isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
