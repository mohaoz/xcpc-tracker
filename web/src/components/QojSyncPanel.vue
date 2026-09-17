<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useQojSyncStore } from '../stores/qoj-sync';
const sync = useQojSyncStore();
defineProps<{count:number;disabled?:boolean}>();
const status = computed(() => !sync.useUserscript ? '手动导入' : sync.checking ? '正在连接脚本' : sync.updateAvailable ? `脚本有更新：${sync.latestVersion}` : sync.connected ? '脚本已连接' : '脚本未连接');
onMounted(() => void sync.check());
</script>

<template>
  <section class="qoj-sync-panel" aria-label="同步做题记录">
    <div class="qoj-sync-panel__actions">
      <span class="qoj-sync-caption">同步记录</span>
      <slot />
      <div class="qoj-sync-group">
      <button class="button qoj-sync-button" :disabled="!sync.modeLoaded || disabled" :title="status" aria-describedby="qoj-script-status" @click="sync.busy ? sync.cancel() : sync.sync(true)">
        <span v-if="sync.useUserscript" :class="['qoj-status', { 'qoj-status--ready': sync.connected, 'qoj-status--checking': sync.checking, 'qoj-status--update': sync.updateAvailable }]" aria-hidden="true"></span>
        {{ sync.busy ? '停止同步' : `同步 QOJ (${count})` }}
      </button>
      <slot v-if="sync.useUserscript" name="manual" />
      <button v-if="sync.useUserscript" class="qoj-sync-help" aria-label="QOJ 自动同步帮助" title="QOJ 自动同步帮助" @click="sync.showSetup()">
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.4"/><path d="M8.2 7.6a1.85 1.85 0 0 1 3.6.5c0 1.3-1.8 1.5-1.8 2.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="13.5" r=".85" fill="currentColor"/></svg>
      </button>
      </div>
      <span id="qoj-script-status" class="visually-hidden">{{ status }}</span>
      <slot name="all" />
      <div class="qoj-sync-panel__trailing">
        <slot name="trailing" />
      </div>
    </div>
    <span v-if="sync.busy" class="muted tiny" role="status">{{ sync.currentHandle ? `正在同步 ${sync.currentHandle}…` : '正在连接…' }}</span>
  </section>
</template>

<style scoped>
.qoj-sync-panel { display: grid; gap: 10px; padding: 16px; margin: 20px 0; border: 1px solid #dde3df; border-radius: 14px; background: #fffdf9; }
.qoj-sync-panel__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.qoj-sync-caption { color: #667780; font-size: 13px; margin-right: 4px; }
.qoj-sync-panel__actions :deep(.button) { min-height: 40px; padding: 9px 15px; border-radius: 9px; background: #fffdf9; border: 1px solid #d7dfdc; color: #245c64; font-size: 14px; line-height: 20px; box-shadow: none; justify-content: center; }
.qoj-sync-panel__actions :deep(.button:hover:not(:disabled)) { background: #edf5f2; border-color: #a9c6bf; }
.qoj-sync-panel__actions :deep(.button:disabled) { opacity: .55; }
.qoj-sync-group { display: flex; align-items: stretch; border: 1px solid #d7dfdc; border-radius: 9px; overflow: hidden; }
.qoj-sync-group :deep(.button) { border: 0; border-radius: 0; }
.qoj-sync-group :deep(.button + .button) { border-left: 1px solid #d7dfdc; color: #667780; font-weight: 500; }
.qoj-sync-panel__trailing { display: flex; align-items: center; gap: 18px; margin-left: auto; }
.qoj-sync-panel__trailing :deep(.button) { background: #146e75; color: white; border-color: #146e75; }
.qoj-sync-panel__trailing :deep(.button:hover) { background: #105e64; color: white; }
.qoj-sync-help { display: grid; place-items: center; width: 38px; padding: 0; border: 0; border-left: 1px solid #d7dfdc; background: transparent; color: #637580; cursor: pointer; }
.qoj-sync-help:hover { color: #126d77; background: #edf5f2; }
.qoj-sync-help:focus-visible { outline: 2px solid #146e75; outline-offset: -3px; }
.qoj-sync-button { display: inline-flex; align-items: center; gap: 9px; }
.qoj-status { width: 8px; height: 8px; border-radius: 50%; background: #aebcbe; box-shadow: 0 0 0 3px #ffffff20; }
.qoj-status--ready { background: #259765; }
.qoj-status--update { background: #d68a24; }
.qoj-status--checking { background: transparent; border: 2px solid #b6c8c7; border-top-color: #146e75; animation: qoj-spin .8s linear infinite; box-shadow: none; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes qoj-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .qoj-status--checking { animation: none; } }
</style>
