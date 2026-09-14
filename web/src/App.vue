<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();

const navItems = [
  { to: "/contests", label: "比赛", activeWhen: (path: string) => path === "/contests" || path.startsWith("/contests/") && !path.startsWith("/contests/intake") },
  { to: "/members", label: "成员", activeWhen: (path: string) => path.startsWith("/members") },
  { to: "/manage", label: "管理", activeWhen: (path: string) => path.startsWith("/manage") || path.startsWith("/contests/intake") },
];

const githubProjectUrl = "https://github.com/mohaoz/xcpc-tracker";
</script>

<template>
  <div class="shell">
    <header class="shell__hero">
      <div class="shell__hero-bg"></div>
      <div class="shell__hero-inner">
        <div>
          <p class="eyebrow">XCPC · 整场 VP 选题</p>
          <h1>XCPC Tracker</h1>
          <p class="hero-copy">
            根据队员的尝试与通过记录挑选整场 VP，自主决定是否查看牌线和题目标签。
          </p>
        </div>
        <nav class="shell__nav" aria-label="Primary">
          <div class="shell__nav-links">
            <RouterLink
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="nav-pill"
              :class="{ 'nav-pill--active': item.activeWhen(route.path) }"
            >
              {{ item.label }}
            </RouterLink>
          </div>
          <a
            :href="githubProjectUrl"
            class="nav-pill nav-pill--github"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
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
      <a href="https://github.com/mohaoz/xcpc-tracker/blob/main/catalog/README.md" target="_blank" rel="noreferrer">数据来源与许可</a>
    </footer>
  </div>
</template>
