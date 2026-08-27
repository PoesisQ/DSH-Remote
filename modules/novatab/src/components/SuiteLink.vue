<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { toast } from '../core/toast';
const open = ref(false), url = ref('');
function valid(value: string) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('Use a plain HTTPS / local HTTP address');
  return u.href;
}
onMounted(async () => { try { const data = await chrome.storage.local.get('dshSuiteUrl'); if (data.dshSuiteUrl) url.value = valid(String(data.dshSuiteUrl)); } catch { /* No default personal endpoint. */ } });
async function save() { try { const value = url.value.trim() ? valid(url.value.trim()) : ''; await chrome.storage.local.set({ dshSuiteUrl: value }); url.value = value; open.value = false; toast('互联入口已保存，仅保存在本机'); } catch { toast('请输入不带凭据的 HTTPS 或本机 HTTP 地址'); } }
async function visit() { if (!url.value) { open.value = true; return; } try { await chrome.tabs.create({ url: valid(url.value) }); } catch { toast('无法打开互联入口'); } }
</script>
<template>
  <div class="suite-link"><button @click="visit" title="打开自己部署的 DSH">DSH</button><button @click="open = !open" aria-label="设置 DSH 入口">···</button>
    <form v-if="open" @submit.prevent="save"><label>自己的 DSH / 手机网页地址<input v-model="url" type="url" placeholder="https://your-relay.example" /></label><small>不填写 DR2。不会上传书签、历史、待办或壁纸。</small><button type="submit">保存</button><button type="button" @click="open=false">关闭</button></form>
  </div>
</template>
<style scoped>
.suite-link{position:fixed;right:28px;bottom:90px;z-index:50;display:flex;gap:4px;color:#eee}.suite-link button{background:#202126cc;color:inherit;border:1px solid #ffffff20;border-radius:10px;padding:7px 10px;cursor:pointer}.suite-link form{position:absolute;right:0;bottom:44px;width:300px;padding:18px;border-radius:18px;background:#22242bee;box-shadow:0 12px 40px #0006;backdrop-filter:blur(16px);font:13px/1.6 system-ui}.suite-link input{display:block;width:100%;box-sizing:border-box;margin:8px 0;background:#111;color:#fff;border:1px solid #555;border-radius:8px;padding:8px;user-select:text}.suite-link small{display:block;color:#b3b5bd;margin-bottom:10px}
</style>
