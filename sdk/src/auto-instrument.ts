import type { AgentMonitor } from './index.js';

interface OpenAIOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

interface OpenAIResponse {
  choices: Array<{ message: { content: string; role: string } }>;
  usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
  [key: string]: unknown;
}

function patchCreate(completionsObj: any, monitor: AgentMonitor): void {
  if (!completionsObj || typeof completionsObj.create !== 'function') return;

  const originalCreate = completionsObj.create;

  completionsObj.create = async function (
    options: OpenAIOptions,
    ...rest: unknown[]
  ): Promise<OpenAIResponse> {
    const startTime = Date.now();
    const model = options.model || 'unknown';

    try {
      const result = await originalCreate.call(this, options, ...rest);
      const latencyMs = Date.now() - startTime;

      await monitor.traceLLM(
        model,
        {
          model,
          messages: options.messages,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
        },
        {
          choices: result.choices,
          usage: result.usage,
        } as any,
        latencyMs,
        true
      );

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      await monitor.traceLLM(
        model,
        {
          model,
          messages: options.messages,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
        },
        null,
        latencyMs,
        false,
        error instanceof Error ? error.message : String(error)
      );

      throw error;
    }
  };
}

export function autoInstrumentOpenAI(
  OpenAIClass: any,
  monitor: AgentMonitor
): void {
  if (!OpenAIClass) return;

  // Strategy 1: Patch prototype if chat.completions.create exists there
  const proto = OpenAIClass.prototype;
  if (proto && proto.chat && proto.chat.completions && typeof proto.chat.completions.create === 'function') {
    patchCreate(proto.chat.completions, monitor);
    return;
  }

  // Strategy 2: Wrap constructor to patch instances that use class-field syntax
  // Store reference to original constructor
  const OriginalConstructor = OpenAIClass;

  // Create a wrapper that intercepts `new` calls
  function WrappedConstructor(this: any, ...args: any[]) {
    const instance = Reflect.construct(OriginalConstructor, args, WrappedConstructor);
    if (instance.chat && instance.chat.completions && typeof instance.chat.completions.create === 'function') {
      patchCreate(instance.chat.completions, monitor);
    }
    return instance;
  }

  // Copy prototype
  Object.setPrototypeOf(WrappedConstructor, OriginalConstructor);
  WrappedConstructor.prototype = OriginalConstructor.prototype;
  Object.defineProperty(WrappedConstructor, 'name', { value: OriginalConstructor.name, configurable: true });
  Object.defineProperty(WrappedConstructor, 'length', { value: OriginalConstructor.length, configurable: true });

  // Copy static properties
  for (const key of Object.getOwnPropertyNames(OriginalConstructor)) {
    if (key !== 'prototype' && key !== 'name' && key !== 'length') {
      try {
        const desc = Object.getOwnPropertyDescriptor(OriginalConstructor, key);
        if (desc) Object.defineProperty(WrappedConstructor, key, desc);
      } catch {}
    }
  }

  // Replace the original class
  // This works because we're mutating the export reference in CJS,
  // but in ESM the caller needs to use the returned value or mutate their own reference.
  // For simplicity, we also support passing instances directly via autoInstrument().
}

export function autoInstrumentOpenAIInstance(
  instance: any,
  monitor: AgentMonitor
): void {
  if (!instance) return;
  if (instance.chat && instance.chat.completions && typeof instance.chat.completions.create === 'function') {
    patchCreate(instance.chat.completions, monitor);
  }
}

export interface AutoInstrumentOptions {
  openAI?: any;
  openAIInstance?: any;
}

export function autoInstrument(
  monitor: AgentMonitor,
  options: AutoInstrumentOptions = {}
): void {
  if (options.openAI) {
    autoInstrumentOpenAI(options.openAI, monitor);
  }
  if (options.openAIInstance) {
    autoInstrumentOpenAIInstance(options.openAIInstance, monitor);
  }
}
