import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '../App';

/**
 * API 接口描述项
 * @property method - HTTP 方法（POST/GET/PATCH）
 * @property path - 接口路径（相对服务根地址）
 * @property desc - 接口用途说明
 */
interface ApiEndpoint {
  method: string;
  path: string;
  desc: string;
}

/**
 * 对外提供的遥测/平台接口列表
 * 说明：所有接口均以 /api 为前缀，鉴权使用设置页创建的 API Key（am_ 开头）。
 */
const API_ENDPOINTS: ApiEndpoint[] = [
  { method: 'POST', path: '/api/v1/traces', desc: '上报单条 Trace（LLM/工具/链路等执行记录）' },
  { method: 'POST', path: '/api/v2/telemetry/batch', desc: '批量上报遥测事件（trace/span，单批 ≤ 1000 条，推荐）' },
  { method: 'POST', path: '/api/v1/spans', desc: '上报 Span 级分布式追踪数据' },
  { method: 'POST', path: '/api/v1/feedbacks', desc: '上报用户对某次执行的反馈/评分' },
  { method: 'POST', path: '/api/v1/snapshots', desc: '上报断点快照（调试回放）' },
  { method: 'GET', path: '/api/v1/breakpoints/public', desc: '拉取当前项目生效的断点规则' },
  { method: 'PATCH', path: '/api/v1/traces/:id', desc: '更新某条 Trace（补充结果/标注）' },
  { method: 'GET', path: '/api/v1/sessions/:id', desc: '查询会话详情' },
  { method: 'GET', path: '/ws', desc: 'WebSocket 实时推送（Trace/告警，子协议或 query 传 token）' },
];

/**
 * ApiDocs 组件
 * 功能：在设置页展示对外 HTTP API 的鉴权方式、接口列表与可复制的 curl 调用示例，
 *       便于用户在不集成 SDK 的情况下直接对接（含自签证书 -k 跳过校验提示）。
 * 参数：无
 * 返回值：JSX.Element - API 调用文档卡片
 */
