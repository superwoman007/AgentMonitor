import fs from 'fs';
import path from 'path';

interface Detection {
  file: string;
  type: string;
  line: number;
  snippet: string;
}

interface ScanResult {
  detections: Detection[];
  summary: Record<string, number>;
}

export async function scanProject(projectPath: string): Promise<ScanResult> {
  const detections: Detection[] = [];
  const summary: Record<string, number> = {};

  const patterns = [
    { type: 'openai', regex: /from ['"]openai['"]\s*;?\s*$/m },
    { type: 'openai', regex: /require\(['"]openai['"]\)/ },
    { type: 'openai', regex: /new\s+OpenAI\s*\(/ },
    { type: 'openai', regex: /chat\.completions\.create\s*\(/ },
    { type: 'anthropic', regex: /from ['"]@anthropic\/sdk['"]/ },
    { type: 'anthropic', regex: /new\s+Anthropic\s*\(/ },
    { type: 'langchain', regex: /from ['"]langchain\// },
    { type: 'langchain', regex: /require\(['"]langchain\// },
    { type: 'langchain', regex: /LLMChain|AgentExecutor|ChatOpenAI/ },
  ];

  function scanFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          detections.push({
            file: filePath,
            type: pattern.type,
            line: i + 1,
            snippet: line.trim().slice(0, 80),
          });
          summary[pattern.type] = (summary[pattern.type] || 0) + 1;
        }
      }
    }
  }

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        walkDir(fullPath);
      } else if (entry.isFile() && /\.(ts|js|mjs|cjs|py)$/.test(entry.name)) {
        scanFile(fullPath);
      }
    }
  }

  walkDir(projectPath);

  return { detections, summary };
}
