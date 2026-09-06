import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '../App';

/**
 * SDK 语言类型
 * - typescript: TypeScript / Node.js SDK
 * - python: Python SDK
 * - go: Go SDK
 */
type SdkLang = 'typescript' | 'python' | 'go';

/**
 * SDK 安装包描述
 * @property lang - SDK 语言标识
 * @property label - 页面展示名称
 * @property file - public 目录下的下载路径（Vite 会将 public/ 映射到站点根路径）
 * @property size - 安装包大小展示文本
 */
interface SdkPackage {
  lang: SdkLang;
  label: string;
  file: string;
  size: string;
}

/** 三个语言 SDK 安装包的下载配置 */
const SDK_PACKAGES: SdkPackage[] = [
  { lang: 'typescript', label: 'TypeScript / Node.js', file: '/sdks/agentmonitor-sdk-typescript.tar.gz', size: '≈49 KB' },
  { lang: 'python', label: 'Python', file: '/sdks/agentmonitor-sdk-python.tar.gz', size: '≈16 KB' },
  { lang: 'go', label: 'Go', file: '/sdks/agentmonitor-sdk-go.tar.gz', size: '≈22 KB' },
];

/**
 * SdkDownloads 组件
 * 功能：在设置页展示 SDK 下载入口、服务地址、各语言安装接入示例，
 *       以及自签证书场景下跳过 TLS 校验（方式二）的配置代码。
 * 参数：无
 * 返回值：JSX.Element - SDK 下载卡片
 */
