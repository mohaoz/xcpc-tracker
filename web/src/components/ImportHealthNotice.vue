<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import { localDb } from '../lib/local-db';
import type { LocalMemberHandleRecord, LocalSyncRecord } from '../lib/local-model';
const props = defineProps<{memberIds?: string[]}>();
const handles = ref<LocalMemberHandleRecord[]>([]);
const records = ref<LocalSyncRecord[]>([]);
const error = ref('');
let subscription: Subscription | undefined;
onMounted(() => {
  subscription = liveQuery(async () => {
    const [members, allHandles, syncs] = await Promise.all([localDb.members.toArray(), localDb.memberHandles.toArray(), localDb.syncRecords.toArray()]);
    const active = new Set(members.filter(m => !m.deletedAt).map(m => m.memberId));
    return {handles: allHandles.filter(h => !h.deletedAt && active.has(h.memberId) && ['codeforces','qoj'].includes(h.provider)), records: syncs};
  }).subscribe({next(value) {handles.value = value.handles; records.value = value.records;}, error() {error.value = '无法读取同步记录，未做判断可能不完整。';}});
});
onUnmounted(() => subscription?.unsubscribe());
const rows = computed(() => handles.value.filter(h => props.memberIds === undefined || props.memberIds.includes(h.memberId)).map(h => {
  const last = records.value.filter(s => s.adapter === (h.provider === 'qoj' ? 'qoj_userscript' : 'codeforces_api') && String(s.summaryJson.handle ?? '').toLowerCase() === h.handle.toLowerCase())
    .sort((a,b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt))[0];
  const unmatched = Number(last?.summaryJson.unmatched_status_count ?? 0);
  return {id:h.handleId, label:`${h.provider.toUpperCase()} / ${h.handle}`, last, unmatched};
}));
const incomplete = computed(() => rows.value.some(r => !r.last || r.last.status !== 'succeeded' || r.unmatched > 0));
</script>
<template>
  <p v-if="error" class="notice">{{ error }}</p>
  <details v-else-if="rows.length" class="notice" style="margin-bottom:16px">
    <summary>{{ incomplete ? '导入存在缺口，未做判断可能不完整' : '成员同步记录' }}</summary>
    <p v-for="row in rows" :key="row.id" class="tiny">
      {{ row.label }} · {{ row.last?.finishedAt ? new Date(row.last.finishedAt).toLocaleString() : '暂无同步时间' }} ·
      {{ !row.last ? '尚无同步记录' : row.last.status === 'failed' ? '同步失败' : row.last.status === 'running' ? '同步未完成' : row.unmatched ? '已导入，部分记录未匹配' : '已导入' }}
      <span v-if="row.unmatched"> · 未匹配 {{ row.unmatched }} 条</span>
    </p>
    <p class="tiny">未匹配记录可能属于目录外题目；同步时间仅代表本地记录，不能保证上游数据完整。</p>
  </details>
</template>
