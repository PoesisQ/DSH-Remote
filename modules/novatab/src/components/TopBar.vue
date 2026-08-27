<script setup lang="ts">
import Icon, { type IconName } from './Icon.vue';
import { openBrowserPage, type BrowserPage } from '../core/browser';

const links: Array<{ page: BrowserPage; icon: IconName; label: string }> = [
  { page: 'settings', icon: 'settings', label: '浏览器设置' },
  { page: 'history', icon: 'clock', label: '历史记录' },
  { page: 'downloads', icon: 'download', label: '下载内容' },
  { page: 'extensions', icon: 'grid', label: '扩展管理' },
  { page: 'bookmarks', icon: 'star', label: '书签管理' },
  { page: 'passwords', icon: 'key', label: '密码管理' }
];
</script>

<template>
  <div class="top-bar">
    <button
      v-for="l in links"
      :key="l.page"
      class="top-bar-btn"
      :title="l.label"
      :aria-label="l.label"
      @click="openBrowserPage(l.page)"
    >
      <Icon :name="l.icon" :size="20" />
    </button>
  </div>
</template>
