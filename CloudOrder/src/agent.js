/**
 * Agent 主循环：对话 -> 工具调用 -> 观察结果 -> 再对话，直到给出最终回答。
 */
import { chatCompletion } from './llm.js';
import { assessToolCall } from './permissions.js';
import { buildSkillsPrompt } from './registry.js';
import { formatProfileForPrompt } from './profile.js';
import { formatFeedbackForPrompt } from './feedback.js';
import { color, truncate } from './utils.js';

/** 把工具定义转成 OpenAI Function Calling 格式 */
function toToolSchema(tools) {
  return [...tools.values()].map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} }
    }
  }));
}

export class Agent {
  /**
   * @param {object} opts
   * @param {object} opts.config
   * @param {ReturnType<import('./registry.js').createRegistry>} opts.registry
   * @param {object} opts.ui  交互层：onAssistantDelta / onAssistantMessage / onReasoning / onToolStart / onToolEnd / onNotice / requestApproval
   */
  constructor({ config, registry, ui = {} }) {
    this.config = config;
    this.registry = registry;
    this.ui = ui;
    this.messages = [];
    this.abort = null;
  }

  /** 重建系统提示（技能/插件可能变化） */
  buildSystemPrompt() {
    const { skills, plugins } = this.registry;
    const parts = [this.config.systemPrompt];

    // 工具清单摘要，帮助模型形成整体认知
    const toolNames = [...this.registry.tools.keys()];
    if (toolNames.length) {
      parts.push('', `# 可用工具\n${toolNames.join(', ')}`);
    }

    const skillsPrompt = buildSkillsPrompt(skills);
    if (skillsPrompt) parts.push(skillsPrompt);

    const pluginPrompts = plugins.filter((p) => p.systemPrompt).map((p) => p.systemPrompt);
    if (pluginPrompts.length) parts.push('', '# 插件能力', ...pluginPrompts);

    // 用户档案（每次重建系统提示时读取，保证用户在网页/CLI 更新后立即生效）
    const profilePrompt = formatProfileForPrompt();
    if (profilePrompt) parts.push('', profilePrompt);

    // 用户反馈（往次推荐评价的归纳）：让模型把历史反馈当成偏好依据
    const feedbackPrompt = formatFeedbackForPrompt();
    if (feedbackPrompt) parts.push('', feedbackPrompt);

    parts.push(
      '',
      '# 工作环境',
      `- 平台：${process.platform}（shell 使用 PowerShell 语法）`,
      `- 工作区：${this.config.workspace}`,
      `- 文件路径默认相对于工作区`,
      '',
      '# 行为准则',
      '- 需要了解文件内容时，直接读，不要猜测。',
      '- 做多步任务前用一两句话说明计划；完成后概述你改动了什么。',
      '- 工具返回错误时，读懂错误再调整，不要机械重试。',
      '- 没有把握就明说，不要编造事实、文件内容或运行结果。'
    );
    return parts.filter(Boolean).join('\n');
  }

  /** 用当前系统提示重置会话（保留历史时可自行传入 messages） */
  reset(systemOverride) {
    this.messages = [{ role: 'system', content: systemOverride || this.buildSystemPrompt() }];
  }

  /** 追加一条用户消息 */
  addUser(text) {
    this.messages.push({ role: 'user', content: String(text) });
  }

  /** 追加一条纯文本助手消息（如 Web UI 注入的历史） */
  addAssistant(text) {
    this.messages.push({ role: 'assistant', content: String(text) });
  }

  /** 历史消息（不含 system），供持久化 */
  history() {
    return this.messages.filter((m) => m.role !== 'system');
  }

  setHistory(history) {
    this.messages = [{ role: 'system', content: this.buildSystemPrompt() }, ...history];
  }

  /** 中断正在进行的生成 */
  stop() {
    this.abort?.abort();
    this.abort = null;
  }

