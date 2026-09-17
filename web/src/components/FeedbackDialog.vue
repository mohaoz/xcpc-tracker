<script setup lang="ts">
import { ref, watch } from 'vue';
import { useFeedbackStore, type FeedbackAction } from '../stores/feedback';

const feedback = useFeedbackStore();
const dialog = ref<HTMLDialogElement | null>(null);
watch(() => feedback.current, value => {
  if (value && !dialog.value?.open) dialog.value?.showModal();
  if (!value && dialog.value?.open) dialog.value.close();
}, { flush: 'post' });
function act(action: FeedbackAction) {
  feedback.close();
  action.run?.();
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="feedback-dialog" aria-labelledby="feedback-title" aria-describedby="feedback-message" @cancel.prevent="feedback.close()">
      <div v-if="feedback.current" :class="['feedback-content', `feedback-content--${feedback.current.tone}`]">
        <header>
          <span class="feedback-icon" aria-hidden="true">{{ feedback.current.tone === 'success' ? '✓' : feedback.current.tone === 'info' ? 'i' : '!' }}</span>
          <button class="feedback-close" aria-label="关闭弹窗" autofocus @click="feedback.close()">×</button>
        </header>
        <h2 id="feedback-title">{{ feedback.current.title }}</h2>
        <p id="feedback-message">{{ feedback.current.message }}</p>
        <details v-if="feedback.current.detail" class="feedback-details">
          <summary>详细信息</summary>
          <pre>{{ feedback.current.detail }}</pre>
        </details>
        <footer>
          <button class="button button--ghost" @click="feedback.close()">关闭</button>
          <template v-for="action in feedback.current.actions" :key="action.label">
            <a v-if="action.href" class="button" :href="action.href" target="_blank" rel="noopener noreferrer">{{ action.label }} ↗</a>
            <button v-else class="button" @click="act(action)">{{ action.label }}</button>
          </template>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.feedback-dialog { width: min(480px, calc(100vw - 32px)); max-height: 85vh; padding: 0; border: 1px solid #dce2dd; border-radius: 24px; color: #242c37; background: #fffdf8; box-shadow: 0 24px 80px #142e3933; }
.feedback-dialog::backdrop { background: #192d3b66; backdrop-filter: blur(3px); }
.feedback-content { padding: 28px; --accent: #ad6527; --soft: #fbecd9; }
.feedback-content--error { --accent: #b7433c; --soft: #fcebe7; }
.feedback-content--success { --accent: #16795b; --soft: #e3f3eb; }
.feedback-content--info { --accent: #196a80; --soft: #e6f1f5; }
header { display: flex; justify-content: space-between; align-items: flex-start; }
.feedback-icon { display: grid; place-items: center; width: 44px; height: 44px; background: var(--soft); color: var(--accent); font-size: 24px; font-weight: 700; border-radius: 14px; }
.feedback-close { border: 0; background: transparent; color: #657482; font-size: 28px; cursor: pointer; padding: 0 6px; }
h2 { margin: 18px 0 10px; font-size: 23px; }
p { margin: 0; line-height: 1.8; white-space: pre-line; overflow-wrap: anywhere; }
.feedback-details { margin-top: 18px; color: #657482; font-size: 13px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
</style>
