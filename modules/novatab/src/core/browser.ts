import { toast } from './toast';

export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'opera' | 'brave' | 'other';

export function detectBrowser(): BrowserName {
  const uad = (navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData;
  if (uad?.brands) {
    const brands = uad.brands.map((b) => b.brand.toLowerCase());
    if (brands.some((b) => b.includes('microsoft edge') || b === 'edge')) return 'edge';
    if (brands.some((b) => b.includes('opera'))) return 'opera';
    if (brands.some((b) => b.includes('brave'))) return 'brave';
  }
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Brave/.test(ua)) return 'brave';
  if (/Chrome\//.test(ua)) return 'chrome';
  return 'other';
}

export const browserName = detectBrowser();

export const browserLabel: Record<BrowserName, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  brave: 'Brave',
  other: '浏览器'
};

export type BrowserPage = 'settings' | 'history' | 'downloads' | 'extensions' | 'bookmarks' | 'passwords';

export function browserPageUrl(page: BrowserPage): string {
  if (browserName === 'firefox') {
    const map: Record<BrowserPage, string> = {
      settings: 'about:preferences',
      history: 'chrome://browser/content/places/places.xhtml',
      downloads: 'about:downloads',
      extensions: 'about:addons',
      bookmarks: 'chrome://browser/content/places/places.xhtml',
      passwords: 'about:logins'
    };
    return map[page];
  }
  const scheme = browserName === 'edge' ? 'edge' : 'chrome';
  const map: Record<BrowserPage, string> = {
    settings: `${scheme}://settings/`,
    history: `${scheme}://history/`,
    downloads: `${scheme}://downloads/`,
    extensions: `${scheme}://extensions/`,
    bookmarks: `${scheme}://bookmarks/`,
    passwords: `${scheme}://password-manager/passwords`
  };
  return map[page];
}

/** 尝试打开浏览器内置页面；被拦截时回退为提示 + 复制链接 */
export async function openBrowserPage(page: BrowserPage) {
  const url = browserPageUrl(page);
  try {
    await chrome.tabs.create({ url });
  } catch {
    try {
      await navigator.clipboard.writeText(url);
      toast(`浏览器拦截了自动跳转，已复制地址：${url}`);
    } catch {
      toast(`请手动打开：${url}`);
    }
  }
}