  /**
   * 处理一轮用户输入，内部可能循环多次工具调用。
   * @returns {Promise<{text:string, steps:number, stopped:boolean}>}
   */
  async run() {
    const { config, registry, ui } = this;
    const toolSchemas = toToolSchema(registry.tools);
    const controller = new AbortController();
    this.abort = controller;

    let finalText = '';
    let steps = 0;

    for (let step = 0; step < config.maxSteps; step++) {
      steps = step + 1;
      if (controller.signal.aborted) return { text: finalText, steps, stopped: true };

      let result;
      try {
        result = await chatCompletion({
          config,
          messages: this.messages,
          tools: toolSchemas,
          signal: controller.signal,
          onDelta: (chunk) => ui.onAssistantDelta?.(chunk),
          onReasoning: (chunk) => ui.onReasoning?.(chunk)
        });
      } catch (err) {
        ui.onError?.(err);
        return { text: finalText, steps, stopped: false, error: err.message };
      }

      const { content, reasoning, toolCalls } = result;

      // 记录助手消息（含 tool_calls，供下一轮模型参考）
      const assistantMsg = { role: 'assistant', content: content || '' };
      if (reasoning) assistantMsg.reasoning_content = reasoning;
      if (toolCalls.length) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' }
        }));
      }
      this.messages.push(assistantMsg);

      if (content) {
        finalText = finalText ? `${finalText}\n${content}` : content;
        ui.onAssistantMessage?.(content);
      }

      // 没有工具调用 -> 本轮结束
      if (!toolCalls.length) {
        return { text: finalText, steps, stopped: false };
      }

      // 依次执行工具
      for (const call of toolCalls) {
        if (controller.signal.aborted) break;
        const tool = registry.tools.get(call.name);
        const args = parseArgs(call.arguments);
        ui.onToolStart?.({ name: call.name, args, id: call.id });

        let output;
        let ok = true;
        if (!tool) {
          ok = false;
          output = `错误：不存在名为 "${call.name}" 的工具。可用工具：${[...registry.tools.keys()].join(', ')}`;
        } else {
          const assessment = assessToolCall(config, tool, args);
          if (assessment.decision === 'deny') {
            ok = false;
            output = `权限拒绝：${assessment.reason}`;
            ui.onNotice?.({ level: 'warn', text: assessment.reason });
          } else if (assessment.decision === 'ask') {
            const approved = await ui.requestApproval?.({
              tool,
              args,
              risk: assessment.risk,
              notes: assessment.notes
            });
            if (!approved) {
              ok = false;
              output = '用户拒绝了这次工具调用。请不要重复相同的调用，改为询问用户或换一种方式。';
            }
          }
          if (ok) {
            try {
              output = await tool.run(args, { config, workspace: config.workspace, signal: controller.signal, ui });
              output = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
            } catch (err) {
              ok = false;
              output = `工具执行出错：${err.message}`;
            }
          }
        }

        const text = truncate(output ?? '', config.outputLimit);
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: text
        });
        ui.onToolEnd?.({ name: call.name, id: call.id, ok, output: text });
      }
    }

    ui.onNotice?.({
      level: 'warn',
      text: `已达到最大工具调用轮数（maxSteps=${config.maxSteps}）。可以继续追问，或调大 config.json 中的 maxSteps。`
    });
    return { text: finalText, steps, stopped: false, maxStepsReached: true };
  }
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    // 有些模型会在 JSON 前后加垃圾字符
    const m = /\{[\s\S]*\}/.exec(String(raw));
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
    return { _raw: String(raw) };
  }
}

/** 把工具调用摘要格式化成人类可读的一行 */
export function describeToolCall(name, args) {
  const pick = (keys) => {
    for (const k of keys) {
      if (args[k]) return String(args[k]);
    }
    return '';
  };
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return `${color.cyan(name)} ${color.bold(pick(['path', 'file_path']))}`;
    case 'list_dir':
      return `${color.cyan(name)} ${pick(['path']) || '.'}`;
    case 'search_files':
      return `${color.cyan(name)} "${pick(['query'])}"`;
    case 'run_command':
      return `${color.cyan(name)} ${color.yellow(pick(['command']))}`;
    case 'fetch_url':
      return `${color.cyan(name)} ${pick(['url'])}`;
    case 'load_skill':
      return `${color.cyan(name)} ${color.magenta(pick(['name']))}`;
    default:
      return `${color.cyan(name)} ${JSON.stringify(args).slice(0, 160)}`;
  }
}
