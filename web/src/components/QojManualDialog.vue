<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQojManualStore } from '../stores/qoj-manual';
import { useQojSyncStore } from '../stores/qoj-sync';
const manual=useQojManualStore();
const sync=useQojSyncStore();
const startingAuto=ref(false);
async function startAutoImport() {
  if(manual.busy || startingAuto.value || sync.busy)return;
  startingAuto.value=true;
  const handle=manual.targets.length===1 ? manual.targets[0].handle : undefined;
  try {
    if(!await sync.setUseUserscript(true))return;
    manual.open=false;
    await sync.sync(true,handle);
  } finally {startingAuto.value=false;}
}
const dialog=ref<HTMLDialogElement|null>(null);
const url=computed(()=>manual.targets[0] ? `https://qoj.ac/user/profile/${encodeURIComponent(manual.targets[0].handle)}` : 'https://qoj.ac/');
watch(()=>manual.open,open=>{if(open && !dialog.value?.open)dialog.value?.showModal();else if(!open)dialog.value?.close();},{flush:'post'});
async function upload(event:Event) {
  const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;
  try {manual.input=await file.text();manual.error='';}catch{manual.error='读取文件失败。';}finally{input.value='';}
}
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="qoj-manual-dialog" aria-labelledby="qoj-manual-title" @cancel.prevent="manual.open=false">
      <header><h2 id="qoj-manual-title">QOJ 手动导入</h2><button class="close" aria-label="关闭手动导入" @click="manual.open=false">×</button></header>
      <div class="auto-import-banner">
        <span>使用油猴脚本，无需复制粘贴</span>
        <button class="button" :disabled="manual.busy || startingAuto || sync.busy" @click="startAutoImport">启动自动导入 →</button>
      </div>
      <div class="manual-divider"><span>手动导入</span></div>
      <p class="muted">复制脚本，在 QOJ 控制台执行，再将结果粘贴到下方。</p>
      <div class="actions">
        <button class="button" :disabled="!manual.script" @click="manual.copy()">复制脚本</button>
        <a class="button button--ghost" :href="url" target="_blank" rel="noopener noreferrer">打开 QOJ ↗</a>
      </div>
      <details v-if="manual.script"><summary>查看脚本（{{ manual.targets.length }} 个账号）</summary><textarea class="input-textarea" :value="manual.script" readonly rows="5" aria-label="导出脚本" @focus="($event.target as HTMLTextAreaElement).select()" /></details>
      <label for="qoj-manual-json">导出结果</label>
      <textarea id="qoj-manual-json" v-model="manual.input" class="input-textarea" rows="6" placeholder="在此粘贴 JSON" :disabled="manual.busy" />
      <label class="upload">选择 JSON 文件<input type="file" accept=".json,application/json" :disabled="manual.busy" @change="upload" /></label>
      <p v-if="manual.error" class="error-box" role="alert">{{ manual.error }}</p>
      <p v-if="manual.message" class="notice" role="status">{{ manual.message }}</p>
      <footer><button class="button button--ghost" @click="manual.open=false">关闭</button><button class="button" :disabled="manual.busy || !manual.input.trim()" @click="manual.importJson()">{{ manual.busy ? '导入中…' : '导入记录' }}</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.qoj-manual-dialog { width:min(640px,calc(100vw - 32px));max-height:85vh;border:1px solid #dce2dd;border-radius:22px;background:#fffdf8;color:#242c37;padding:26px;box-shadow:0 24px 80px #142e3933; }
.qoj-manual-dialog::backdrop {background:#192d3b66;backdrop-filter:blur(3px);}
header,footer {display:flex;align-items:center;justify-content:space-between;gap:12px;}
h2 {margin:0;font-size:23px;}.close {border:0;background:none;font-size:28px;color:#657482;cursor:pointer;}
details {margin:16px 0;color:#657482;font-size:13px;}textarea{margin:8px 0;resize:vertical;}label{display:block;margin-top:16px;}footer{justify-content:flex-end;margin-top:20px;}.upload {font-size:13px;color:#657482;}input[type=file]{margin-left:12px;max-width:100%;}
textarea {display:block;box-sizing:border-box;width:100%;padding:12px 14px;border:1px solid #d7dfdc;border-radius:10px;background:#fff;color:inherit;font:14px/1.6 ui-monospace,monospace;}
textarea:focus {outline:2px solid #146e7540;border-color:#146e75;}
.upload {position:relative;display:inline-flex;align-items:center;margin-top:4px;padding:6px 0;color:#146e75;cursor:pointer;}
.upload:focus-within {outline:2px solid #146e75;outline-offset:3px;}
.upload input {position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;}
.qoj-manual-dialog .button {border-radius:10px;min-height:40px;padding:10px 16px;font-size:14px;}
.auto-import-banner {display:flex;align-items:center;justify-content:space-between;gap:16px;margin:22px 0;padding:0;color:#657482;font-size:14px;}
.auto-import-banner .button {flex-shrink:0;}
.manual-divider {display:flex;align-items:center;gap:12px;color:#657482;font-size:12px;}
.manual-divider::after {content:'';height:1px;background:#e2e7e2;flex:1;}
.qoj-manual-dialog .actions {display:flex;align-items:center;gap:12px;}
.qoj-manual-dialog .actions .button {min-width:112px;justify-content:center;box-sizing:border-box;}
.qoj-manual-dialog footer .button {min-width:100px;justify-content:center;}
</style>
