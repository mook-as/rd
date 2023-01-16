import { GetterTree } from 'vuex';

import { ActionContext, MutationsType } from './ts-helpers';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

type ExtensionState = Record<string, boolean>;

export const state: () => ExtensionState = () => {
  // TODO: Trigger fetch
  return {};
};

export const mutations: MutationsType<ExtensionState> = {};

type ExtensionActionContext = ActionContext<ExtensionState>;

export const actions = {
  install(_: ExtensionActionContext, id: string): Promise<boolean> {
    return ipcRenderer.invoke('extension/install', id);
  },
};

export const getters: GetterTree<ExtensionState, ExtensionState> = {
  extensions(state, getter, rootState, rootGetters): ExtensionState {
    return rootGetters['preferences/getPreferences']?.extensions ?? {};
  },
};