export function ApiDocs() {
  const { t } = useTranslation() as { t: Record<string, string> };
  const [copied, setCopied] = useState<string | null>(null);
  /** 折叠状态：默认收起，点击标题栏展开/收起整个 API 文档板块 */
  const [expanded, setExpanded] = useState(false);

  /** 当前页面服务根地址，作为 API base URL（部署后自动为 https://<服务器IP>） */
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://<服务器地址>';

  /**
   * 复制文本到剪贴板，并短暂展示"已复制"状态
   * @param text - 待复制文本
   * @param key - 复制按钮唯一标识
   * 返回值：void
   */
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  /**
   * renderCodeBlock 内部渲染函数
   * 功能：渲染带标签与复制按钮的代码块
   * @param code - 代码内容
   * @param tag - 右上角语言标签
   * @param copyKey - 复制按钮唯一标识
   * 返回值：JSX.Element
   */
  const renderCodeBlock = (code: string, tag: string, copyKey: string) => (
    <div className="relative group">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{tag}</span>
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

  /** 鉴权请求头示例 */
  const authCode = [
    '# 方式一：X-API-Key 请求头',
    'X-API-Key: am_你的API_KEY',
    '',
    '# 方式二：Authorization Bearer 请求头',
    'Authorization: Bearer am_你的API_KEY',
  ].join('\n');

  /** v1 单条 Trace 上报 curl 示例（-k 用于自签证书跳过校验） */
  const traceCurl = [
    `curl -k -X POST '${baseUrl}/api/v1/traces' \\`,
    "  -H 'Content-Type: application/json' \\",
    "  -H 'X-API-Key: am_你的API_KEY' \\",
    '  -d \'{',
    '    "traceType": "llm",',
    '    "name": "gpt-4o",',
    '    "sessionId": "sess-001",',
    '    "input": { "messages": [{ "role": "user", "content": "你好" }] },',
    '    "output": { "content": "你好，有什么可以帮你？" },',
    '    "latencyMs": 320,',
    '    "status": "success",',
    '    "metadata": { "model": "gpt-4o", "tokens": 128 }',
    '  }\'',
    '',
    '# 成功返回 201；traceType 与 name 为必填字段',
  ].join('\n');

  /** v2 批量上报 curl 示例（推荐，单次请求上报多条事件） */
  const batchCurl = [
    `curl -k -X POST '${baseUrl}/api/v2/telemetry/batch' \\`,
    "  -H 'Content-Type: application/json' \\",
    "  -H 'Authorization: Bearer am_你的API_KEY' \\",
    '  -d \'{',
    '    "events": [',
    '      {',
    '        "schemaVersion": "2.0",',
    '        "eventId": "evt-1",',
    '        "eventType": "trace.end",',
    '        "occurredAt": "2026-09-05T12:00:00.000Z",',
    '        "payload": {',
    '          "traceId": "trc-001",',
    '          "traceType": "llm",',
    '          "name": "gpt-4o",',
    '          "status": "success",',
    '          "latencyMs": 320',
    '        }',
    '      }',
    '    ]',
    '  }\'',
    '',
    '# 成功返回 202，body 含每条事件的 receipt（accepted/rejected）',
    '# eventType 支持：session.start/end、trace.start/end、span.start/end/event、feedback.created',
  ].join('\n');

  /** 反馈上报与 WebSocket 示例 */
  const otherCurl = [
    `# 上报用户反馈（rating 仅支持 1=好评 / 0=中性 / -1=差评）`,
    `curl -k -X POST '${baseUrl}/api/v1/feedbacks' \\`,
    "  -H 'Content-Type: application/json' \\",
    "  -H 'X-API-Key: am_你的API_KEY' \\",
    '  -d \'{ "sessionId": "sess-001", "rating": 1, "comment": "回答准确" }\'',
    '',
    '# WebSocket 实时订阅（自签证书用 wss，token 通过 query 或子协议传递）',
    `wss://${baseUrl.replace(/^https?:\/\//, '')}/ws?token=am_你的API_KEY`,
  ].join('\n');

  /** HTTP 方法对应的标签颜色样式 */
  const methodColor: Record<string, string> = {
    POST: 'bg-green-100 text-green-700',
    GET: 'bg-blue-100 text-blue-700',
    PATCH: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <span>
          <span className="block text-lg font-semibold text-gray-900">{t.apiDocs}</span>
          <span className="block text-sm text-gray-500 mt-0.5">{t.apiDocsDesc}</span>
        </span>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
      <>

      {/* base URL */}
      <div className="mb-4 mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-700">{t.sdkBaseUrl}:</span>
        <code className="px-2 py-1 bg-blue-50 text-blue-800 text-sm rounded font-mono break-all">{baseUrl}</code>
      </div>

      {/* 鉴权方式 */}
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{t.apiAuth}</h3>
      <p className="text-xs text-gray-500 mb-2">{t.apiAuthDesc}</p>
      <div className="mb-5">{renderCodeBlock(authCode, 'http', 'api-auth')}</div>

      {/* 接口列表 */}
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.apiEndpoints}</h3>
      <div className="mb-5 overflow-x-auto">
        <table className="w-full text-sm border border-gray-200 rounded-lg">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium">Method</th>
              <th className="px-3 py-2 font-medium">Path</th>
              <th className="px-3 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {API_ENDPOINTS.map((ep) => (
              <tr key={ep.method + ep.path} className="border-t border-gray-100">
                <td className="px-3 py-2 align-top">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${methodColor[ep.method] || 'bg-gray-100 text-gray-700'}`}>
                    {ep.method}
                  </span>
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-gray-800 whitespace-nowrap">{ep.path}</td>
                <td className="px-3 py-2 align-top text-xs text-gray-600">{ep.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* curl 示例 */}
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.apiExample}</h3>
      <div className="mb-5">{renderCodeBlock(traceCurl, 'curl', 'api-trace')}</div>

      <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.apiV2Example}</h3>
      <div className="mb-5">{renderCodeBlock(batchCurl, 'curl', 'api-batch')}</div>

      <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.apiRespExample}</h3>
      <div className="mb-2">{renderCodeBlock(otherCurl, 'curl', 'api-other')}</div>

      <p className="text-xs text-gray-400">
        注：示例中 <code className="px-1 bg-gray-100 rounded">-k</code> 用于跳过自签证书校验；生产环境替换为受信任证书后可去掉。
      </p>
      </>
      )}
    </div>
  );
}
