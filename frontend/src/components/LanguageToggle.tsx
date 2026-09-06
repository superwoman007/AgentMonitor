import { useTranslation } from '../App';
import { Lang } from '../i18n';

interface LanguageToggleProps {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/**
 * 语言切换按钮
 * @param lang - 当前语言
 * @param setLang - 设置语言的方法
 * @returns 语言切换按钮组件
 */
export function LanguageToggle({ lang, setLang }: LanguageToggleProps) {
  const { t } = useTranslation();
  const nextLanguageLabel = lang === 'zh' ? 'Switch to English' : '切换到中文';

  return (
    <button
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      aria-label={nextLanguageLabel}
      title={nextLanguageLabel}
      className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
    >
      {lang === 'zh' ? t.langEn : t.langZh}
    </button>
  );
}
