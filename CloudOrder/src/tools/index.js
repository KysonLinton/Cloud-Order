/** 内建工具汇总 */
import { createReadTools, createWriteTools, createExecTools } from './files.js';
import { createWebTools } from './web.js';
import { createWeatherTools } from './weather.js';
import { createLocationTools } from './location.js';
import { createWardrobeTools } from './wardrobe.js';
import { createProfileTools } from './profile.js';
import { createFeedbackTools } from './feedback.js';
import { createVisionTools } from './vision.js';
import { createSkillTools } from './skills.js';

/**
 * @param {object} config
 * @returns {Map<string, object>} 工具名 -> 工具定义
 */
export function createBuiltinTools(config, skillsRef = { current: new Map() }) {
  const merged = new Map([
    ...createReadTools(config),
    ...createWriteTools(config),
    ...createExecTools(config),
    ...createWebTools(config),
    ...createWeatherTools(config),
    ...createLocationTools(config),
    ...createWardrobeTools(config),
    ...createProfileTools(config),
    ...createFeedbackTools(config),
    ...createVisionTools(config),
    ...createSkillTools(config, skillsRef)
  ]);
  return merged;
}
