/**
 * 用户反馈（Feedback）工具：把「推荐 → 评价 → 偏好」的飞轮接到对话里。
 *
 * 关键约束（写进工具描述，让模型遵守）：
 *   每次给出搭配建议后，主动请用户评价（是否满意 + 改进建议），并立刻用 feedback_add 记下来；
 *   下一次推荐前先读 feedback_list，把历史评价当作偏好依据，不要重复用户已经指出过的做法。
 */
import * as feedback from '../feedback.js';

export function createFeedbackTools(config) {
  const list = new Map();
  void config;

  list.set('feedback_add', {
    name: 'feedback_add',
    description:
      '记录用户对【刚给过的这套搭配推荐】的评价（满意度 + 改进建议）。' +
      '每次给出具体搭配建议后，都应当用一两句话邀请用户评价（例如「这套满意吗？哪里想调整？」），' +
      '用户回应后调用本工具记录，作为后续推荐的偏好依据。只记录用户真实表达的内容，不要替他编造评价。',
    parameters: {
      type: 'object',
      properties: {
        rating: {
          type: 'string',
          enum: ['satisfied', 'neutral', 'unsatisfied'],
          description: '满意度：satisfied=满意 / neutral=一般 / unsatisfied=不满意'
        },
        outfit: { type: 'string', description: '这次推荐的具体搭配（简述单品，便于日后对照）' },
        scenario: { type: 'string', description: '这次推荐针对的场合，如 通勤 / 约会 / 面试' },
        suggestion: { type: 'string', description: '用户的原话改进建议，尽量保留其原意（如「上衣太正式了，想休闲一点」）' },
        liked: { type: 'array', items: { type: 'string' }, description: '用户明确表示满意的点' },
        disliked: { type: 'array', items: { type: 'string' }, description: '用户明确表示不满/要避免的点（后续推荐不要再出现）' },
        tags: { type: 'array', items: { type: 'string' }, description: '可归纳的偏好标签，如 ["太正式","颜色太深"]' }
      }
    },
    risk: 'medium',
    safeByDefault: false,
    async run(args = {}) {
      const rating = feedback.normalizeRating(args.rating);
      if (!rating && !String(args.suggestion || '').trim() && !String(args.outfit || '').trim()) {
        return '没有可记录的内容：至少需要满意度（satisfied/neutral/unsatisfied）或改进建议。';
      }
      const rec = feedback.addFeedback({ ...args, rating, source: 'chat' });
      return [
        `已记录这次评价：${rec.icon} ${rec.label}${rec.scenario ? `（场合：${rec.scenario}）` : ''}`,
        rec.suggestion ? `改进建议：${rec.suggestion}` : '',
        rec.disliked?.length ? `要避免：${rec.disliked.join('、')}` : '',
        `累计评价 ${feedback.countFeedback()} 条。这些会在后面的推荐里被参考。`
      ]
        .filter(Boolean)
        .join('\n');
    }
  });

  list.set('feedback_list', {
    name: 'feedback_list',
    description:
      '读取用户对以往搭配推荐的评价记录与归纳（满意度、改进建议、要避免的点）。' +
      '推荐穿搭前建议读一次，把历史评价当成偏好依据；也可以用它回答「你记得我上次说哪里不好吗」。',
    parameters: {
      type: 'object',
      properties: {
        rating: { type: 'string', enum: ['satisfied', 'neutral', 'unsatisfied'], description: '只看某一档评价' },
        limit: { type: 'number', description: '最多返回几条（默认 10，按时间倒序）' },
        summaryOnly: { type: 'boolean', description: '只返回归纳结论，不返回逐条记录' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args = {}) {
      if (!feedback.countFeedback()) {
        return [
          '用户还没有任何搭配评价记录。',
          '建议在这次给出搭配建议后，主动请用户评价「是否满意 + 想怎么改」，再用 feedback_add 记录，',
          '这样后续推荐会越来越贴合他。'
        ].join('\n');
      }
      const summary = feedback.formatSummaryText();
      if (args.summaryOnly) return `用户评价归纳：\n${summary}`;
      const limit = Number(args.limit) > 0 ? Number(args.limit) : 10;
      const items = feedback.listFeedback({ rating: args.rating, limit });
      const header = args.rating ? `筛选出「${feedback.ratingMeta(feedback.normalizeRating(args.rating)).label}」的评价 ${items.length} 条：` : `最近 ${items.length} 条评价：`;
      return [
        `用户评价归纳：\n${summary}`,
        '',
        header,
        feedback.formatFeedbackText(items),
        '',
        '（推荐时请把这些当作偏好依据：命中「要避免」的做法不要重复，用户认可的可以沿用。修改/删除单条用 feedback_delete。）'
      ].join('\n');
    }
  });

  list.set('feedback_delete', {
    name: 'feedback_delete',
    description: '删除一条记错的评价记录（不可恢复）。删除前先向用户确认。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '评价记录 id，如 f_xxx（从 feedback_list 获得）' } },
      required: ['id']
    },
    risk: 'high',
    safeByDefault: false,
    async run(args = {}) {
      const removed = feedback.removeFeedback(String(args.id));
      return `已删除评价记录 ${removed.id}（${feedback.ratingMeta(removed.rating).label}）。当前剩余 ${feedback.countFeedback()} 条。`;
    }
  });

  return list;
}
