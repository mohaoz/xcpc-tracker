import { createRouter, createWebHistory } from "vue-router";

import ContestDetailView from "./views/ContestDetailView.vue";
import ContestListView from "./views/ContestListView.vue";
import MemberListView from "./views/MemberListView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/contests",
    },
    {
      path: "/contests",
      name: "contests",
      component: ContestListView,
    },
    {
      path: "/contests/:contestId",
      name: "contest-detail",
      component: ContestDetailView,
      props: true,
    },
    {
      path: "/members",
      name: "members",
      component: MemberListView,
    },
  ],
});
