import { defineConfig } from 'wxt';

// 统一新标签页：Chrome / Edge 共用同一份 MV3 包。
// 未来支持 Firefox 时运行 `wxt build -b firefox`，WXT 会自动改写清单差异。
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  srcDir: 'src',
  manifest: {
    name: 'NovaTab - 统一新标签页',
    description: '统一、可定制、纯本地的新建标签页：壁纸、搜索、收藏夹、待办等全部可选。',
    permissions: ['storage', 'unlimitedStorage', 'favicon'],
    optional_permissions: ['bookmarks', 'topSites', 'history', 'downloads'],
    optional_host_permissions: [
      'https://suggestqueries.google.com/*',
      'https://api.bing.com/*',
      'https://suggestion.baidu.com/*',
      'https://duckduckgo.com/*'
    ]
  }
});
