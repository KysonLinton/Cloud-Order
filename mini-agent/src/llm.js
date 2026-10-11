/**
 * OpenAI 兼容协议的聊天客户端（支持流式 + Function Calling）。
 * 适用于 OpenAI / DeepSeek / 通义 / Kimi / 智谱 / Ollama / LM Studio 等。
 */

function joinUrl(baseUrl, suffix) {
  return `${(baseUrl || '').replace(/\/+$/, '')}${suffix}`;
}

/** 把一次完整的响应消息规范化 */
function normalizeMessage(message = {}) {
  const toolCalls = (message.tool_calls || []).map((tc, i) => ({
    id: tc.id || `call_${i}_${Date.now()}`,
    name: tc.function?.name || '',
    arguments: tc.function?.arguments ?? ''
  }));
  return {
    content: message.content || '',
    reasoning: message.reasoning_content || '',
    toolCalls
  };
}

/** 解析 SSE 流，边收边回调 */
async function readStream(res, { onDelta, onReasoning, signal }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  const toolCalls = [];
  let finishReason = null;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const choice = json.choices?.[0];
    if (!choice) return;
    const delta = choice.delta || choice.message || {};
    if (delta.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onReasoning?.(delta.reasoning_content);
    }
    for (const tc of delta.tool_calls || []) {
      const idx = tc.index ?? toolCalls.length;
      if (!toolCalls[idx]) {
        toolCalls[idx] = { id: '', name: '', arguments: '' };
      }
      const slot = toolCalls[idx];
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  return {
    content,
    reasoning,
    finishReason,
    toolCalls: toolCalls.filter(Boolean).map((tc, i) => ({
      id: tc.id || `call_${i}_${Date.now()}`,
      name: tc.name,
      arguments: tc.arguments
    }))
  };
}

/**
 * 发起一次对话请求。
 * @returns {Promise<{content:string, toolCalls:Array, finishReason:string|null, usage:object|null}>}
 */
export async function chatCompletion({ config, messages, tools, onDelta, onReasoning, signal }) {
  const useStream = Boolean(config.stream && (onDelta || onReasoning));
  const body = {
    model: config.model,
    messages,
    stream: useStream
  };
  if (typeof config.temperature === 'number') body.temperature = config.temperature;
  if (typeof config.maxTokens === 'number') body.max_tokens = config.maxTokens;
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs || 180000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  let res;
  try {
    res = await fetch(joinUrl(config.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw new Error(`无法连接模型服务 ${config.baseUrl}：${err.message}`);
  }

  try {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint =
        res.status === 401
          ? '（API Key 无效或缺失，请检查 config.json 的 apiKey）'
          : res.status === 404
            ? `（接口不存在，检查 baseUrl 是否需要 /v1 结尾：${config.baseUrl}）`
            : '';
      throw new Error(`模型服务返回 ${res.status} ${res.statusText} ${hint}\n${text.slice(0, 800)}`);
    }

    if (!useStream) {
      const json = await res.json();
      const choice = json.choices?.[0] || {};
      const normalized = normalizeMessage(choice.message);
      if (normalized.content) onDelta?.(normalized.content);
      return { ...normalized, finishReason: choice.finish_reason || null, usage: json.usage || null };
    }

    const result = await readStream(res, { onDelta, onReasoning, signal });
    return { ...result, usage: null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