export function SdkDownloads() {
  const { t } = useTranslation() as { t: Record<string, string> };
  const [activeLang, setActiveLang] = useState<SdkLang>('typescript');
  const [copied, setCopied] = useState<string | null>(null);
  /** 折叠状态：默认收起，点击标题栏展开/收起整个 SDK 下载板块 */
  const [expanded, setExpanded] = useState(false);

  /** 当前页面的服务根地址，作为 SDK 的 base URL（部署后自动为 https://<服务器IP>） */
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://<服务器地址>';

  /**
   * 复制文本到剪贴板，并短暂展示"已复制"状态
   * @param text - 待复制的文本内容
   * @param key - 用于区分多个复制按钮的唯一标识
   * 返回值：void
   */
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  /**
   * CodeBlock 内部渲染函数
   * 功能：渲染带语言标签与复制按钮的代码块
   * @param code - 代码内容
   * @param langTag - 语言标签（bash/ts/python/go）
   * @param copyKey - 复制按钮唯一标识
   * 返回值：JSX.Element
   */
  const renderCodeBlock = (code: string, langTag: string, copyKey: string) => (
    <div className="relative group">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{langTag}</span>
        <button
          onClick={() => handleCopy(code, copyKey)}
          className="text-[11px] px-2 py-0.5 bg-gray-700 text-gray-100 rounded hover:bg-gray-600 opacity-80"
        >
          {copied === copyKey ? '✓' : t.copy || 'Copy'}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 text-xs p-3 pt-7 rounded-lg overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );

  /**
   * getInstallCode 函数
   * 功能：根据语言生成安装与初始化接入示例代码（base URL 自动替换为当前服务地址）
   * @param target - SDK 语言类型
   * 返回值：string - 可直接复制的示例代码
   */
  const getInstallCode = (target: SdkLang): string => {
    if (target === 'typescript') {
      return [
        '# 1. 下载并解压安装包',
        'tar xzf agentmonitor-sdk-typescript.tar.gz',
        '',
        '# 2. 安装依赖并构建',
        'cd sdk && npm install && npm run build',
        '',
        '// 3. 在你的 Agent 代码中初始化',
        "import AgentMonitor from '@agentmonitor/sdk';",
        '',
        'const monitor = AgentMonitor.init({',
        "  apiKey: 'am_你的API_KEY',   // 在上方「API Keys」卡片创建",
        `  baseUrl: '${baseUrl}',`,
        '});',
        '',
        '// 上报一次 LLM 调用',
        'await monitor.trace({',
        "  traceType: 'llm',",
        "  name: 'gpt-4o',",
        '  input: { messages: [{ role: "user", content: "你好" }] },',
        '  output: { content: "你好，有什么可以帮你？" },',
        '  latencyMs: 320,',
        "  status: 'success',",
        '});',
      ].join('\n');
    }
    if (target === 'python') {
      return [
        '# 1. 下载并解压安装包',
        'tar xzf agentmonitor-sdk-python.tar.gz',
        '',
        '# 2. 本地安装',
        'pip install ./',
        '',
        '# 3. 在你的 Agent 代码中初始化',
        'from agentmonitor import AgentMonitor, SDKConfig',
        '',
        'monitor = AgentMonitor.init(SDKConfig(',
        '    api_key="am_你的API_KEY",   # 在上方「API Keys」卡片创建',
        `    base_url="${baseUrl}",`,
        '))',
        '',
        '# 上报一次 LLM 调用',
        'monitor.trace(TraceData(',
        '    trace_type="llm",',
        '    name="gpt-4o",',
        '    input={"messages": [{"role": "user", "content": "你好"}]},',
        '    output={"content": "你好，有什么可以帮你？"},',
        '    latency_ms=320,',
        '    status="success",',
        '))',
      ].join('\n');
    }
    return [
      '# 1. 下载并解压安装包',
      'tar xzf agentmonitor-sdk-go.tar.gz',
      '',
      '# 2. 在你的 Go 项目中引用本地 SDK',
      'go mod edit -replace github.com/superwoman007/AgentMonitor/sdk-go=./sdk-go',
      'go mod tidy',
      '',
      '// 3. 在你的 Agent 代码中初始化',
      'import "github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor"',
      '',
      'monitor := agentmonitor.Init(&agentmonitor.SDKConfig{',
      '\tAPIKey:  "am_你的API_KEY", // 在上方「API Keys」卡片创建',
      `\tBaseURL: "${baseUrl}",`,
      '})',
      'defer monitor.Close()',
      '',
      '// 上报一次 LLM 调用',
      'monitor.Trace(agentmonitor.TraceData{',
      '\tTraceType: "llm",',
      '\tName:      "gpt-4o",',
      '\tLatencyMs: 320,',
      '\tStatus:    "success",',
      '})',
    ].join('\n');
  };

  /**
   * getTlsCode 函数
   * 功能：根据语言生成"方式二：跳过自签证书 TLS 校验"的配置代码
   * @param target - SDK 语言类型
   * 返回值：string - 跳过 TLS 校验的配置代码
   */
  const getTlsCode = (target: SdkLang): string => {
    if (target === 'typescript') {
      return [
        '# Node.js 运行前设置环境变量即可跳过自签证书校验',
        'export NODE_TLS_REJECT_UNAUTHORIZED=0',
        'node your-agent.js',
        '',
        '# 或在代码入口最顶部设置（不推荐用于生产公网环境）',
        "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
      ].join('\n');
    }
    if (target === 'python') {
      return [
        '# 在 import agentmonitor 之后、init 之前加入以下补丁，',
        '# 让 requests 跳过自签证书校验（仅用于内网/测试环境）',
        'import requests',
        '',
        '_original_request = requests.Session.request',
        'def _insecure_request(self, *args, **kwargs):',
        '    kwargs["verify"] = False',
        '    return _original_request(self, *args, **kwargs)',
        '',
        'requests.Session.request = _insecure_request',
      ].join('\n');
    }
    return [
      '// Go 程序中设置全局 HTTP 客户端跳过自签证书校验',
      'import (',
      '\t"crypto/tls"',
      '\t"net/http"',
      ')',
      '',
      'func init() {',
      '\thttp.DefaultTransport.(*http.Transport).TLSClientConfig = &tls.Config{',
      '\t\tInsecureSkipVerify: true,',
      '\t}',
      '}',
    ].join('\n');
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <span>
          <span className="block text-lg font-semibold text-gray-900">{t.sdkDownloads}</span>
          <span className="block text-sm text-gray-500 mt-0.5">{t.sdkDownloadsDesc}</span>
        </span>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
      <>

      {/* 服务地址展示：SDK 接入时填写的 base URL */}
      <div className="mb-4 mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-700">{t.sdkBaseUrl}:</span>
        <code className="px-2 py-1 bg-blue-50 text-blue-800 text-sm rounded font-mono break-all">{baseUrl}</code>
        <button
          onClick={() => handleCopy(baseUrl, 'baseurl')}
          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
        >
          {copied === 'baseurl' ? '✓' : t.copy}
        </button>
      </div>

      {/* 三个 SDK 下载按钮 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {SDK_PACKAGES.map((pkg) => (
          <a
            key={pkg.lang}
            href={pkg.file}
            download={pkg.file.split('/').pop()}
            className="flex flex-col items-center justify-center gap-1 px-4 py-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-center"
          >
            <span className="text-sm font-semibold text-gray-900">{pkg.label}</span>
            <span className="text-xs text-gray-500">{pkg.size} · .tar.gz</span>
            <span className="mt-1 text-xs text-blue-600 font-medium">⬇ {t.sdkDownload}</span>
          </a>
        ))}
      </div>

      {/* 语言切换 Tab：安装接入示例 */}
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.sdkInstall}</h3>
      <div className="flex gap-1 mb-3 border-b">
        {SDK_PACKAGES.map((pkg) => (
          <button
            key={pkg.lang}
            onClick={() => setActiveLang(pkg.lang)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeLang === pkg.lang
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {pkg.label}
          </button>
        ))}
      </div>
      <div className="mb-6">
        {renderCodeBlock(getInstallCode(activeLang), activeLang === 'typescript' ? 'bash+ts' : activeLang, `install-${activeLang}`)}
      </div>

      {/* 方式二：跳过 TLS 校验说明（自签证书场景） */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h3 className="text-sm font-semibold text-amber-900 mb-1">⚠ {t.sdkTlsTitle}</h3>
        <p className="text-xs text-amber-800 mb-3">{t.sdkTlsDesc}</p>
        {renderCodeBlock(getTlsCode(activeLang), activeLang === 'typescript' ? 'bash' : activeLang, `tls-${activeLang}`)}
      </div>
      </>
      )}
    </div>
  );
}
