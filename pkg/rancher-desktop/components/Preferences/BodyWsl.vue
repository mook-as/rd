<script lang="ts">

import Vue from 'vue';
import { mapGetters, mapState } from 'vuex';

import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import WslIntegration from '@pkg/components/WSLIntegration.vue';
import WslProxy from '@pkg/components/WSLProxy.vue';
import { Settings } from '@pkg/config/settings';
import { TransientSettings } from '@pkg/config/transientSettings';
import { ServerState } from '@pkg/main/credentialServer/httpCredentialHelperServer';
import { RecursivePartial } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-wsl',
  components: {
    WslIntegration, WslProxy, RdTabbed, Tab,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('transientSettings', ['getActiveTab']),
    ...mapState('credentials', ['credentials']),
    activeTab(): string {
      return this.getActiveTab || 'integration';
    },
  },
  methods: {
    async tabSelected({ tab }: { tab: Vue.Component }) {
      if (this.activeTab !== tab.name) {
        await this.commitPreferences(tab.name || '');
      }
    },
    async commitPreferences(tabName: string) {
      await this.$store.dispatch(
        'transientSettings/commitPreferences',
        {
          ...this.credentials as ServerState,
          payload: { preferences: { navItem: { currentTabs: { WSL: tabName } } } } as RecursivePartial<TransientSettings>,
        },
      );
    },
  },
});
</script>

<template>
  <rd-tabbed
    v-bind="$attrs"
    class="action-tabs"
    :no-content="true"
    :default-tab="activeTab"
    @changed="tabSelected"
  >
    <template #tabs>
      <tab
        label="WSL Integrations"
        name="integration"
        :weight="2"
      />
      <tab
        label="Proxy settings"
        name="proxy"
        :weight="1"
      />
    </template>
    <div class="wsl-content">
      <component
        :is="`wsl-${ activeTab }`"
        :preferences="preferences"
        v-on="$listeners"
      />
    </div>
  </rd-tabbed>
</template>

<style lang="scss" scoped>
  .preferences-body {
    padding: var(--preferences-content-padding);
  }
</style>
