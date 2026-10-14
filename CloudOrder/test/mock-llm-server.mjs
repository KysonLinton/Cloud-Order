/**
 * 本地 Mock 模型服务，用于在没有 API Key 的情况下测试整条链路。
 * 启动：node test/mock-llm-server.mjs   （监听 11435）
 * 然后：node src/index.js --base-url http://127.0.0.1:11435/v1 --model mock
 *
 * 它按最后一条消息的内容决定行为：
 *   - 含 "工具测试"  -> 走一次 read_file/run_command 的 tool_calls 往返
 *   - 含 "技能测试"  -> 先 load_skill 再总结
 *   - 其他           -> 直接回一段文字，并回显收到的上下文规模
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 11435);

function sseDelta(res, delta, finish = null) {
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}

function sseToolCall(res, name, args, id = 'call_1') {
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }]
          },
          finish_reason: null
        }
      ]
    })}\n\n`
  );
  // 分片发送 arguments，模拟真实流式
  const json = JSON.stringify(args);
  const mid = Math.floor(json.length / 2);
  for (const piece of [json.slice(0, mid), json.slice(mid)]) {
    res.write(
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] }, finish_reason: null }]
      })}\n\n`
    );
  }
  res.write(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`
  );
}

function handle(body) {
  const messages = body.messages || [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const rawContent = lastUser?.content;
  const isVision = Array.isArray(rawContent);
  const text = isVision
    ? (rawContent.find((c) => c.type === 'text')?.text || '')
    : rawContent || '';
  const toolResults = messages.filter((m) => m.role === 'tool');
  const toolNames = (body.tools || []).map((t) => t.function.name);
  const hasLoadSkill = toolResults.some((m) => m.name === 'load_skill');

  // 图片识别请求：返回一段可解析的衣物 JSON
  if (isVision) {
    return {
      kind: 'text',
      text:
        '{\n' +
        '  "name": "米白色针织开衫",\n' +
        '  "category": "针织/毛衣",\n' +
        '  "colors": ["米白"],\n' +
        '  "material": "羊毛混纺",\n' +
        '  "style": ["简约", "通勤"],\n' +
        '  "seasons": ["春", "秋"],\n' +
        '  "fit": "宽松",\n' +
        '  "brand": "",\n' +
        '  "tags": ["开衫", "纽扣"],\n' +
        '  "notes": "（Mock 模型识别结果）",\n' +
        '  "confidence": 0.82,\n' +
        '  "unsure": ["brand"]\n' +
        '}'
    };
  }

  // 第二轮：工具已经执行完，给出总结
  if (toolResults.length) {
    if (hasLoadSkill) {
      const skillDoc = toolResults.find((m) => m.name === 'load_skill')?.content || '';
      return { kind: 'text', text: `我已经读完技能说明（${skillDoc.length} 字符），准备按其中步骤执行。\n\n完成。` };
    }
    return {
      kind: 'text',
      text:
        `工具执行完毕，我收到了 ${toolResults.length} 条结果：\n` +
        toolResults.map((m) => `- ${m.name}: ${String(m.content).split('\n')[0].slice(0, 100)}`).join('\n') +
        `\n\n根据这些结果，任务已完成。`
    };
  }

  // 第一轮
  if (/技能测试|技能/.test(text) && toolNames.includes('load_skill')) {
    return { kind: 'tool', name: 'load_skill', args: { name: 'summarize-file' } };
  }
  if (/工具测试|读一下|看看.*文件/.test(text) && toolNames.includes('list_dir')) {
    return { kind: 'tool', name: 'list_dir', args: { path: '.', recursive: false } };
  }
  if (/命令测试|跑一下/.test(text) && toolNames.includes('run_command')) {
    return { kind: 'tool', name: 'run_command', args: { command: 'Get-Date -Format "yyyy-MM-dd HH:mm:ss"' } };
  }
  if (/时间/.test(text) && toolNames.includes('now_time')) {
    return { kind: 'tool', name: 'now_time', args: {} };
  }
  return {
    kind: 'text',
    text:
      `（Mock 模型）我收到了你的消息：“${text}”。\n` +
      `当前上下文包含 ${messages.length} 条消息，可用工具 ${toolNames.length} 个。\n` +
      `试试输入「工具测试」「技能测试」「命令测试」来验证工具链路。`
  };
}

const server = http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      /* ignore */
    }
    const plan = handle(body);

    if (!body.stream) {
      const message =
        plan.kind === 'tool'
          ? { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: plan.name, arguments: JSON.stringify(plan.args) } }] }
          : { role: 'assistant', content: plan.text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: body.model, choices: [{ index: 0, message, finish_reason: 'stop' }], usage: { total_tokens: 0 } }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    if (plan.kind === 'tool') {
      sseToolCall(res, plan.name, plan.args);
    } else {
      // 逐字流式输出，模拟真实体验
      for (const ch of plan.text) {
        sseDelta(res, { content: ch });
        await new Promise((r) => setTimeout(r, 8));
      }
      sseDelta(res, {}, 'stop');
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock LLM 已启动: http://127.0.0.1:${PORT}/v1`);
  console.log('测试: node src/index.js --base-url ' + `http://127.0.0.1:${PORT}/v1` + ' --model mock');
});
