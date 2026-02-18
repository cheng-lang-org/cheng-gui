import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { getTranslations, type Translations } from './translations';

interface LocaleContextType {
    locale: string;
    setLocale: (locale: string) => void;
    t: Translations;
}

const LocaleContext = createContext<LocaleContextType>({
    locale: 'zh-CN',
    setLocale: () => { },
    t: getTranslations('zh-CN'),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState(() => {
        return localStorage.getItem('app_locale') || 'zh-CN';
    });

    const setLocale = useCallback((newLocale: string) => {
        setLocaleState(newLocale);
        localStorage.setItem('app_locale', newLocale);
        localStorage.setItem('app_language_set', 'true');
    }, []);

    const t = getTranslations(locale);

    return (
        <LocaleContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    return useContext(LocaleContext);
}
