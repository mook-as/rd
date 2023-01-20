import { GetterTree } from 'vuex';

import { ActionContext, MutationsType } from './ts-helpers';

import type { ExtensionMetadata } from '@pkg/main/extensions/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

type ExtensionState = Record<string, ExtensionMetadata | false>;

export const state: () => ExtensionState = () => {
  // TODO: Trigger fetch
  return {};
};

export const mutations: MutationsType<ExtensionState> = {};

type ExtensionActionContext = ActionContext<ExtensionState>;

export const actions = {
  install(context: ExtensionActionContext, id: string): Promise<boolean> {
    return ipcRenderer.invoke('extension/install', id);
  },
};

export const getters: GetterTree<ExtensionState, ExtensionState> = {
  extensions(state, getter, rootState, rootGetters): ExtensionState {
    const extensionPrefs: ExtensionState = rootGetters['preferences/getPreferences']?.extensions ?? {};

    return Object.fromEntries(Object.entries(extensionPrefs).filter(([id, state]) => {
      return !!state;
    }));
  },
};
