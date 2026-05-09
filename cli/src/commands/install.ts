import fs from 'fs';

interface InstallOptions {
  entryFile: string;
  sdkImport: string;
  instrumentCode: string;
}

export async function installInstrumentation(options: InstallOptions): Promise<void> {
  let content = fs.readFileSync(options.entryFile, 'utf-8');

  // Check if already instrumented
  if (content.includes('AgentMonitor') && content.includes('autoInstrument')) {
    return;
  }

  // Insert SDK import at the top
  const lines = content.split('\n');
  let insertIndex = 0;

  // Find the last import statement
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ') || lines[i].trim().startsWith('require(')) {
      insertIndex = i + 1;
    }
  }

  lines.splice(insertIndex, 0, '', options.sdkImport, options.instrumentCode);

  fs.writeFileSync(options.entryFile, lines.join('\n'), 'utf-8');
}
