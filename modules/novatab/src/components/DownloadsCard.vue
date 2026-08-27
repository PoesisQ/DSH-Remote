<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { featureMap } from '../core/featureRegistry';
import { onPermissionsAdded, requestPermissions } from '../core/permissions';
import { settings } from '../core/storage';
import { openBrowserPage } from '../core/browser';
import { formatSize, timeAgo } from '../core/utils';
import Icon from './Icon.vue';
import { toast } from '../core/toast';

defineProps<{ panel?: boolean }>();

const items = ref<chrome.downloads.DownloadItem[]>([]);
const denied = ref(false);

const stateLabel: Record<string, string> = {
  complete: '完成',
  in_progress: '下载中',
  interrupted: '已中断'
};

async function load() {
  const ok = await requestPermissions(featureMap.downloads);
  if (!ok) {
    denied.value = true;
    return;
  }
  try {
    items.value = await chrome.downloads.search({
      limit: settings.downloads.maxItems,
      orderBy: ['-startTime']
    });
    denied.value = false;
  } catch {
    denied.value = true;
  }
}

let offPermissionAdded: (() => void) | undefined;

function onPermissionAdded(perms: chrome.permissions.Permissions) {
  if (perms.permissions?.includes('downloads')) void load();
}

onMounted(() => {
  void load();
  offPermissionAdded = onPermissionsAdded(onPermissionAdded);
});

onUnmounted(() => {
  offPermissionAdded?.();
});

async function openFile(d: chrome.downloads.DownloadItem) {
  if (d.state !== 'complete') return;
  try {
    await chrome.downloads.open(d.id);
  } catch {
    toast('无法打开该文件');
  }
}

async function showFolder(d: chrome.downloads.DownloadItem) {
  try {
    // @types/chrome 未声明 show 的回调重载，但运行时支持 (id, callback) 形式
    const showWithCallback = chrome.downloads.show as unknown as (
      id: number,
      cb: (exists: boolean) => void
    ) => void;
    const exists = await new Promise<boolean>((resolve) => showWithCallback(d.id, resolve));
    if (!exists) chrome.downloads.showDefaultFolder();
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div v-if="denied" class="dock-denied">
    <div class="hint">需要下载记录权限才能显示</div>
    <button class="chip" @click="load()">授权并加载</button>
  </div>
  <template v-else>
    <div class="bm-list">
      <div v-for="d in items" :key="d.id" class="bm-item">
        <span class="bm-title" :title="d.filename">{{ (d.filename || '').split(/[\\/]/).pop() }}</span>
        <span class="bm-path">{{ formatSize(d.fileSize) }} · {{ d.startTime ? timeAgo(new Date(d.startTime).getTime()) : '' }}</span>
        <span v-if="d.state !== 'complete'" class="bm-path">{{ stateLabel[d.state] }}</span>
        <button class="mini" title="打开文件" @click="openFile(d)"><Icon name="file" :size="14" /></button>
        <button class="mini" title="打开所在文件夹" @click="showFolder(d)"><Icon name="folder-open" :size="14" /></button>
      </div>
      <div v-if="!items.length" class="hint">没有下载记录</div>
    </div>
    <button v-if="!panel" class="chip" @click="openBrowserPage('downloads')">打开下载页 ↗</button>
  </template>
</template>
