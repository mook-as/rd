import path from 'node:path';

import _ from 'lodash';
import webpack from 'webpack';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

export default {
  publicPath:          '/',
  outputDir:           path.resolve(rootDir, 'dist', 'app'),
  productionSourceMap: false,

  /** @type { (config: import('webpack-chain')) => void } */
  chainWebpack: (config) => {
    config.target('electron-renderer');
    config.resolve.alias.set('@pkg', path.resolve(rootDir, 'pkg', 'rancher-desktop'));
    config.resolve.extensions.add('.ts');

    config.module.rule('ts')
      .test(/\.ts$/)
      .use('ts-loader')
      .loader('ts-loader')
      .options({
        transpileOnly:    process.env.NODE_ENV === 'development',
        appendTsSuffixTo: ['\\.vue$'],
        happyPackMode:    true,
      });

    config.module.rule('yaml')
      .test(/\.ya?ml(?:\?[a-z0-9=&.]+)?$/)
      .use('js-yaml-loader')
      .loader('js-yaml-loader')
      .options({ name: '[path][name].[ext]' });

    config.module.rule('raw')
      .test(/(?:^|[/\\])assets[/\\]scripts[/\\]/)
      .use('raw-loader')
      .loader('raw-loader');

    config.plugin('define-plugin').use(webpack.DefinePlugin, [{
      'process.client':       JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),

      'process.env.FEATURE_DIAGNOSTICS_FIXES': process.env.RD_ENV_DIAGNOSTICS_FIXES === '1',

      __VUE_OPTIONS_API__:                     true,
      __VUE_PROD_DEVTOOLS__:                   false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    }]);

    config.module.rule('vue').use('vue-loader').tap((options) => {
      _.set(options, 'loaders.ts', 'ts-loader');

      return options;
    });
  },

  css: {
    loaderOptions: {
      sass: {
        additionalData: `
          @use 'sass:math';
          @import "@pkg/assets/styles/base/_variables.scss";
          @import "@pkg/assets/styles/base/_functions.scss";
          @import "@pkg/assets/styles/base/_mixins.scss";
        `,
      },
    },
  },

  pluginOptions: {
    i18n: {
      locale:         'en',
      fallbackLocale: 'en',
      localeDir:      'locales',
      enableInSFC:    false,
    },
  },

  transpileDependencies: ['yaml'],

  pages: {
    index: {
      entry:    path.join(import.meta.dirname, 'entry', 'index.ts'),
      template: path.join(import.meta.dirname, 'public', 'index.html'),
    },
  },
};
