import type { FeatureDef } from './featureRegistry';

export async function requestPermissions(def: FeatureDef): Promise<boolean> {
  if (!def.permissions) return true;
  try {
    if (await chrome.permissions.contains(def.permissions)) return true;
    return await chrome.permissions.request(def.permissions);
  } catch {
    return false;
  }
}

export const SUGGEST_ORIGINS = [
  'https://suggestqueries.google.com/*',
  'https://api.bing.com/*',
  'https://suggestion.baidu.com/*',
  'https://duckduckgo.com/*'
];

let suggestTried = false;

/** 首次使用搜索时请求搜索建议接口的 host 权限（可选，拒绝不影响搜索本身） */
export async function ensureSuggestPermissions(): Promise<void> {
  if (suggestTried) return;
  suggestTried = true;
  try {
    if (await chrome.permissions.contains({ origins: SUGGEST_ORIGINS })) return;
    await chrome.permissions.request({ origins: SUGGEST_ORIGINS });
  } catch {
    /* ignore */
  }
}

/**
 * 监听权限被授予事件，返回解绑函数。
 * @types/chrome 未在 onAdded 上声明 removeListener，这里用结构断言补齐。
 */
export function onPermissionsAdded(cb: (perms: chrome.permissions.Permissions) => void): () => void {
  const ev = chrome.permissions.onAdded as unknown as {
    addListener: (cb: (p: chrome.permissions.Permissions) => void) => void;
    removeListener: (cb: (p: chrome.permissions.Permissions) => void) => void;
  };
  ev.addListener(cb);
  return () => ev.removeListener(cb);
}
