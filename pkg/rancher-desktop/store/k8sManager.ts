import { GetterTree } from 'vuex';

import { ActionContext, MutationsType } from './ts-helpers';

import { State as BackendState } from '@pkg/backend/backend';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

interface K8sManagerState {
  k8sState: BackendState;
}

export const state: () => K8sManagerState = () => {
  return { k8sState: ipcRenderer.sendSync('k8s-state') as any };
};

export const mutations: MutationsType<K8sManagerState> = {
  SET_K8S_STATE(state, k8sState) {
    state.k8sState = k8sState;
  },
};

type K8sManagerActionContext = ActionContext<K8sManagerState>;

export const actions = {
  setK8sState({ commit }: K8sManagerActionContext, k8sState: BackendState) {
    commit('SET_K8S_STATE', k8sState);
  },
};

export const getters: GetterTree<K8sManagerState, K8sManagerState> = {
  getK8sState({ k8sState }: K8sManagerState) {
    return k8sState;
  },
};
