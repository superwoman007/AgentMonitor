import { Lang } from '../i18n';

interface LanguageToggleProps {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export function LanguageToggle({ lang, setLang }: LanguageToggleProps) {
  return (
    <button
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
    >
      {lang === 'zh' ? '🌐 EN' : '🌐 中文'}
    </button>
  );
}
