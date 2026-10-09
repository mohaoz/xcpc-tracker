<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";
import { ref, onMounted, onUnmounted } from "vue";
import trackerIcon from './assets/xcpc-tracker.svg';
import { useQojSyncStore } from './stores/qoj-sync';
import FeedbackDialog from './components/FeedbackDialog.vue';
import QojManualDialog from './components/QojManualDialog.vue';
useQojSyncStore().start();

const route = useRoute();

const navItems = [
  { to: "/contests", label: "比赛", activeWhen: (path: string) => path === "/contests" || (path.startsWith("/contests/") && !path.startsWith("/contests/intake")) },
  { to: "/members", label: "成员", activeWhen: (path: string) => path.startsWith("/members") },
  { to: "/manage", label: "管理", activeWhen: (path: string) => path.startsWith("/manage") || path.startsWith("/contests/intake") },
];

const githubProjectUrl = "https://github.com/mohaoz/xcpc-tracker";

const showBackToTop = ref(false);
function onScroll() {
  showBackToTop.value = window.scrollY > 400;
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
onMounted(() => window.addEventListener("scroll", onScroll, { passive: true }));
onUnmounted(() => window.removeEventListener("scroll", onScroll));
</script>

<template>
  <FeedbackDialog />
  <QojManualDialog />
  <div class="shell">
    <header class="shell__header">
      <div class="shell__header-inner">
        <RouterLink to="/contests" class="shell__brand" aria-label="XCPC Tracker 首页">
          <img :src="trackerIcon" alt="" width="32" height="32" aria-hidden="true" />
          <span>XCPC Tracker</span>
        </RouterLink>
        <p class="shell__tagline">XCPC 做题情况追踪</p>
        <nav class="shell__nav" aria-label="主导航">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-pill"
            :class="{ 'nav-pill--active': item.activeWhen(route.path) }"
            :aria-current="item.activeWhen(route.path) ? 'page' : undefined"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <a
          :href="githubProjectUrl"
          class="nav-pill nav-pill--github"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
    </header>

    <main class="shell__main">
      <RouterView v-slot="{ Component }">
        <KeepAlive include="ContestListView">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
    <footer class="shell__footer muted tiny">
      榜单数据：<a href="https://github.com/algoux/srk-collection" target="_blank" rel="noreferrer">algoUX / RankLand</a>、XCPCIO ·
      标签与 Rating：<a href="https://hei-maom.github.io/xcpcrating/#/problems" target="_blank" rel="noreferrer">XCPC Rating</a> ·
      <a href="https://github.com/mohaoz/xcpc-tracker/blob/main/catalog/README.md" target="_blank" rel="noreferrer">数据来源与许可</a> ·
      <RouterLink to="/help/qoj">QOJ 同步帮助</RouterLink>
    </footer>
    <Transition name="back-to-top">
      <button
        v-if="showBackToTop"
        type="button"
        class="back-to-top"
        aria-label="回到顶部"
        title="回到顶部"
        @click="scrollToTop"
      >
        ↑
      </button>
    </Transition>
  </div>
</template>
