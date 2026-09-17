import { defineStore } from 'pinia';
import { shallowRef } from 'vue';

export type FeedbackAction = { label: string; href?: string; run?: () => void };
export type Feedback = {
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  detail?: string;
  actions?: FeedbackAction[];
};

export const useFeedbackStore = defineStore('feedback', () => {
  const current = shallowRef<Feedback | null>(null);
  function show(value: Feedback) { current.value = value; }
  function close() { current.value = null; }
  return { current, show, close };
});
