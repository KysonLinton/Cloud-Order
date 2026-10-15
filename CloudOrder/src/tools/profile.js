/**
 * 用户档案（Profile）工具：读取/更新用户的个人资料与穿搭偏好。
 *
 * 关键约束（写进工具描述，让模型遵守）：
 *   推荐搭配时要参考用户档案（性别、体型、职业、风格与颜色偏好、禁忌、尺码等），
 *   但不要凭空编造档案里没有的信息；档案为空时，引导用户去填。
 */
import * as profile from '../profile.js';

export function createProfileTools(config) {
  const list = new Map();
  void config;

  list.set('profile_get', {
    name: 'profile_get',
    description:
      '读取用户的「档案」：性别、年龄、身高体重、体型、职业、常居城市、常去场合、风格偏好、常穿/不喜欢的颜色、' +
      '尺码、预算、禁忌等。推荐穿搭前建议先读一次，让建议更贴合用户本人；与当次对话里用户的明确要求，以当次要求为准。',
    parameters: { type: 'object', properties: {} },
    risk: 'low',
    safeByDefault: true,
    async run() {
      const p = profile.readProfile();
      if (!p.configured) {
        return [
          '用户档案尚未填写（为空）。',
          '建议先问用户「愿不愿意花一分钟填一下个人档案」，或让他到网页版右上角的「档案」入口填写（性别、年龄、职业、风格偏好、常去场合、尺码、禁忌等）。',
          '在用户填写之前，不要假设他的性别、身材或偏好，也不要编造档案内容。'
        ].join('\n');
      }
      return `用户档案（用户主动填写，仅供参考；当次对话中的明确要求优先）：\n${profile.formatProfileText(p)}\n\n（如需修改，可调用 profile_update，或让用户在网页版「档案」入口修改。）`;
    }
  });

  list.set('profile_update', {
    name: 'profile_update',
    description:
      '更新用户「档案」中的字段（只传需要改的字段，其余保持不变）。建议在用户明确告诉你某项信息、' +
      '或同意你代为更新时调用；不确定的字段不要填。',
    parameters: {
      type: 'object',
      properties: {
        gender: { type: 'string', description: '性别，如 男 / 女' },
        age: { type: 'string', description: '年龄，如 28' },
        height: { type: 'string', description: '身高（cm），如 178' },
        weight: { type: 'string', description: '体重（kg），如 70' },
        bodyType: { type: 'string', description: '体型，如 偏瘦 / 标准 / 偏壮' },
        occupation: { type: 'string', description: '职业/身份' },
        city: { type: 'string', description: '常居城市（用于按天气给建议）' },
        scenarios: { type: 'array', items: { type: 'string' }, description: '常去场合，如 ["通勤","约会"]' },
        styles: { type: 'array', items: { type: 'string' }, description: '风格偏好，如 ["简约","通勤"]' },
        favColors: { type: 'array', items: { type: 'string' }, description: '常穿的颜色' },
        avoidColors: { type: 'array', items: { type: 'string' }, description: '不喜欢的颜色' },
        topSize: { type: 'string', description: '上衣尺码' },
        bottomSize: { type: 'string', description: '裤装尺码' },
        shoeSize: { type: 'string', description: '鞋码' },
        budget: { type: 'string', description: '预算档位，如 平价 / 中等 / 不限' },
        avoid: { type: 'string', description: '其他禁忌/不喜欢（如不穿紧身、对羊毛过敏）' },
        notes: { type: 'string', description: '补充说明' }
      }
    },
    risk: 'medium',
    safeByDefault: false,
    async run(args = {}) {
      const patch = {};
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined || v === null) continue;
        if (profile.FORM_FIELDS.some((f) => f.key === k)) patch[k] = v;
      }
      if (!Object.keys(patch).length) return '没有可更新的字段（未识别到有效的档案字段）。';
      const p = profile.saveProfile(patch);
      return `已更新用户档案：\n${profile.formatProfileText(p)}`;
    }
  });

  return list;
}
