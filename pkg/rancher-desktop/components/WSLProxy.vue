<script lang="ts">
import { Checkbox } from '@rancher/components';
import _ from 'lodash';
import Vue from 'vue';

import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name: 'wsl-proxy',

  components: { Checkbox, RdFieldset },

  props: {
    description: {
      type:    String,
      default: '',
    },
    emitChanges: {
      type:    Boolean,
      default: false,
    },
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },

  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      if (this.emitChanges) {
        const change = _.set({ WSL: { proxy: {} } }, property, value);

        this.$emit('change', Object.assign(this.preferences.WSL.proxy, change.WSL.proxy));
      } else {
        this.$store.dispatch('preferences/updatePreferencesData', { property, value });
      }
    },
  },
});
</script>

<template>
  <div class="preferences-body">
    <rd-fieldset>
      <section class="wsl-proxy">
        <rd-fieldset>
          <checkbox
            :label="t('proxy.windows.description', { }, true)"
            :value="preferences.WSL.proxy.enabled"
            @input="onChange('WSL.proxy.enabled', $event)"
          />
        </rd-fieldset>
        <hr>
        <rd-fieldset
          :legend-text="t('proxy.windows.addressTitle', { }, true)"
        >
          <rd-fieldset>
            <input
              :placeholder="t('proxy.windows.address', { }, true)"
              :disabled="!preferences.WSL.proxy.enabled"
              :value="preferences.WSL.proxy.address"
              @input="onChange('WSL.proxy.address', $event.target.value)"
            />
          </rd-fieldset>
          <rd-fieldset>
            <input
              type="number"
              :placeholder="t('proxy.windows.port', { }, true)"
              :disabled="!preferences.WSL.proxy.enabled"
              :value="preferences.WSL.proxy.port"
              @input="onChange('WSL.proxy.port', $event.target.value)"
            />
          </rd-fieldset>
        </rd-fieldset>
        <rd-fieldset
          :legend-text="t('proxy.windows.authTitle', { }, true)"
        >
          <rd-fieldset>
            <input
              :placeholder="t('proxy.windows.username', { }, true)"
              :disabled="!preferences.WSL.proxy.enabled"
              :value="preferences.WSL.proxy.username"
              @input="onChange('WSL.proxy.username', $event.target.value)"
            />
          </rd-fieldset>
          <rd-fieldset>
            <input
              type="password"
              :placeholder="t('proxy.windows.password', { }, true)"
              :disabled="!preferences.WSL.proxy.enabled"
              :value="preferences.WSL.proxy.password"
              @input="onChange('WSL.proxy.password', $event.target.value)"
            />
          </rd-fieldset>
        </rd-fieldset>
        <rd-fieldset
          :legend-text="t('proxy.windows.noProxyTitle', { }, true)"
        >
          <rd-fieldset>
            <input
              :placeholder="t('proxy.windows.noProxy', { }, true)"
              :disabled="!preferences.WSL.proxy.enabled"
              :value="preferences.WSL.proxy.noProxy"
              @input="onChange('WSL.proxy.noProxy', $event.target.value)"
            />
          </rd-fieldset>
        </rd-fieldset>
      </section>
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .wsl-proxy {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: grey;
  }
</style>
