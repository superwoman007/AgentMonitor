import fs from 'fs';

interface InitOptions {
  projectName: string;
  apiKey: string;
  baseUrl?: string;
  outputPath: string;
}

export async function initConfig(options: InitOptions): Promise<void> {
  const content = `# AgentMonitor Configuration
project_name: ${options.projectName}
api_key: ${options.apiKey}
base_url: ${options.baseUrl || 'http://localhost:3000'}

# Auto-instrumentation settings
auto_instrument:
  openai: true
  anthropic: false
  langchain: false

# Evaluation settings
evaluation:
  default_dataset_type: 'chat'
  auto_regression: true
`;

  fs.writeFileSync(options.outputPath, content, 'utf-8');
}
