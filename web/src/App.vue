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
          <p class="eyebrow">XCPC 覆盖追踪器</p>
          <h1>XCPC Tracker</h1>
          <p class="hero-copy">
            整理比赛目录、导入成员状态，并直接查看队伍覆盖与题目新鲜度。
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
      <RouterView />
    </main>
  </div>
</template>
