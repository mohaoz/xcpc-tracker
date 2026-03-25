<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();

const navItems = [
  { to: "/contests", label: "Contests", activeWhen: (path: string) => path === "/contests" || path.startsWith("/contests/") && !path.startsWith("/contests/intake") },
  { to: "/contests/intake", label: "Add Contest", activeWhen: (path: string) => path.startsWith("/contests/intake") },
  { to: "/members", label: "Members", activeWhen: (path: string) => path.startsWith("/members") },
];
</script>

<template>
  <div class="shell">
    <header class="shell__hero">
      <div class="shell__hero-bg"></div>
      <div class="shell__hero-inner">
        <div>
          <p class="eyebrow">Local VP Console</p>
          <h1>xcpc-vp-gather</h1>
          <p class="hero-copy">
            先看整场比赛值不值得 VP，再看队内谁碰过哪些题。
          </p>
        </div>
        <nav class="shell__nav" aria-label="Primary">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-pill"
            :class="{ 'nav-pill--active': item.activeWhen(route.path) }"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>
    </header>

    <main class="shell__main">
      <RouterView />
    </main>
  </div>
</template>
