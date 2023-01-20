<template>
  <nav>
    <ul>
      <li v-for="item in items" :key="item.route" :item="item.route">
        <NuxtLink :to="item.route">
          {{ routes[item.route].name }}
          <badge-state
            v-if="item.error"
            color="bg-error"
            class="nav-badge"
            :label="item.error.toString()"
          />
        </NuxtLink>
      </li>
    </ul>
    <section v-if="$config.featureExtensions">
      <header>Extensions</header>
      <ul>
        <li v-for="(metadata, extension) in extensionsWithUI" :key="extension" :item="extension">
          <a href="#" @click="openExtension(extension)">
            {{ metadata.title }}
          </a>
        </li>
        <li>
          <NuxtLink to="/qqq">
            <i class="icon icon-circle-plus" />Add Extension
          </NuxtLink>
        </li>
      </ul>
    </section>
  </nav>
</template>

<script lang="ts">
import os from 'os';

import { NuxtApp } from '@nuxt/types/app';
import { BadgeState } from '@rancher/components';
import { RouteRecordPublic } from 'vue-router';
import { mapGetters } from 'vuex';

import { ExtensionMetadata } from '@pkg/main/extensions';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default {
  components: { BadgeState },
  props:      {
    items: {
      type:      Array,
      required:  true,
      validator: (value: {route: string, error?: number}[]) => {
        const nuxt: NuxtApp = (global as any).$nuxt;
        const routes = nuxt.$router.getRoutes().reduce((paths: Record<string, RouteRecordPublic>, route) => {
          paths[route.path] = route;

          return paths;
        }, {});

        return value && (value.length > 0) && value.every(({ route }) => {
          const result = route in routes;

          if (!result) {
            console.error(`<Nav> error: path ${ JSON.stringify(route) } not found in routes ${ JSON.stringify(Object.keys(routes)) }`);
          }

          return result;
        });
      },
    },
  },
  data() {
    const nuxt: NuxtApp = (this as any).$nuxt;

    return {
      // Generate a route (path) to route entry mapping, so that we can pick out
      // their names based on the paths given.
      routes: nuxt.$router.getRoutes().reduce((paths: Record<string, RouteRecordPublic>, route) => {
        paths[route.path] = route;
        if (route.name === 'Supporting Utilities' && os.platform() === 'win32') {
          route.name = 'WSL Integrations';
        }

        return paths;
      }, {}),
    };
  },
  computed: {
    ...mapGetters('extensions', ['extensions']),
    extensionsWithUI() {
      const results: [string, {icon: string, title: string, url: string}][] = [];

      for (const [id, metadata] of Object.entries<ExtensionMetadata>(this.extensions as any)) {
        const uiInfo = metadata.ui?.['dashboard-tab'];

        if (!uiInfo) {
          continue;
        }
        const encodedID = id.replace(/./g, c => c.charCodeAt(0).toString(16));
        const baseURL = new URL(`x-rd-extension://${ encodedID }/ui/dashboard-tab/`);

        results.push([id, {
          title: uiInfo.title,
          icon:  metadata.icon,
          url:   new URL(uiInfo.src, baseURL).toString(),
        }]);
      }

      return Object.fromEntries(results);
    },
  },
  methods: {
    openExtension(id: string) {
      ipcRenderer.send('extension/ui/dashboard', id);
    },
  },
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">

nav {
    background-color: var(--nav-bg);
    padding: 0;
    margin: 0;
    padding-top: 20px;
}

ul {
    margin: 0;
    padding: 0;
    list-style-type: none;

    li {
        padding: 0;

        a {
            color: var(--body-text);
            text-decoration: none;
            line-height: 24px;
            padding: 7.5px 10px;
            letter-spacing: 1.4px;
            display: block;
            outline: none;
        }

        a.nuxt-link-active {
            background-color: var(--nav-active);
        }
    }
}

section {
  header {
    padding: 7.5px 10px;
  }
  ul li a {
    padding-left: calc(7.5px + 1.5em);
  }
}

.nav-badge {
  line-height: initial;
  letter-spacing: initial;
  font-size: 0.75rem;
}

</style>
